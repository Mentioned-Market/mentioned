use anchor_lang::prelude::*;

#[error_code]
pub enum AmmError {
    // General
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,

    // Escrow
    #[msg("Insufficient unlocked balance")]
    InsufficientBalance,
    #[msg("Only the escrow owner can perform this action")]
    NotOwner,

    // Market creation
    #[msg("Market label must be 64 characters or fewer")]
    MarketLabelTooLong,
    #[msg("Word label must be 32 characters or fewer")]
    WordLabelTooLong,
    #[msg("Too many words (max 8)")]
    TooManyWords,
    #[msg("Must provide at least one word")]
    NoWords,

    // Market status
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Market is already resolved")]
    MarketAlreadyResolved,
    #[msg("Only the market authority can perform this action")]
    UnauthorizedAuthority,
    #[msg("Only the resolver can resolve outcomes")]
    UnauthorizedResolver,

    // Trading
    #[msg("Invalid word index")]
    InvalidWordIndex,
    #[msg("Cost exceeds max_cost slippage limit")]
    SlippageExceeded,
    #[msg("Return is below min_return slippage limit")]
    SlippageBelowMin,
    #[msg("Insufficient token balance to sell")]
    InsufficientTokens,

    // Liquidity
    #[msg("Liquidity parameter b is zero")]
    ZeroLiquidity,
    #[msg("Insufficient LP shares")]
    InsufficientShares,
    #[msg("Pool has no balance")]
    EmptyPool,

    // Resolution
    #[msg("Word is not yet resolved")]
    WordNotResolved,
    #[msg("Word is already resolved")]
    WordAlreadyResolved,
    #[msg("Direction does not match winning outcome")]
    NotWinningDirection,
    #[msg("No tokens to redeem")]
    NothingToRedeem,
    #[msg("Liquidity is locked until market is resolved")]
    MarketNotResolved,
}
