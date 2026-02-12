use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::WordMarket;
use crate::errors::MentionMarketError;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub word_market: Account<'info, WordMarket>,

    #[account(
        mut,
        token::mint = yes_mint,
        token::authority = user,
    )]
    pub user_yes_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = no_mint,
        token::authority = user,
    )]
    pub user_no_account: Account<'info, TokenAccount>,

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

pub fn handle_claim(_ctx: Context<Claim>) -> Result<()> {
    // TODO: Implement claim logic
    msg!("claim: not yet implemented");
    err!(MentionMarketError::NotImplemented)
}
