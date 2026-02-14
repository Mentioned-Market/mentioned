use anchor_lang::prelude::*;

#[error_code]
pub enum MentionMarketError {
    // General
    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    // Withdraw
    #[msg("Insufficient unlocked balance")]
    InsufficientBalance,
    #[msg("Only the escrow owner can withdraw")]
    NotOwner,

    // Create market
    #[msg("Label must be 32 characters or fewer")]
    LabelTooLong,

    // Pause / resolve
    #[msg("Only the market authority can perform this action")]
    UnauthorizedAuthority,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Market is already resolved")]
    MarketAlreadyResolved,

    // Settle match
    #[msg("Insufficient balance for YES buyer")]
    InsufficientYesFunds,
    #[msg("Insufficient balance for NO buyer")]
    InsufficientNoFunds,
    #[msg("Price must be between 0 and 1 SOL (exclusive)")]
    InvalidPrice,
    #[msg("Arithmetic overflow")]
    MathOverflow,

    // Claim
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("No winning tokens to claim")]
    NothingToClaim,

    // Stub
    #[msg("Not yet implemented")]
    NotImplemented,
}
