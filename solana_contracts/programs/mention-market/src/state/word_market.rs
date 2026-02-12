use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MarketStatus {
    Active,
    Paused,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Outcome {
    Yes,
    No,
}

#[account]
pub struct WordMarket {
    /// Admin authority that can pause/resolve this market
    pub authority: Pubkey,
    /// Unique market identifier
    pub market_id: u64,
    /// Index of this word within the market group
    pub word_index: u16,
    /// The word this market is about (e.g. "economy"), max 32 chars
    pub label: String,
    /// SPL token mint for YES shares
    pub yes_mint: Pubkey,
    /// SPL token mint for NO shares
    pub no_mint: Pubkey,
    /// PDA that holds collateral SOL
    pub vault: Pubkey,
    /// Total lamports locked as collateral
    pub total_collateral: u64,
    /// Current market status
    pub status: MarketStatus,
    /// Resolution outcome — None until resolved
    pub outcome: Option<Outcome>,
    /// PDA bump seed
    pub bump: u8,
    /// Vault PDA bump seed
    pub vault_bump: u8,
}

impl WordMarket {
    /// 32 (authority) + 8 (market_id) + 2 (word_index) + (4 + 32) (label string)
    /// + 32 (yes_mint) + 32 (no_mint) + 32 (vault) + 8 (total_collateral)
    /// + 1 (status enum) + 2 (option + outcome enum) + 1 (bump) + 1 (vault_bump)
    pub const SIZE: usize = 32 + 8 + 2 + (4 + 32) + 32 + 32 + 32 + 8 + 1 + 2 + 1 + 1;
}
