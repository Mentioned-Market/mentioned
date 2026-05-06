use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::MarketAccount;
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = market.authority == authority.key() @ AmmError::NotAuthority,
    )]
    pub market: Box<Account<'info, MarketAccount>>,

    /// Market's USDC vault — source of accumulated fees
    #[account(
        mut,
        constraint = vault.mint == market.usdc_mint @ AmmError::InvalidVault,
        constraint = vault.owner == market.key() @ AmmError::InvalidVault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Authority's USDC token account — receives the fees
    #[account(
        mut,
        constraint = authority_usdc.owner == authority.key() @ AmmError::NotOwner,
        constraint = authority_usdc.mint == market.usdc_mint @ AmmError::InvalidUsdcMint,
    )]
    pub authority_usdc: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
    let fees = ctx.accounts.market.accumulated_fees;
    require!(fees > 0, AmmError::NoFeesToWithdraw);

    // Guard: vault must hold at least the fee amount
    require!(
        ctx.accounts.vault.amount >= fees,
        AmmError::InsufficientBalance
    );

    // Transfer fees from vault to authority using market PDA as signer
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let signer_seeds: &[&[u8]] = &[b"market", market_id_bytes.as_ref(), &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.authority_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[signer_seeds],
        ),
        fees,
    )?;

    // Reset accumulated fees
    ctx.accounts.market.accumulated_fees = 0;

    emit!(FeesWithdrawnEvent {
        market_id: ctx.accounts.market.market_id,
        authority: ctx.accounts.authority.key(),
        amount: fees,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Withdrew {} USDC base units in fees from market {}",
        fees,
        ctx.accounts.market.market_id,
    );
    Ok(())
}

#[event]
pub struct FeesWithdrawnEvent {
    pub market_id: u64,
    pub authority: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}
