import MentionedMarketABI from './abis/MentionedMarket.json'
import MockUSDCABI from './abis/MockUSDC.json'

// Contract addresses on Base Sepolia
export const contracts = {
  mockUSDC: '0xe9927F577620a44603A658fA56033652FDaDdafd' as `0x${string}`,
  mentionedMarket: '0x7352757177B0b73472deF893f12b97d015F77C76' as `0x${string}`,
} as const

// Export ABIs
export const abis = {
  mentionedMarket: MentionedMarketABI.abi,
  mockUSDC: MockUSDCABI.abi,
} as const

// Chain config
export const BASE_SEPOLIA_CHAIN_ID = 84532
export const BASE_SEPOLIA_RPC = 'https://sepolia.base.org'

// Owner address
export const OWNER_ADDRESS = '0xac5a7Ce31843e737CD38938A8EfDEc0BE5e728b4'

// Enums
export enum EventState {
  PREMARKET = 0,
  LIVE = 1,
  RESOLVED = 2,
}

export enum Outcome {
  YES = 0,
  NO = 1,
}

export enum OrderType {
  BUY = 0,
  SELL = 1,
}

// Order type from contract
export interface ContractOrder {
  orderId: bigint
  wordId: bigint
  maker: string
  outcome: Outcome
  orderType: OrderType
  price: bigint
  amount: bigint
  filled: bigint
  cancelled: boolean
}

