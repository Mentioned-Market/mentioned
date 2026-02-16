use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{MarketAccount, MarketStatus, LpPosition, LpAction};
use crate::errors::AmmError;
use crate::math::PRECISION;

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(mut)]
    pub lp_wallet: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Open @ AmmError::MarketNotOpen,
    )]
    pub market: Box<Account<'info, MarketAccount>>,

    /// CHECK: PDA vault holding native SOL
    #[account(
        mut,
        seeds = [b"vault", market.market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = lp_wallet,
        space = 8 + LpPosition::SIZE,
        seeds = [b"lp", market.market_id.to_le_bytes().as_ref(), lp_wallet.key().as_ref()],
        bump,
    )]
    pub lp_position: Account<'info, LpPosition>,

    pub system_program: Program<'info, System>,
}

pub fn handle_deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64) -> Result<()> {
    require!(amount > 0, AmmError::ZeroAmount);

    // Transfer SOL from LP wallet to vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.lp_wallet.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;

    // Capture values before mutable borrows
    let market_key = ctx.accounts.market.key();
    let lp_wallet_key = ctx.accounts.lp_wallet.key();
    let vault_lamports_now = ctx.accounts.vault.lamports();
    let lp_bump = ctx.bumps.lp_position;
    let clock = Clock::get()?;

    // Calculate vault balance before our deposit (we already transferred)
    let vault_balance_before = vault_lamports_now
        .checked_sub(amount)
        .ok_or(AmmError::MathOverflow)?;

    // Update market state
    let market = &mut ctx.accounts.market;

    let shares = if market.total_lp_shares == 0 || vault_balance_before == 0 {
        amount
    } else {
        (amount as u128)
            .checked_mul(market.total_lp_shares as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(vault_balance_before as u128)
            .ok_or(AmmError::MathOverflow)? as u64
    };

    market.total_lp_shares = market
        .total_lp_shares
        .checked_add(shares)
        .ok_or(AmmError::MathOverflow)?;

    // Scale b dynamically: b = base_b_per_sol * vault_balance / 1e9
    if market.base_b_per_sol > 0 {
        market.liquidity_param_b = (market.base_b_per_sol as u128)
            .checked_mul(vault_lamports_now as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(PRECISION as u128)
            .ok_or(AmmError::MathOverflow)? as u64;
    }

    let market_id = market.market_id;
    let new_b = market.liquidity_param_b;

    // Update LP position
    let lp = &mut ctx.accounts.lp_position;
    lp.version = 1;
    lp.bump = lp_bump;
    lp.market = market_key;
    lp.owner = lp_wallet_key;
    lp.shares = lp.shares.checked_add(shares).ok_or(AmmError::MathOverflow)?;
    lp.deposited_at = clock.unix_timestamp;

    emit!(LiquidityEvent {
        market_id,
        provider: lp_wallet_key,
        action: LpAction::Deposit,
        sol_amount: amount,
        shares,
        new_pool_balance: vault_lamports_now,
        new_b,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "LP deposited {} lamports, received {} shares. Pool b={}",
        amount,
        shares,
        new_b
    );
    Ok(())
}

#[event]
pub struct LiquidityEvent {
    pub market_id: u64,
    pub provider: Pubkey,
    pub action: LpAction,
    pub sol_amount: u64,
    pub shares: u64,
    pub new_pool_balance: u64,
    pub new_b: u64,
    pub timestamp: i64,
}
