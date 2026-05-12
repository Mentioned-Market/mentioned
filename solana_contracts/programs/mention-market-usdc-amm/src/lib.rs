use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;
use state::Side;

// Placeholder — replace with actual program ID after `anchor deploy`
declare_id!("9kSuebrHKKnFsgFcv5fc8S2gBazHA9Gki2NEWt2ft9tk");

#[program]
pub mod mention_market_usdc_amm {
    use super::*;

    // === Market Admin ===

    /// Create a new USDC prediction market with word sub-markets.
    ///
    /// remaining_accounts: 4 accounts per word in order —
    ///   yes_mint (writable PDA), yes_metadata (writable), no_mint (writable PDA), no_metadata (writable)
    pub fn create_market<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateMarket<'info>>,
        market_id: u64,
        label: String,
        word_labels: Vec<String>,
        resolves_at: i64,
        resolver: Pubkey,
        trade_fee_bps: u16,
        initial_b: u64,
        base_b_per_usdc: u64,
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
            base_b_per_usdc,
        )
    }

    /// Toggle the market between Open and Paused states.
    /// Paused markets reject all buy/sell instructions.
    /// Only the market authority can call this.
    pub fn pause_market(ctx: Context<PauseMarket>) -> Result<()> {
        instructions::pause_market::handle_pause_market(ctx)
    }

    // === Liquidity ===

    /// Deposit USDC liquidity into the market vault.
    /// Issues LP shares proportional to the deposit.
    /// Only callable on Open markets.
    pub fn deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64) -> Result<()> {
        instructions::deposit_liquidity::handle_deposit_liquidity(ctx, amount)
    }

    /// Withdraw USDC liquidity proportional to LP shares burned.
    /// Only callable after the market is fully Resolved.
    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>, shares_to_burn: u64) -> Result<()> {
        instructions::withdraw_liquidity::handle_withdraw_liquidity(ctx, shares_to_burn)
    }

    // === Trading ===

    /// Buy YES or NO prediction tokens for a word.
    /// Transfers USDC directly from the trader's ATA to the vault.
    /// Enforces open status, slippage limit, and mints tokens to the trader.
    pub fn buy(
        ctx: Context<Buy>,
        word_index: u8,
        direction: Side,
        quantity: u64,
        max_cost: u64,
    ) -> Result<()> {
        instructions::buy::handle_buy(ctx, word_index, direction, quantity, max_cost)
    }

    /// Sell YES or NO prediction tokens for a word.
    /// Burns tokens, transfers USDC net-of-fee from vault to the trader's ATA.
    /// Enforces open status and min-return slippage.
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

    /// Resolver sets the outcome for a single word.
    /// When all words are resolved the market transitions to Resolved.
    pub fn resolve_word(
        ctx: Context<ResolveWord>,
        word_index: u8,
        outcome: bool,
    ) -> Result<()> {
        instructions::resolve_word::handle_resolve_word(ctx, word_index, outcome)
    }

    /// Redeem winning tokens for USDC at a 1:1 rate.
    /// Burns the winning token and transfers matching USDC from the vault.
    /// Market must be Resolved and direction must match the winning outcome.
    pub fn redeem(
        ctx: Context<Redeem>,
        word_index: u8,
        direction: Side,
    ) -> Result<()> {
        instructions::redeem::handle_redeem(ctx, word_index, direction)
    }

    // === Fee Management ===

    /// Withdraw all accumulated protocol fees from the vault to the authority's USDC ATA.
    /// Resets accumulated_fees to zero.
    /// Only the market authority can call this.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        instructions::withdraw_fees::handle_withdraw_fees(ctx)
    }
}
