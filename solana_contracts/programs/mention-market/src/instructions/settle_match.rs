use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::{WordMarket, UserEscrow};
use crate::errors::MentionMarketError;

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    /// Backend co-signer
    pub backend: Signer<'info>,

    #[account(mut)]
    pub word_market: Account<'info, WordMarket>,

    // --- YES buyer ---
    #[account(
        mut,
        seeds = [b"escrow", yes_buyer.key().as_ref()],
        bump = yes_buyer_escrow.bump,
    )]
    pub yes_buyer_escrow: Account<'info, UserEscrow>,

    /// CHECK: YES buyer wallet, validated by escrow seeds
    pub yes_buyer: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = yes_mint,
        token::authority = yes_buyer,
    )]
    pub yes_buyer_token_account: Account<'info, TokenAccount>,

    // --- NO buyer ---
    #[account(
        mut,
        seeds = [b"escrow", no_buyer.key().as_ref()],
        bump = no_buyer_escrow.bump,
    )]
    pub no_buyer_escrow: Account<'info, UserEscrow>,

    /// CHECK: NO buyer wallet, validated by escrow seeds
    pub no_buyer: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = no_mint,
        token::authority = no_buyer,
    )]
    pub no_buyer_token_account: Account<'info, TokenAccount>,

    // --- Mints ---
    #[account(
        mut,
        constraint = yes_mint.key() == word_market.yes_mint,
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = no_mint.key() == word_market.no_mint,
    )]
    pub no_mint: Account<'info, Mint>,

    // --- Vault ---
    /// CHECK: SOL vault PDA
    #[account(
        mut,
        seeds = [b"vault", word_market.key().as_ref()],
        bump = word_market.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_settle_match(
    _ctx: Context<SettleMatch>,
    _price: u64,
    _amount: u64,
) -> Result<()> {
    // TODO: Implement settlement logic
    msg!("settle_match: not yet implemented");
    err!(MentionMarketError::NotImplemented)
}
