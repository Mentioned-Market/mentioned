'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
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
import { usePrivy } from '@privy-io/react-auth'
import {
  useWallets as usePrivySolanaWallets,
  useSignAndSendTransaction,
} from '@privy-io/react-auth/solana'
import { setPrivySolanaProvider } from '@/lib/walletUtils'

const MAINNET_URL = 'https://api.mainnet-beta.solana.com'
const SOLANA_CHAIN = 'solana:mainnet-beta'
const LAMPORTS_PER_SOL = 1_000_000_000

// Feature name constants
const FEAT_CONNECT = 'standard:connect'
const FEAT_DISCONNECT = 'standard:disconnect'
const FEAT_EVENTS = 'standard:events'
const FEAT_SIGN_SEND = 'solana:signAndSendTransaction'

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

interface WalletContextType {
  publicKey: string | null
  balance: number | null
  connect: () => void
  disconnect: () => void
  connected: boolean
  signer: TransactionSendingSigner | null
  mode: 'normal' | 'pro'
  setMode: (mode: 'normal' | 'pro') => void
  walletType: 'phantom' | 'privy' | null
  showConnectModal: boolean
  setShowConnectModal: (show: boolean) => void
  connectPhantom: () => Promise<void>
  connectPrivy: () => void
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

function buildPhantomSigner(
  wallet: Wallet,
  account: WalletAccount
): TransactionSendingSigner {
  const feature = wallet.features[FEAT_SIGN_SEND] as SignAndSendFeature
  const encoder = getTransactionEncoder()

  return {
    address: toAddress(account.address),
    signAndSendTransactions: async (transactions) => {
      const inputs = transactions.map((tx) => ({
        transaction: new Uint8Array(encoder.encode(tx)),
        account,
        chain: SOLANA_CHAIN,
      }))

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

  const walletRef = useRef<Wallet | null>(null)
  const rpc = useRef(createSolanaRpc(mainnet(MAINNET_URL)))
  // Prevent Privy sync effect from re-connecting after explicit disconnect
  const disconnectingRef = useRef(false)

  // Privy hooks
  const {
    login: privyLogin,
    logout: privyLogout,
    authenticated: privyAuthenticated,
    ready: privyReady,
  } = usePrivy()
  const { wallets: privySolanaWallets, ready: privySolanaReady } = usePrivySolanaWallets()
  const { signAndSendTransaction: privySignAndSend } =
    useSignAndSendTransaction()

  // Store a ref to the Privy signAndSendTransaction so we can use it in the signer
  const privySignAndSendRef = useRef(privySignAndSend)
  useEffect(() => {
    privySignAndSendRef.current = privySignAndSend
  }, [privySignAndSend])

  // Store a ref to the Privy wallet for the signer
  const privyWalletRef = useRef<any>(null)

  // ── Phantom logic ──────────────────────────────────────

  const applyPhantomAccount = useCallback(
    (wallet: Wallet, account: WalletAccount) => {
      walletRef.current = wallet
      setPubkey(account.address)
      setConnected(true)
      setSigner(buildPhantomSigner(wallet, account))
      setWalletType('phantom')
    },
    []
  )

  const clearState = useCallback(() => {
    setPubkey(null)
    setBalance(null)
    setConnected(false)
    setSigner(null)
    setWalletType(null)
    privyWalletRef.current = null
  }, [])

  // Detect Phantom wallet on mount (auto-reconnect)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (walletType === 'privy') return

    const { get, on } = getWallets()

    const setup = (wallet: Wallet) => {
      walletRef.current = wallet

      if (wallet.accounts.length > 0) {
        applyPhantomAccount(wallet, wallet.accounts[0])
      } else {
        const connectFeat = wallet.features[
          FEAT_CONNECT
        ] as ConnectFeature | undefined
        if (connectFeat) {
          connectFeat
            .connect({ silent: true })
            .then((accounts) => {
              if (accounts.length > 0)
                applyPhantomAccount(wallet, accounts[0])
            })
            .catch(() => {})
        }
      }

      if (FEAT_EVENTS in wallet.features) {
        const events = wallet.features[FEAT_EVENTS] as EventsFeature
        events.on('change', (props) => {
          const accounts = props.accounts ?? wallet.accounts
          if (accounts.length > 0) {
            applyPhantomAccount(wallet, accounts[0])
          } else if (walletType === 'phantom') {
            clearState()
          }
        })
      }
    }

    const existing = findPhantomWallet(get())
    if (existing) setup(existing)

    const unsub = on('register', (...newWallets: Wallet[]) => {
      if (walletRef.current) return
      const found = findPhantomWallet(newWallets)
      if (found) setup(found)
    })

    return () => {
      unsub()
    }
  }, [applyPhantomAccount, clearState, walletType])

  // ── Privy wallet sync ──────────────────────────────────

  useEffect(() => {
    if (!privyReady || !privySolanaReady) return
    if (!privyAuthenticated) {
      if (walletType === 'privy') clearState()
      disconnectingRef.current = false
      return
    }

    // Don't re-connect if user just clicked disconnect
    if (disconnectingRef.current) return

    // Find the Privy embedded Solana wallet
    // ConnectedStandardSolanaWallet has .standardWallet with .isPrivyWallet
    const embeddedWallet = privySolanaWallets.find(
      (w: any) => w.standardWallet?.isPrivyWallet === true
    ) ?? privySolanaWallets[0]
    if (!embeddedWallet) return

    // Only apply if not already connected via Phantom
    if (walletType === 'phantom' && connected) return

    const addr = embeddedWallet.address
    privyWalletRef.current = embeddedWallet

    // Store the wallet for the signAndSendTx utility
    setPrivySolanaProvider(embeddedWallet)

    setPubkey(addr)
    setConnected(true)
    setWalletType('privy')

    // Build a TransactionSendingSigner that uses Privy's signAndSendTransaction
    const encoder = getTransactionEncoder()
    const privySigner: TransactionSendingSigner = {
      address: toAddress(addr),
      signAndSendTransactions: async (transactions) => {
        const results = []
        for (const tx of transactions) {
          const txBytes = new Uint8Array(encoder.encode(tx))
          const result = await privySignAndSendRef.current({
            transaction: txBytes,
            wallet: privyWalletRef.current,
            chain: SOLANA_CHAIN as any,
          })
          results.push(result.signature)
        }
        return results as any
      },
    }
    setSigner(privySigner)
  }, [
    privyAuthenticated,
    privyReady,
    privySolanaReady,
    privySolanaWallets,
    walletType,
    connected,
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

  // ── Connect methods ────────────────────────────────────

  const connectPhantom = useCallback(async () => {
    setShowConnectModal(false)
    let wallet = walletRef.current
    if (!wallet) {
      const { get } = getWallets()
      wallet = findPhantomWallet(get())
      if (!wallet) {
        window.open('https://phantom.app/', '_blank')
        return
      }
      walletRef.current = wallet
    }

    const feat = wallet.features[FEAT_CONNECT] as ConnectFeature | undefined
    if (!feat) return

    const accounts = await feat.connect()
    if (accounts.length > 0) {
      applyPhantomAccount(wallet, accounts[0])
    }
  }, [applyPhantomAccount])

  const connectPrivyFn = useCallback(() => {
    setShowConnectModal(false)
    privyLogin()
  }, [privyLogin])

  const connect = useCallback(() => {
    setShowConnectModal(true)
  }, [])

  // ── Disconnect ─────────────────────────────────────────

  const disconnect = useCallback(async () => {
    if (walletType === 'privy') {
      disconnectingRef.current = true
      setPrivySolanaProvider(null)
      clearState()
      await privyLogout()
    } else {
      const wallet = walletRef.current
      if (wallet && FEAT_DISCONNECT in wallet.features) {
        const feat = wallet.features[FEAT_DISCONNECT] as DisconnectFeature
        await feat.disconnect()
      }
      clearState()
    }
  }, [walletType, clearState, privyLogout])

  return (
    <WalletContext.Provider
      value={{
        publicKey: pubkey,
        balance,
        connect,
        disconnect,
        connected,
        signer,
        mode,
        setMode,
        walletType,
        showConnectModal,
        setShowConnectModal,
        connectPhantom,
        connectPrivy: connectPrivyFn,
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
