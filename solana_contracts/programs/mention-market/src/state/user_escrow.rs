use anchor_lang::prelude::*;

#[account]
pub struct UserEscrow {
    /// The user's wallet address (owner of this escrow)
    pub owner: Pubkey,
    /// Available lamports — can be used for new orders or withdrawn
    pub balance: u64,
    /// Lamports committed to open orders — cannot be withdrawn
    pub locked: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl UserEscrow {
    /// 32 (owner) + 8 (balance) + 8 (locked) + 1 (bump)
    pub const SIZE: usize = 32 + 8 + 8 + 1;
}
