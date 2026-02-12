use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::Outcome;

declare_id!("AJ4XSwJoh2C8vmd8U7xhpzMkzkZZPaBRpbfpkmm4DmeN");

#[program]
pub mod mention_market {
    use super::*;

    // === User instructions ===

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, amount)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handle_claim(ctx)
    }

    // === Admin instructions ===

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        word_index: u16,
        label: String,
    ) -> Result<()> {
        instructions::create_market::handle_create_market(ctx, market_id, word_index, label)
    }

    pub fn pause_market(ctx: Context<PauseMarket>) -> Result<()> {
        instructions::pause_market::handle_pause_market(ctx)
    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, outcome: Outcome) -> Result<()> {
        instructions::resolve_market::handle_resolve_market(ctx, outcome)
    }

    // === Backend instruction ===

    pub fn settle_match(ctx: Context<SettleMatch>, price: u64, amount: u64) -> Result<()> {
        instructions::settle_match::handle_settle_match(ctx, price, amount)
    }
}
