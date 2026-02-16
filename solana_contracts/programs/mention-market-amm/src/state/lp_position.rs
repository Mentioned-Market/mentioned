use anchor_lang::prelude::*;

#[account]
pub struct LpPosition {
    /// Schema version
    pub version: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Parent market account
    pub market: Pubkey,
    /// LP's wallet
    pub owner: Pubkey,
    /// Number of LP shares held
    pub shares: u64,
    /// Timestamp of last deposit
    pub deposited_at: i64,
    /// Reserved for future use
    pub _reserved: [u8; 64],
}

impl LpPosition {
    /// 1 + 1 + 32 + 32 + 8 + 8 + 64 = 146
    pub const SIZE: usize = 1 + 1 + 32 + 32 + 8 + 8 + 64;
}
