use anchor_lang::prelude::*;

/// Maximum number of words per market
pub const MAX_WORDS: usize = 8;
/// Maximum length for a word label
pub const MAX_WORD_LABEL: usize = 32;
/// Maximum length for a market label
pub const MAX_MARKET_LABEL: usize = 64;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Paused,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum LpAction {
    Deposit,
    Withdraw,
}

// ---------------------------------------------------------------------------
// WordState — embedded inside MarketAccount
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct WordState {
    /// Index within the market (0-7)
    pub word_index: u8,
    /// The word itself (max 32 chars)
    pub label: String,
    /// SPL token mint for YES tokens
    pub yes_mint: Pubkey,
    /// SPL token mint for NO tokens
    pub no_mint: Pubkey,
    /// Net YES tokens outstanding (fixed-point, scaled by 1e9)
    pub yes_quantity: i64,
    /// Net NO tokens outstanding (fixed-point, scaled by 1e9)
    pub no_quantity: i64,
    /// None = unresolved, Some(true) = mentioned, Some(false) = not mentioned
    pub outcome: Option<bool>,
    /// Per-word extension space
    pub _reserved: [u8; 32],
}

impl WordState {
    /// 1 (word_index) + (4 + 32) (label) + 32 (yes_mint) + 32 (no_mint)
    /// + 8 (yes_quantity) + 8 (no_quantity) + (1 + 1) (option<bool>) + 32 (reserved)
    pub const SIZE: usize = 1 + (4 + MAX_WORD_LABEL) + 32 + 32 + 8 + 8 + 2 + 32;
}

// ---------------------------------------------------------------------------
// MarketAccount — one per market
// ---------------------------------------------------------------------------

#[account]
pub struct MarketAccount {
    // -- Header --
    /// Schema version (start at 1)
    pub version: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Numeric market ID (used in PDAs and frontend URLs)
    pub market_id: u64,
    /// Human-readable name, max 64 chars
    pub label: String,

    // -- Authority & Config --
    /// Market creator / admin
    pub authority: Pubkey,
    /// Address authorized to resolve outcomes
    pub resolver: Pubkey,
    /// V2: authorized router program (None in v1)
    pub router: Option<Pubkey>,

    // -- Pool State --
    /// PDA-controlled native SOL vault pubkey
    pub pool_vault: Pubkey,
    /// Vault PDA bump
    pub vault_bump: u8,
    /// Total outstanding LP share tokens
    pub total_lp_shares: u64,
    /// LMSR 'b' parameter (fixed-point, scaled by 1e9)
    pub liquidity_param_b: u64,
    /// How much 'b' increases per SOL deposited
    pub base_b_per_sol: u64,

    // -- Word Sub-Markets --
    /// Number of words (max 8)
    pub num_words: u8,
    /// Fixed array of word states
    pub words: [WordState; MAX_WORDS],

    // -- Market Lifecycle --
    /// Current status
    pub status: MarketStatus,
    /// Unix timestamp of creation
    pub created_at: i64,
    /// Scheduled resolution time
    pub resolves_at: i64,
    /// Actual resolution time
    pub resolved_at: Option<i64>,

    // -- Fees --
    /// Fee on each trade in basis points (e.g., 50 = 0.5%)
    pub trade_fee_bps: u16,
    /// Portion of trade fee going to protocol
    pub protocol_fee_bps: u16,
    /// Fees collected, withdrawable by protocol
    pub accumulated_fees: u64,

    // -- V2 Extension Space --
    pub _reserved: [u8; 256],
}

impl MarketAccount {
    /// Header: 1 + 1 + 8 + (4 + 64) = 78
    /// Auth: 32 + 32 + (1 + 32) = 97  (Option<Pubkey>)
    /// Pool: 32 + 1 + 8 + 8 + 8 = 57
    /// Words: 1 + (8 × WordState::SIZE)
    /// Lifecycle: 1 + 8 + 8 + (1 + 8) = 26  (Option<i64>)
    /// Fees: 2 + 2 + 8 = 12
    /// Reserved: 256
    pub const SIZE: usize = 78 + 97 + 57 + 1 + (MAX_WORDS * WordState::SIZE) + 26 + 12 + 256;
}
