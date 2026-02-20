use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{MarketAccount, MarketStatus, LpPosition, LpAction};
use crate::errors::AmmError;
use crate::math::PRECISION;

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut)]
    pub lp_wallet: Signer<'info>,

    #[account(mut)]
    pub market: Box<Account<'info, MarketAccount>>,

    /// CHECK: PDA vault holding native SOL
    #[account(
        mut,
        seeds = [b"vault", market.market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"lp", market.market_id.to_le_bytes().as_ref(), lp_wallet.key().as_ref()],
        bump = lp_position.bump,
        constraint = lp_position.owner == lp_wallet.key() @ AmmError::NotOwner,
    )]
    pub lp_position: Account<'info, LpPosition>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw_liquidity(ctx: Context<WithdrawLiquidity>, shares_to_burn: u64) -> Result<()> {
    require!(shares_to_burn > 0, AmmError::ZeroAmount);

    let market = &ctx.accounts.market;
    require!(market.status == MarketStatus::Resolved, AmmError::MarketNotResolved);

    let lp = &ctx.accounts.lp_position;
    require!(lp.shares >= shares_to_burn, AmmError::InsufficientShares);
    require!(market.total_lp_shares > 0, AmmError::EmptyPool);

    // Calculate SOL to return: shares_to_burn * vault_balance / total_lp_shares
    let vault_balance = ctx.accounts.vault.lamports();
    let sol_out = (shares_to_burn as u128)
        .checked_mul(vault_balance as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(market.total_lp_shares as u128)
        .ok_or(AmmError::MathOverflow)? as u64;

    require!(sol_out > 0, AmmError::ZeroAmount);

    // Transfer SOL from vault PDA to LP wallet via CPI
    let market_id_bytes = market.market_id.to_le_bytes();
    let vault_bump = market.vault_bump;
    let vault_seeds: &[&[u8]] = &[b"vault", market_id_bytes.as_ref(), &[vault_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.lp_wallet.to_account_info(),
            },
            &[vault_seeds],
        ),
        sol_out,
    )?;

    // Update market
    let market = &mut ctx.accounts.market;
    market.total_lp_shares = market
        .total_lp_shares
        .checked_sub(shares_to_burn)
        .ok_or(AmmError::MathOverflow)?;

    // Rescale b
    if market.base_b_per_sol > 0 {
        let new_vault_balance = ctx.accounts.vault.lamports();
        market.liquidity_param_b = (market.base_b_per_sol as u128)
            .checked_mul(new_vault_balance as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(PRECISION as u128)
            .ok_or(AmmError::MathOverflow)? as u64;
    }

    // Update LP position
    let lp = &mut ctx.accounts.lp_position;
    lp.shares = lp.shares.checked_sub(shares_to_burn).ok_or(AmmError::MathOverflow)?;

    emit!(super::deposit_liquidity::LiquidityEvent {
        market_id: market.market_id,
        provider: ctx.accounts.lp_wallet.key(),
        action: LpAction::Withdraw,
        sol_amount: sol_out,
        shares: shares_to_burn,
        new_pool_balance: ctx.accounts.vault.lamports(),
        new_b: market.liquidity_param_b,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "LP withdrew {} shares → {} lamports. Pool b={}",
        shares_to_burn,
        sol_out,
        market.liquidity_param_b
    );
    Ok(())
}
