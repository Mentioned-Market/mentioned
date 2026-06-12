'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react'
import { getWallets } from '@wallet-standard/app'
import type { Wallet, WalletAccount } from '@wallet-standard/base'
import {
  address as toAddress,
  type TransactionSendingSigner,
  createSolanaRpc,
  getTransactionEncoder,
} from '@solana/kit'
import { usePrivy, useLoginWithOAuth } from '@privy-io/react-auth'
import {
  useWallets as usePrivySolanaWallets,
  useSignTransaction as usePrivySignTransaction,
  useCreateWallet as useCreateSolanaWallet,
} from '@privy-io/react-auth/solana'
import { setPrivySolanaProvider, setPrivySignTx } from '@/lib/walletUtils'
import { MAINNET_RPC_PROXY } from '@/lib/rpcProxy'
import { sendViaProxy, confirmSignature } from '@/lib/rpcSend'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { SOLANA_CLUSTER } from '@/lib/solanaConfig'

const SOLANA_CHAIN = 'solana:mainnet-beta'       // Wallet Standard (Phantom)
const PRIVY_SOLANA_CHAIN = 'solana:mainnet'       // Privy internal chain ID

// Chain the paid-markets raw-sign path declares to the wallet. Follows the paid
// cluster (lib/solanaConfig) so flipping to devnet re-points paid signing without
// disturbing the app's other (always-mainnet) flows.
const PAID_PHANTOM_CHAIN = SOLANA_CLUSTER === 'devnet' ? 'solana:devnet' : SOLANA_CHAIN
const PAID_PRIVY_CHAIN = SOLANA_CLUSTER === 'devnet' ? 'solana:devnet' : PRIVY_SOLANA_CHAIN
const LAMPORTS_PER_SOL = 1_000_000_000

const FEAT_CONNECT = 'standard:connect'
const FEAT_DISCONNECT = 'standard:disconnect'
const FEAT_EVENTS = 'standard:events'
const FEAT_SIGN_SEND = 'solana:signAndSendTransaction'
const FEAT_SIGN_MSG = 'solana:signMessage'

// ── Types ────────────────────────────────────────────────

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<readonly WalletAccount[]>
}

interface DisconnectFeature {
  disconnect(): Promise<void>
}

interface EventsFeature {
  on(
    event: 'change',
    listener: (props: { accounts?: readonly WalletAccount[] }) => void
  ): () => void
}

interface SignAndSendFeature {
  signAndSendTransaction(
    ...inputs: Array<{
      transaction: Uint8Array
      account: WalletAccount
      chain?: string
    }>
  ): Promise<Array<{ signature: Uint8Array }>>
}

interface SignMessageFeature {
  signMessage(
    ...inputs: Array<{
      message: Uint8Array
      account: WalletAccount
    }>
  ): Promise<Array<{ signedMessage: Uint8Array; signature: Uint8Array }>>
}

interface WalletContextType {
  publicKey: string | null
  balance: number | null
  connect: () => void
  disconnect: () => void
  connected: boolean
  signer: TransactionSendingSigner | null
  /** Sign raw transaction bytes via the wallet without simulate or send (paid-cluster broadcast). */
  signOnly: ((txBytes: Uint8Array) => Promise<Uint8Array>) | null
  mode: 'normal' | 'pro'
  setMode: (mode: 'normal' | 'pro') => void
  walletType: 'phantom' | 'privy' | null
  showConnectModal: boolean
  setShowConnectModal: (show: boolean) => void
  connectPhantom: () => Promise<void>
  connectPrivy: () => void
  connectGoogle: () => void
  connectX: () => void
  /** Cached profile username (fetched once on connect) */
  username: string | null
  /** Cached profile emoji (fetched once on connect) */
  pfpEmoji: string | null
  /** Whether the user has linked their Discord account. null = not yet fetched. */
  discordLinked: boolean | null
  /** Whether the linked Discord account is less than 30 days old (trading blocked). */
  discordTooNew: boolean
  /** ISO timestamp the account was admin-locked, or null if not locked. */
  lockedAt: string | null
  /** True while profile is being fetched */
  profileLoading: boolean
  /** Force re-fetch cached profile (e.g. after user edits their profile) */
  refreshProfile: () => void
  /** Immediately re-fetch the SOL balance (call after any send so the UI doesn't wait for the 30s poll) */
  refreshBalance: () => void
  /** Directly update the cached username (e.g. after a successful save, before refetch) */
  setCachedUsername: (username: string | null) => void
  /** Whether the session has been verified server-side */
  authenticated: boolean
  /** True once wallet connection state has been determined (safe to render connected/login UI) */
  walletReady: boolean
  /** True while a wallet connection is actively in progress (between user action and state update) */
  connecting: boolean
  /** True once the Privy SDK is initialized and ready to accept logins */
  privyReady: boolean
}

const SSR_DEFAULT: WalletContextType = {
  publicKey: null, balance: null, connected: false, signer: null, signOnly: null,
  mode: 'normal', walletType: null, showConnectModal: false, username: null,
  pfpEmoji: null, discordLinked: null, discordTooNew: false, lockedAt: null,
  profileLoading: false, authenticated: false, walletReady: false, connecting: false,
  privyReady: false,
  connect: () => {}, disconnect: () => {}, setMode: () => {}, setShowConnectModal: () => {},
  connectPhantom: async () => {}, connectPrivy: () => {}, connectGoogle: () => {}, connectX: () => {},
  refreshProfile: () => {}, refreshBalance: () => {}, setCachedUsername: () => {},
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

// ── Helpers ──────────────────────────────────────────────

function findPhantomWallet(wallets: readonly Wallet[]): Wallet | null {
  return (
    wallets.find(
      (w) =>
        w.name === 'Phantom' &&
        w.chains.some((c) => c.startsWith('solana:')) &&
        FEAT_SIGN_SEND in w.features &&
        FEAT_CONNECT in w.features
    ) ?? null
  )
}

async function preSimulateTx(txBytes: Uint8Array): Promise<void> {
  const base64Tx = btoa(String.fromCharCode(...txBytes))
  const res = await fetch(MAINNET_RPC_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: [
        base64Tx,
        {
          encoding: 'base64',
          sigVerify: false,
          replaceRecentBlockhash: true,
        },
      ],
    }),
  })
  const json = await res.json()
  const err = json?.result?.value?.err
  if (err) {
    throw new Error(`Transaction simulation failed: ${JSON.stringify(err)}`)
  }
}

/**
 * Send a signed transaction via the same-origin RPC proxy.
 * Returns the base58 signature as a Uint8Array (text-encoded).
 */
async function sendRawTx(signedTxBytes: Uint8Array): Promise<Uint8Array> {
  const sigStr = await sendViaProxy(signedTxBytes, MAINNET_RPC_PROXY)
  return new TextEncoder().encode(sigStr)
}

const FEAT_SIGN = 'solana:signTransaction'

function buildPhantomSigner(
  wallet: Wallet,
  account: WalletAccount
): TransactionSendingSigner {
  const txEncoder = getTransactionEncoder()
  const useSignOnly = FEAT_SIGN in wallet.features

  return {
    address: toAddress(account.address),
    signAndSendTransactions: async (transactions) => {
      const inputs = transactions.map((tx) => ({
        transaction: new Uint8Array(txEncoder.encode(tx)),
        account,
        chain: SOLANA_CHAIN,
      }))

      // Pre-simulate to avoid Phantom's "malicious dApp" warning
      for (const input of inputs) {
        await preSimulateTx(input.transaction)
      }

      if (useSignOnly) {
        // Two-step: wallet signs first, then we send via RPC.
        // For on-chain mention market txs, there's only one signer (the user),
        // so no need to strip/restore signatures. But using signTransaction
        // still avoids any Lighthouse multi-signer detection.
        const signFeature = wallet.features[FEAT_SIGN] as {
          signTransaction(...inputs: Array<{ transaction: Uint8Array; account: any; chain?: string }>): Promise<Array<{ signedTransaction: Uint8Array }>>
        }
        const signed = await signFeature.signTransaction(...inputs)
        const sigs: Uint8Array[] = []
        for (const s of signed) {
          const sig = await sendRawTx(s.signedTransaction)
          sigs.push(sig)
        }
        return sigs as any
      }

      // Fallback: signAndSendTransaction
      const feature = wallet.features[FEAT_SIGN_SEND] as SignAndSendFeature
      const results = await feature.signAndSendTransaction(...inputs)
      return results.map((r) => r.signature) as any
    },
  }
}

// ── Provider ─────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [connected, setConnected] = useState(false)
  const [signer, setSigner] = useState<TransactionSendingSigner | null>(null)
  const [mode, setMode] = useState<'normal' | 'pro'>('normal')
  const [walletType, setWalletType] = useState<'phantom' | 'privy' | null>(
    null
  )
  const [showConnectModal, setShowConnectModal] = useState(false)
  const [connecting, setConnecting] = useState(false)

  // Auth session state
  const [authenticated, setAuthenticated] = useState(false)
  const authInFlightRef = useRef<string | null>(null)

  // Cached profile data (fetched once per wallet connection)
  const [username, setUsername] = useState<string | null>(null)
  const [pfpEmoji, setPfpEmoji] = useState<string | null>(null)
  const [discordLinked, setDiscordLinked] = useState<boolean | null>(null)
  const [discordTooNew, setDiscordTooNew] = useState(false)
  const [lockedAt, setLockedAt] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const profileFetchedForRef = useRef<string | null>(null)

  const walletRef = useRef<Wallet | null>(null)
  const walletTypeRef = useRef<'phantom' | 'privy' | null>(null)
  const walletAccountRef = useRef<WalletAccount | null>(null)
  const rpc = useRef(createSolanaRpc(MAINNET_RPC_PROXY))
  const disconnectingRef = useRef(false)

  // Privy hooks
  const {
    login: privyLogin,
    logout: privyLogout,
    authenticated: privyAuthenticated,
    ready: privyReady,
    getAccessToken,
  } = usePrivy()
  const { initOAuth } = useLoginWithOAuth()
  const { wallets: privySolanaWallets, ready: privySolanaReady } =
    usePrivySolanaWallets()
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet()
  const createSolanaWalletRef = useRef(createSolanaWallet)
  useEffect(() => { createSolanaWalletRef.current = createSolanaWallet }, [createSolanaWallet])

  const { signTransaction: privySignTx } = usePrivySignTransaction()
  const privySignTxRef = useRef(privySignTx)
  useEffect(() => {
    privySignTxRef.current = privySignTx
    // Mirror into lib/walletUtils so the non-React Jupiter flow can sign too.
    setPrivySignTx(privySignTx as any)
  }, [privySignTx])

  const privyWalletRef = useRef<any>(null)

  // ── Phantom logic ──────────────────────────────────────

  const applyPhantomAccount = useCallback(
    (wallet: Wallet, account: WalletAccount) => {
      walletRef.current = wallet
      walletTypeRef.current = 'phantom'
      walletAccountRef.current = account
      setPubkey(account.address)
      setConnected(true)
      setSigner(buildPhantomSigner(wallet, account))
      setWalletType('phantom')
      setProfileLoading(true)
    },
    []
  )

  const clearState = useCallback(() => {
    setPubkey(null)
    setBalance(null)
    setConnected(false)
    setSigner(null)
    setWalletType(null)
    setUsername(null)
    setPfpEmoji(null)
    setDiscordLinked(null)
    setProfileLoading(false)
    setAuthenticated(false)
    profileFetchedForRef.current = null
    authInFlightRef.current = null
    privyWalletRef.current = null
    walletRef.current = null
    walletTypeRef.current = null
    walletAccountRef.current = null
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (walletType === 'privy') return
    if (disconnectingRef.current) return

    const { get, on } = getWallets()
    let unsubChange: (() => void) | null = null

    const setup = (wallet: Wallet) => {
      walletRef.current = wallet

      // User explicitly disconnected — don't auto-reconnect
      const wasDisconnected = (() => {
        try { return localStorage.getItem('phantom_disconnected') === '1' } catch { return false }
      })()

      // User last logged in via Privy — let Privy restore the session
      const preferPrivy = (() => {
        try { return localStorage.getItem('preferred_wallet') === 'privy' } catch { return false }
      })()

      if (wasDisconnected || preferPrivy) {
        setWalletReady(true)
        return
      }

      if (wallet.accounts.length > 0) {
        applyPhantomAccount(wallet, wallet.accounts[0])
        setWalletReady(true)
      } else {
        const connectFeat = wallet.features[
          FEAT_CONNECT
        ] as ConnectFeature | undefined
        if (connectFeat) {
          connectFeat
            .connect({ silent: true })
            .then((accounts) => {
              if (accounts.length > 0 && !disconnectingRef.current)
                applyPhantomAccount(wallet, accounts[0])
            })
            .catch(() => {})
            .finally(() => setWalletReady(true))
        } else {
          setWalletReady(true)
        }
      }

      if (FEAT_EVENTS in wallet.features) {
        const events = wallet.features[FEAT_EVENTS] as EventsFeature
        unsubChange = events.on('change', (props) => {
          if (disconnectingRef.current) return
          const accounts = props.accounts ?? wallet.accounts
          if (accounts.length > 0) {
            applyPhantomAccount(wallet, accounts[0])
          } else if (walletTypeRef.current === 'phantom') {
            clearState()
          }
        })
      }
    }

    const existing = findPhantomWallet(get())
    if (existing) {
      setup(existing)
    } else {
      // No Phantom wallet detected yet; mark ready after a short window
      // in case it registers late, then flip back if it does register
      const readyTimer = setTimeout(() => setWalletReady(true), 500)
      const unsub2 = on('register', (...newWallets: Wallet[]) => {
        if (walletRef.current) return
        const found = findPhantomWallet(newWallets)
        if (found) {
          clearTimeout(readyTimer)
          setWalletReady(false)
          setup(found)
        }
      })
      return () => { clearTimeout(readyTimer); unsub2(); unsubChange?.() }
    }

    const unsub = on('register', (...newWallets: Wallet[]) => {
      if (walletRef.current) return
      const found = findPhantomWallet(newWallets)
      if (found) setup(found)
    })

    return () => {
      unsub()
      unsubChange?.()
    }
  }, [applyPhantomAccount, clearState])

  // Keep a stable ref to the wallets array for reading inside the effect
  // without including the unstable array reference in deps.
  const privySolanaWalletsRef = useRef(privySolanaWallets)
  useEffect(() => { privySolanaWalletsRef.current = privySolanaWallets }, [privySolanaWallets])

  // Derive a stable string address from the wallets array.
  // Strings compare by value (Object.is), so the effect below only re-runs
  // when the actual wallet address changes — not on every new array reference
  // that Privy emits on each render.
  const embeddedWalletAddress = useMemo(() => {
    const w = privySolanaWallets.find((w: any) => w.standardWallet?.isPrivyWallet === true) ?? privySolanaWallets[0]
    return (w as any)?.address as string | undefined
  }, [privySolanaWallets])

  // Track whether we've already attempted wallet creation to prevent repeated calls
  const walletCreationAttemptedRef = useRef(false)

  // ── Privy wallet sync ──────────────────────────────────

  useEffect(() => {
    if (!privyReady || !privySolanaReady) return
    if (!privyAuthenticated) {
      if (walletType === 'privy') clearState()
      disconnectingRef.current = false
      walletCreationAttemptedRef.current = false
      setWalletReady(true)
      setConnecting(false)
      return
    }

    if (disconnectingRef.current) return

    if (!embeddedWalletAddress) {
      // Wallet not created yet — attempt creation once
      if (!walletCreationAttemptedRef.current) {
        walletCreationAttemptedRef.current = true
        createSolanaWalletRef.current().catch(() => {
          walletCreationAttemptedRef.current = false
        })
      }
      return
    }

    if (walletType === 'phantom' && connected) return

    // Already fully connected to this wallet — skip re-setup
    if (walletType === 'privy' && connected && pubkey === embeddedWalletAddress) return

    const wallets = privySolanaWalletsRef.current
    const embeddedWallet = wallets.find((w: any) => w.standardWallet?.isPrivyWallet === true) ?? wallets[0]
    if (!embeddedWallet) return

    privyWalletRef.current = embeddedWallet
    walletCreationAttemptedRef.current = false

    setPrivySolanaProvider(embeddedWallet)

    walletTypeRef.current = 'privy'
    try { localStorage.setItem('preferred_wallet', 'privy') } catch {}
    setPubkey(embeddedWalletAddress)
    setConnected(true)
    setWalletType('privy')
    setConnecting(false)

    // Sign-only flow: Privy signs (pure crypto, no RPC), our same-origin proxy
    // broadcasts and confirms. Privy never needs an RPC endpoint, so no keyed
    // URL ships in the browser bundle. Confirmation is awaited because callers
    // (e.g. PrivyFundsModal) refetch balances as soon as this resolves.
    const encoder = getTransactionEncoder()
    const privySigner: TransactionSendingSigner = {
      address: toAddress(embeddedWalletAddress),
      signAndSendTransactions: async (transactions) => {
        const results = []
        for (const tx of transactions) {
          const txBytes = new Uint8Array(encoder.encode(tx))
          // Surface failures before signing (parity with the Phantom signer).
          await preSimulateTx(txBytes)
          const { signedTransaction } = await privySignTxRef.current({
            transaction: txBytes,
            wallet: privyWalletRef.current,
            chain: PRIVY_SOLANA_CHAIN as any,
          })
          const signature = await sendViaProxy(
            new Uint8Array(signedTransaction),
            MAINNET_RPC_PROXY
          )
          await confirmSignature(signature, { proxyUrl: MAINNET_RPC_PROXY })
          results.push(new TextEncoder().encode(signature))
        }
        return results as any
      },
    }
    setSigner(privySigner)
    setWalletReady(true)
  }, [
    privyAuthenticated,
    privyReady,
    privySolanaReady,
    embeddedWalletAddress,
    walletType,
    connected,
    pubkey,
    clearState,
  ])

  // ── Balance polling ────────────────────────────────────

  const fetchBalance = useCallback(async () => {
    if (!pubkey) return
    try {
      const result = await rpc.current.getBalance(toAddress(pubkey)).send()
      setBalance(Number(result.value) / LAMPORTS_PER_SOL)
    } catch (e) {
      console.error('Error fetching balance:', e)
    }
  }, [pubkey])

  // Poll the balance only while the tab is visible — a backgrounded/minimized tab
  // burns RPC credits for a balance the user can't see. The hook pauses on hidden
  // and resumes (with an immediate fetch) when the tab is shown again.
  //
  // 30s is deliberate: SOL balance only changes when the user acts (covered by
  // refreshBalance calls after sends + the immediate fetch on refocus/connect)
  // or by external deposits, where 30s latency is invisible. This poll is the
  // single largest RPC credit line at scale — keep it lean.
  useVisibleInterval(fetchBalance, 30_000)

  // Fetch immediately on connect / account switch rather than waiting for the next
  // poll tick — useVisibleInterval only re-fires on visibility change, not on pubkey.
  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  // ── Profile cache ─────────────────────────────────────

  const fetchProfile = useCallback((wallet: string) => {
    setProfileLoading(true)
    fetch(`/api/profile?wallet=${wallet}`)
      .then(r => r.json())
      .then(d => {
        setUsername(d.username ?? null)
        setPfpEmoji(d.pfpEmoji ?? null)
        setDiscordLinked(!!d.discordId)
        setLockedAt(d.lockedAt ?? null)
        if (d.discordId) {
          const created = new Date(Number(BigInt(d.discordId) >> 22n) + 1420070400000)
          const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)
          setDiscordTooNew(ageDays < 30)
        } else {
          setDiscordTooNew(false)
        }
      })
      .catch(() => { setUsername(null); setPfpEmoji(null); setDiscordLinked(false); setDiscordTooNew(false); setLockedAt(null) })
      .finally(() => setProfileLoading(false))
    profileFetchedForRef.current = wallet
  }, [])

  useEffect(() => {
    if (!pubkey) { setUsername(null); setPfpEmoji(null); setDiscordLinked(null); setDiscordTooNew(false); setLockedAt(null); setProfileLoading(false); profileFetchedForRef.current = null; return }
    if (profileFetchedForRef.current === pubkey) return
    fetchProfile(pubkey)
  }, [pubkey, fetchProfile])

  const refreshProfile = useCallback(() => {
    if (pubkey) fetchProfile(pubkey)
  }, [pubkey, fetchProfile])

  // ── Discord popup message listener ─────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'discord_linked') {
        if (pubkey) fetchProfile(pubkey)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [pubkey, fetchProfile])

  // ── Session establishment ───────────────────────────────

  useEffect(() => {
    if (!pubkey || !connected || !walletType) return
    if (authInFlightRef.current === pubkey) return

    // Check if a valid session already exists (non-httpOnly flag cookie)
    const cookies = document.cookie.split('; ')
    const sessionWallet = cookies
      .find((c) => c.startsWith('session_wallet='))
      ?.split('=')[1]
    if (sessionWallet === pubkey) {
      setAuthenticated(true)
      return
    }

    authInFlightRef.current = pubkey

    const establishSession = async () => {
      try {
        if (walletType === 'privy') {
          // Privy: get access token (already authenticated) and verify server-side.
          // Retry up to 3 times — embedded wallet may lag Privy's REST API on first login.
          const token = await getAccessToken()
          if (!token) throw new Error('No Privy access token')
          // Capture the pubkey we're signing in for at this moment.
          // pubkey in state may change during async retries (Privy re-renders)
          // so we use a local const and verify the server confirms the same wallet.
          const signingForWallet = pubkey
          let lastStatus = 0
          for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch('/api/auth/sign-in', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'privy', token, wallet: signingForWallet }),
            })
            lastStatus = res.status
            if (res.ok) {
              const data = await res.json()
              // Verify the server established the session for the wallet we expect.
              // If pubkey drifted during the async call, do not mark as authenticated.
              if (data.wallet !== signingForWallet) {
                console.error(`Session wallet mismatch: expected ${signingForWallet}, got ${data.wallet}`)
                throw new Error('Session wallet mismatch')
              }
              setAuthenticated(true)
              break
            }
            if (res.status !== 401) break // non-retriable error
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
          }
          if (lastStatus !== 200 && lastStatus !== 0) throw new Error(`Privy sign-in failed: ${lastStatus}`)
        } else if (walletType === 'phantom') {
          // Phantom: sign a message to prove wallet ownership
          const wallet = walletRef.current
          if (!wallet || !(FEAT_SIGN_MSG in wallet.features)) {
            throw new Error('Wallet does not support signMessage')
          }
          const account = wallet.accounts[0]
          if (!account) throw new Error('No wallet account')

          // Capture wallet address before async signing — protects against
          // pubkey state changing if the user switches accounts mid-flight.
          const signingForWallet = pubkey

          const timestamp = Math.floor(Date.now() / 1000)
          const message = `Sign in to Mentioned\nTimestamp: ${timestamp}`
          const messageBytes = new TextEncoder().encode(message)

          const signMessageFeature = wallet.features[FEAT_SIGN_MSG] as SignMessageFeature
          const [result] = await signMessageFeature.signMessage({
            message: messageBytes,
            account,
          })

          // Encode signature as base64 for transport
          const signatureBase64 = btoa(
            String.fromCharCode(...result.signature),
          )

          const res = await fetch('/api/auth/sign-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'phantom',
              wallet: signingForWallet,
              signature: signatureBase64,
              message,
            }),
          })
          if (!res.ok) throw new Error('Phantom sign-in failed')
          const data = await res.json()
          if (data.wallet !== signingForWallet) {
            console.error(`Session wallet mismatch: expected ${signingForWallet}, got ${data.wallet}`)
            throw new Error('Session wallet mismatch')
          }
          setAuthenticated(true)
        }
      } catch (err) {
        console.error('Session establishment failed:', err)
        authInFlightRef.current = null
        // Don't disconnect — wallet is connected, just not authenticated.
        // API calls that require auth will return 401 and the UI can handle it.
      }
    }

    establishSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, connected, walletType])

  // ── Connect methods ────────────────────────────────────

  const connectPhantom = useCallback(async () => {
    setShowConnectModal(false)
    disconnectingRef.current = false
    try { localStorage.removeItem('phantom_disconnected') } catch {}
    try { localStorage.removeItem('preferred_wallet') } catch {}
    let wallet = walletRef.current
    if (!wallet) {
      const { get, on } = getWallets()
      wallet = findPhantomWallet(get())
      if (!wallet) {
        // Phantom may be installed but not yet registered via Wallet Standard.
        // Check legacy injection APIs as a presence signal before redirecting.
        const win = window as any
        const phantomPresent = win.phantom?.solana?.isPhantom || win.solana?.isPhantom
        if (phantomPresent) {
          // Wait up to 1 second for Wallet Standard registration
          wallet = await new Promise<Wallet | null>((resolve) => {
            const timeout = setTimeout(() => { unsub(); resolve(findPhantomWallet(get())) }, 1000)
            const unsub = on('register', (...newWallets: Wallet[]) => {
              const found = findPhantomWallet(newWallets)
              if (found) { clearTimeout(timeout); unsub(); resolve(found) }
            })
          })
        }
        if (!wallet) {
          window.open('https://phantom.app/', '_blank')
          return
        }
      }
      walletRef.current = wallet
    }

    const feat = wallet.features[FEAT_CONNECT] as ConnectFeature | undefined
    if (!feat) return

    setConnecting(true)
    try {
      const accounts = await feat.connect()
      const resolved = accounts.length > 0 ? accounts : wallet.accounts
      if (resolved.length > 0) {
        applyPhantomAccount(wallet, resolved[0])
      }
    } catch (err) {
      console.error('Phantom connect failed:', err)
    } finally {
      setConnecting(false)
    }
  }, [applyPhantomAccount])

  const connectPrivyFn = useCallback(() => {
    setShowConnectModal(false)
    setConnecting(true)
    privyLogin()
  }, [privyLogin])

  const connectGoogle = useCallback(async () => {
    setShowConnectModal(false)
    setConnecting(true)
    if (privyAuthenticated) await privyLogout()
    initOAuth({ provider: 'google' })
  }, [initOAuth, privyAuthenticated, privyLogout])

  const connectX = useCallback(async () => {
    setShowConnectModal(false)
    setConnecting(true)
    if (privyAuthenticated) await privyLogout()
    initOAuth({ provider: 'twitter' })
  }, [initOAuth, privyAuthenticated, privyLogout])

  const connect = useCallback(() => {
    setShowConnectModal(true)
  }, [])

  // ── Disconnect ─────────────────────────────────────────

  const disconnect = useCallback(async () => {
    // Clear server session before clearing client state
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => {})

    if (walletType === 'privy') {
      disconnectingRef.current = true
      try { localStorage.removeItem('preferred_wallet') } catch {}
      setPrivySolanaProvider(null)
      try {
        await privyLogout()
      } catch (e) {
        console.warn('Privy logout error:', e)
      }
      clearState()
    } else {
      disconnectingRef.current = true
      // Persist disconnect intent so silent reconnect doesn't fire on refresh
      try { localStorage.setItem('phantom_disconnected', '1') } catch {}
      try { localStorage.removeItem('preferred_wallet') } catch {}
      const wallet = walletRef.current
      if (wallet && FEAT_DISCONNECT in wallet.features) {
        const feat = wallet.features[FEAT_DISCONNECT] as DisconnectFeature
        // Fire-and-forget — don't await; Phantom's disconnect() can hang
        feat.disconnect().catch(() => {})
      }
      clearState()
    }
  }, [walletType, clearState, privyLogout])

  // Sign raw tx bytes via the wallet's signTransaction feature — no simulate, no
  // send. Used for the paid on-chain markets so we can broadcast straight to the
  // paid-cluster RPC instead of going through the mainnet proxy. The declared
  // chain follows the paid cluster (mainnet by default, devnet when configured).
  const signOnly = useCallback(async (txBytes: Uint8Array): Promise<Uint8Array> => {
    // Privy embedded wallet path
    if (walletTypeRef.current === 'privy') {
      const result = await privySignTxRef.current({
        transaction: txBytes,
        wallet: privyWalletRef.current,
        chain: PAID_PRIVY_CHAIN as any,
      })
      return result.signedTransaction as Uint8Array
    }
    // Phantom (or other Wallet Standard wallet) path
    const wallet = walletRef.current
    const account = walletAccountRef.current
    if (!wallet || !account) throw new Error('Wallet not connected')
    if (!(FEAT_SIGN in wallet.features)) throw new Error('Wallet does not support signTransaction')
    const signFeature = wallet.features[FEAT_SIGN] as {
      signTransaction(...inputs: Array<{ transaction: Uint8Array; account: WalletAccount; chain?: string }>): Promise<Array<{ signedTransaction: Uint8Array }>>
    }
    const [result] = await signFeature.signTransaction({ transaction: txBytes, account, chain: PAID_PHANTOM_CHAIN })
    return result.signedTransaction
  }, [])

  return (
    <WalletContext.Provider
      value={{
        publicKey: pubkey,
        balance,
        connect,
        disconnect,
        connected,
        signer,
        signOnly,
        mode,
        setMode,
        walletType,
        showConnectModal,
        setShowConnectModal,
        connectPhantom,
        connectPrivy: connectPrivyFn,
        connectGoogle,
        connectX,
        username,
        pfpEmoji,
        discordLinked,
        discordTooNew,
        lockedAt,
        profileLoading,
        walletReady,
        refreshProfile,
        refreshBalance: fetchBalance,
        setCachedUsername: setUsername,
        authenticated,
        connecting,
        privyReady,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  return context ?? SSR_DEFAULT
}
