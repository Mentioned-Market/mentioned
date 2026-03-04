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
  type Address,
  type TransactionSendingSigner,
  createSolanaRpc,
  mainnet,
  getTransactionEncoder,
} from '@solana/kit'

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
  on(event: 'change', listener: (props: { accounts?: readonly WalletAccount[] }) => void): () => void
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
  /** Wallet address as a string (backward-compat: has .toString()) */
  publicKey: string | null
  /** SOL balance (number) */
  balance: number | null
  connect: () => Promise<void>
  disconnect: () => void
  connected: boolean
  /** Kit v2 TransactionSendingSigner for transaction signing */
  signer: TransactionSendingSigner | null
  mode: 'normal' | 'pro'
  setMode: (mode: 'normal' | 'pro') => void
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

function buildSigner(
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
      // SignatureBytes is a branded Uint8Array — safe to cast
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

  const walletRef = useRef<Wallet | null>(null)
  const rpc = useRef(createSolanaRpc(mainnet(MAINNET_URL)))

  // Apply connected account state
  const applyAccount = useCallback(
    (wallet: Wallet, account: WalletAccount) => {
      walletRef.current = wallet
      setPubkey(account.address)
      setConnected(true)
      setSigner(buildSigner(wallet, account))
    },
    []
  )

  const clearState = useCallback(() => {
    setPubkey(null)
    setBalance(null)
    setConnected(false)
    setSigner(null)
  }, [])

  // Detect wallet on mount
  useEffect(() => {
    if (typeof window === 'undefined') return

    const { get, on } = getWallets()

    const setup = (wallet: Wallet) => {
      walletRef.current = wallet

      // Auto-reconnect if wallet already has accounts (trusted connection)
      if (wallet.accounts.length > 0) {
        applyAccount(wallet, wallet.accounts[0])
      } else {
        // Try silent connect
        const connectFeat = wallet.features[FEAT_CONNECT] as ConnectFeature | undefined
        if (connectFeat) {
          connectFeat.connect({ silent: true }).then((accounts) => {
            if (accounts.length > 0) applyAccount(wallet, accounts[0])
          }).catch(() => { /* not previously authorized */ })
        }
      }

      // Listen for account changes
      if (FEAT_EVENTS in wallet.features) {
        const events = wallet.features[FEAT_EVENTS] as EventsFeature
        events.on('change', (props) => {
          const accounts = props.accounts ?? wallet.accounts
          if (accounts.length > 0) {
            applyAccount(wallet, accounts[0])
          } else {
            clearState()
          }
        })
      }
    }

    // Check already-registered wallets
    const existing = findPhantomWallet(get())
    if (existing) {
      setup(existing)
    }

    // Listen for late-registering wallets
    const unsub = on('register', (...newWallets: Wallet[]) => {
      if (walletRef.current) return // already have one
      const found = findPhantomWallet(newWallets)
      if (found) setup(found)
    })

    return () => {
      unsub()
    }
  }, [applyAccount, clearState])

  // Balance polling
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

  // Connect
  const connect = useCallback(async () => {
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
      applyAccount(wallet, accounts[0])
    }
  }, [applyAccount])

  // Disconnect
  const disconnect = useCallback(async () => {
    const wallet = walletRef.current
    if (wallet && FEAT_DISCONNECT in wallet.features) {
      const feat = wallet.features[FEAT_DISCONNECT] as DisconnectFeature
      await feat.disconnect()
    }
    clearState()
  }, [clearState])

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
