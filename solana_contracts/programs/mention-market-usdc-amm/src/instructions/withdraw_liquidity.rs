use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
use crate::state::{MarketAccount, MarketStatus, LpPosition, LpAction};
use crate::errors::AmmError;
use crate::math::PRECISION;

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut)]
    pub lp_wallet: Signer<'info>,

    #[account(mut)]
    pub market: Box<Account<'info, MarketAccount>>,

    /// Market's USDC vault — source of funds
    #[account(
        mut,
        constraint = vault.mint == market.usdc_mint @ AmmError::InvalidVault,
        constraint = vault.owner == market.key() @ AmmError::InvalidVault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// LP's USDC token account — receives the withdrawn USDC
    #[account(
        mut,
        constraint = lp_usdc.owner == lp_wallet.key() @ AmmError::NotOwner,
        constraint = lp_usdc.mint == market.usdc_mint @ AmmError::InvalidUsdcMint,
    )]
    pub lp_usdc: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"lp", market.market_id.to_le_bytes().as_ref(), lp_wallet.key().as_ref()],
        bump = lp_position.bump,
        constraint = lp_position.owner == lp_wallet.key() @ AmmError::NotOwner,
    )]
    pub lp_position: Account<'info, LpPosition>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_liquidity(ctx: Context<WithdrawLiquidity>, shares_to_burn: u64) -> Result<()> {
    require!(shares_to_burn > 0, AmmError::ZeroAmount);

    let market = &ctx.accounts.market;
    require!(market.status == MarketStatus::Resolved, AmmError::MarketNotResolved);

    let lp = &ctx.accounts.lp_position;
    require!(lp.shares >= shares_to_burn, AmmError::InsufficientShares);
    require!(market.total_lp_shares > 0, AmmError::EmptyPool);

    // Calculate USDC to return: shares_to_burn * vault_balance / total_lp_shares
    let vault_balance = ctx.accounts.vault.amount;
    let usdc_out = (shares_to_burn as u128)
        .checked_mul(vault_balance as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(market.total_lp_shares as u128)
        .ok_or(AmmError::MathOverflow)? as u64;

    require!(usdc_out > 0, AmmError::ZeroAmount);

    // Transfer USDC from vault to LP wallet using market PDA as signer
    let market_id_bytes = market.market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[u8]] = &[b"market", market_id_bytes.as_ref(), &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.lp_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[signer_seeds],
        ),
        usdc_out,
    )?;

    // Compute vault balance after withdrawal for b-rescaling
    let vault_balance_after = vault_balance.saturating_sub(usdc_out);

    // Update market
    let market = &mut ctx.accounts.market;
    market.total_lp_shares = market
        .total_lp_shares
        .checked_sub(shares_to_burn)
        .ok_or(AmmError::MathOverflow)?;

    // Rescale b proportionally to remaining vault balance
    if market.base_b_per_usdc > 0 {
        market.liquidity_param_b = (market.base_b_per_usdc as u128)
            .checked_mul(vault_balance_after as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(PRECISION as u128)
            .ok_or(AmmError::MathOverflow)? as u64;
    }

    let market_id = market.market_id;
    let new_b = market.liquidity_param_b;

    // Update LP position
    let lp = &mut ctx.accounts.lp_position;
    lp.shares = lp.shares.checked_sub(shares_to_burn).ok_or(AmmError::MathOverflow)?;

    emit!(super::deposit_liquidity::LiquidityEvent {
        market_id,
        provider: ctx.accounts.lp_wallet.key(),
        action: LpAction::Withdraw,
        usdc_amount: usdc_out,
        shares: shares_to_burn,
        new_pool_balance: vault_balance_after,
        new_b,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "LP withdrew {} shares -> {} USDC base units. Pool b={}",
        shares_to_burn,
        usdc_out,
        new_b
    );
    Ok(())
}
