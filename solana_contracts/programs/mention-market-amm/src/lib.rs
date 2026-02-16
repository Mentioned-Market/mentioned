use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::Side;

declare_id!("2oKQaiKx3C2qpkqFYGDdvEGTyBDJP85iuQtJ5vaPdFrU");

#[program]
pub mod mention_market_amm {
    use super::*;

    // === Escrow ===

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, amount)
    }

    // === Market Admin ===

    pub fn create_market<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateMarket<'info>>,
        market_id: u64,
        label: String,
        word_labels: Vec<String>,
        resolves_at: i64,
        resolver: Pubkey,
        trade_fee_bps: u16,
        initial_b: u64,
        base_b_per_sol: u64,
    ) -> Result<()> {
        instructions::create_market::handle_create_market(
            ctx,
            market_id,
            label,
            word_labels,
            resolves_at,
            resolver,
            trade_fee_bps,
            initial_b,
            base_b_per_sol,
        )
    }

    pub fn pause_market(ctx: Context<PauseMarket>) -> Result<()> {
        instructions::pause_market::handle_pause_market(ctx)
    }

    // === Liquidity ===

    pub fn deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64) -> Result<()> {
        instructions::deposit_liquidity::handle_deposit_liquidity(ctx, amount)
    }

    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>, shares_to_burn: u64) -> Result<()> {
        instructions::withdraw_liquidity::handle_withdraw_liquidity(ctx, shares_to_burn)
    }

    // === Trading ===

    pub fn buy(
        ctx: Context<Buy>,
        word_index: u8,
        direction: Side,
        quantity: u64,
        max_cost: u64,
    ) -> Result<()> {
        instructions::buy::handle_buy(ctx, word_index, direction, quantity, max_cost)
    }

    pub fn sell(
        ctx: Context<Sell>,
        word_index: u8,
        direction: Side,
        quantity: u64,
        min_return: u64,
    ) -> Result<()> {
        instructions::sell::handle_sell(ctx, word_index, direction, quantity, min_return)
    }

    // === Resolution ===

    pub fn resolve_word(
        ctx: Context<ResolveWord>,
        word_index: u8,
        outcome: bool,
    ) -> Result<()> {
        instructions::resolve_word::handle_resolve_word(ctx, word_index, outcome)
    }

    pub fn redeem(
        ctx: Context<Redeem>,
        word_index: u8,
        direction: Side,
    ) -> Result<()> {
        instructions::redeem::handle_redeem(ctx, word_index, direction)
    }
}
