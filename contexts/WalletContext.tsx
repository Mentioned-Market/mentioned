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
  mainnet,
  getTransactionEncoder,
} from '@solana/kit'
import { usePrivy, useLoginWithOAuth } from '@privy-io/react-auth'
import {
  useWallets as usePrivySolanaWallets,
  useSignAndSendTransaction,
  useCreateWallet as useCreateSolanaWallet,
} from '@privy-io/react-auth/solana'
import { setPrivySolanaProvider } from '@/lib/walletUtils'

const MAINNET_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com'
const SOLANA_CHAIN = 'solana:mainnet-beta'       // Wallet Standard (Phantom)
const PRIVY_SOLANA_CHAIN = 'solana:mainnet'       // Privy internal chain ID
const RPC_SEND_PROXY = '/api/rpc/send'
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
  /** Sign raw transaction bytes via Phantom without simulate or send. For devnet use. */
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
  /** True while profile is being fetched */
  profileLoading: boolean
  /** Force re-fetch cached profile (e.g. after user edits their profile) */
  refreshProfile: () => void
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
  const res = await fetch(MAINNET_URL, {
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
 * Send a signed transaction via the server-side RPC proxy.
 * Returns the base58 signature as a Uint8Array (text-encoded).
 */
async function sendRawTx(signedTxBytes: Uint8Array): Promise<Uint8Array> {
  const base64Tx = btoa(String.fromCharCode(...signedTxBytes))
  const res = await fetch(RPC_SEND_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: base64Tx }),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`sendTransaction failed: ${json.error || 'Unknown error'}`)
  }
  const sigStr = json.signature as string
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
  const [profileLoading, setProfileLoading] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const profileFetchedForRef = useRef<string | null>(null)

  const walletRef = useRef<Wallet | null>(null)
  const walletTypeRef = useRef<'phantom' | 'privy' | null>(null)
  const walletAccountRef = useRef<WalletAccount | null>(null)
  const rpc = useRef(createSolanaRpc(mainnet(MAINNET_URL)))
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
  const { signAndSendTransaction: privySignAndSend } =
    useSignAndSendTransaction()
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet()
  const createSolanaWalletRef = useRef(createSolanaWallet)
  useEffect(() => { createSolanaWalletRef.current = createSolanaWallet }, [createSolanaWallet])

  const privySignAndSendRef = useRef(privySignAndSend)
  useEffect(() => {
    privySignAndSendRef.current = privySignAndSend
  }, [privySignAndSend])

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

    const encoder = getTransactionEncoder()
    const privySigner: TransactionSendingSigner = {
      address: toAddress(embeddedWalletAddress),
      signAndSendTransactions: async (transactions) => {
        const results = []
        for (const tx of transactions) {
          const txBytes = new Uint8Array(encoder.encode(tx))
          const result = await privySignAndSendRef.current({
            transaction: txBytes,
            wallet: privyWalletRef.current,
            chain: PRIVY_SOLANA_CHAIN as any,
          })
          results.push(result.signature)
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

  useEffect(() => {
    if (!pubkey) return

    const addr = toAddress(pubkey)
    const fetchBalance = async () => {
      try {
        const result = await rpc.current.getBalance(addr).send()
        setBalance(Number(result.value) / LAMPORTS_PER_SOL)
      } catch (e) {
        console.error('Error fetching balance:', e)
      }
    }

    fetchBalance()
    const interval = setInterval(fetchBalance, 10_000)
    return () => clearInterval(interval)
  }, [pubkey])

  // ── Profile cache ─────────────────────────────────────

  const fetchProfile = useCallback((wallet: string) => {
    setProfileLoading(true)
    fetch(`/api/profile?wallet=${wallet}`)
      .then(r => r.json())
      .then(d => { setUsername(d.username ?? null); setPfpEmoji(d.pfpEmoji ?? null); setDiscordLinked(!!d.discordId) })
      .catch(() => { setUsername(null); setPfpEmoji(null); setDiscordLinked(false) })
      .finally(() => setProfileLoading(false))
    profileFetchedForRef.current = wallet
  }, [])

  useEffect(() => {
    if (!pubkey) { setUsername(null); setPfpEmoji(null); setDiscordLinked(null); setProfileLoading(false); profileFetchedForRef.current = null; return }
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

  // Sign raw tx bytes via Phantom's signTransaction feature — no simulate, no send.
  // Used for devnet on-chain markets where the mainnet simulate/send proxy is wrong network.
  const signOnly = useCallback(async (txBytes: Uint8Array): Promise<Uint8Array> => {
    const wallet = walletRef.current
    const account = walletAccountRef.current
    if (!wallet || !account) throw new Error('Wallet not connected')
    if (!(FEAT_SIGN in wallet.features)) throw new Error('Wallet does not support signTransaction')
    const signFeature = wallet.features[FEAT_SIGN] as {
      signTransaction(...inputs: Array<{ transaction: Uint8Array; account: WalletAccount; chain?: string }>): Promise<Array<{ signedTransaction: Uint8Array }>>
    }
    const [result] = await signFeature.signTransaction({ transaction: txBytes, account, chain: 'solana:devnet' })
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
        profileLoading,
        walletReady,
        refreshProfile,
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
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
