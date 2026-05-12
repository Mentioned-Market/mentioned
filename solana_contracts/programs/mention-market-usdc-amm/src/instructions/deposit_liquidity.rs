use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};
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
        // M1: Only the market authority can provide liquidity. Open deposits allow
        // anyone to rescale b mid-market, creating MEV and LP-dilution vectors.
        constraint = market.authority == lp_wallet.key() @ AmmError::NotAuthority,
    )]
    pub market: Box<Account<'info, MarketAccount>>,

    /// Market's USDC vault — must be owned by the market PDA and hold market's USDC
    #[account(
        mut,
        constraint = vault.mint == market.usdc_mint @ AmmError::InvalidVault,
        constraint = vault.owner == market.key() @ AmmError::InvalidVault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// LP's USDC token account — source of funds
    #[account(
        mut,
        constraint = lp_usdc.owner == lp_wallet.key() @ AmmError::NotOwner,
        constraint = lp_usdc.mint == market.usdc_mint @ AmmError::InvalidUsdcMint,
    )]
    pub lp_usdc: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = lp_wallet,
        space = 8 + LpPosition::SIZE,
        seeds = [b"lp", market.market_id.to_le_bytes().as_ref(), lp_wallet.key().as_ref()],
        bump,
    )]
    pub lp_position: Account<'info, LpPosition>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64) -> Result<()> {
    require!(amount > 0, AmmError::ZeroAmount);

    // Snapshot vault balance before the deposit for share math
    let vault_balance_before = ctx.accounts.vault.amount;

    // Transfer USDC from LP wallet to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.lp_usdc.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.lp_wallet.to_account_info(),
            },
        ),
        amount,
    )?;

    // Vault balance after deposit (computed manually — Anchor reloads on account exit,
    // but we need the value now for b-scaling)
    let vault_balance_after = vault_balance_before
        .checked_add(amount)
        .ok_or(AmmError::MathOverflow)?;

    // C2: Fixed-b solvency check. Dynamic-b markets are safe by construction (b <= vault
    // when base_b_per_usdc <= PRECISION, enforced at create_market). For fixed-b markets
    // the vault must hold at least b * ln(2) ≈ b * 693_148 / 1_000_000 USDC so that the
    // worst-case LP loss is fully covered and 1:1 redemptions remain solvent.
    if ctx.accounts.market.base_b_per_usdc == 0 {
        let b = ctx.accounts.market.liquidity_param_b;
        let min_vault = (b as u128)
            .checked_mul(693_148u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(PRECISION as u128)
            .ok_or(AmmError::MathOverflow)? as u64;
        require!(vault_balance_after >= min_vault, AmmError::InsufficientLiquidityForB);
    }

    // Capture values before mutable borrows
    let market_key = ctx.accounts.market.key();
    let lp_wallet_key = ctx.accounts.lp_wallet.key();
    let lp_bump = ctx.bumps.lp_position;
    let clock = Clock::get()?;

    // Calculate LP shares to issue
    let shares = if ctx.accounts.market.total_lp_shares == 0 || vault_balance_before == 0 {
        // First depositor: shares = amount (1:1)
        amount
    } else {
        (amount as u128)
            .checked_mul(ctx.accounts.market.total_lp_shares as u128)
            .ok_or(AmmError::MathOverflow)?
            .checked_div(vault_balance_before as u128)
            .ok_or(AmmError::MathOverflow)? as u64
    };

    // Update market state
    let market = &mut ctx.accounts.market;

    market.total_lp_shares = market
        .total_lp_shares
        .checked_add(shares)
        .ok_or(AmmError::MathOverflow)?;

    // Scale b dynamically: b = base_b_per_usdc * vault_balance / PRECISION
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
        usdc_amount: amount,
        shares,
        new_pool_balance: vault_balance_after,
        new_b,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "LP deposited {} USDC base units, received {} shares. Pool b={}",
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
    pub usdc_amount: u64,
    pub shares: u64,
    pub new_pool_balance: u64,
    pub new_b: u64,
    pub timestamp: i64,
}
