use anchor_lang::prelude::*;
use crate::state::{WordMarket, MarketStatus};
use crate::errors::MentionMarketError;

#[derive(Accounts)]
pub struct PauseMarket<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = word_market.authority == authority.key() @ MentionMarketError::UnauthorizedAuthority,
    )]
    pub word_market: Account<'info, WordMarket>,
}

pub fn handle_pause_market(ctx: Context<PauseMarket>) -> Result<()> {
    let word_market = &mut ctx.accounts.word_market;

    require!(
        word_market.status == MarketStatus::Active,
        MentionMarketError::MarketNotActive
    );

    word_market.status = MarketStatus::Paused;

    msg!("Market paused: {}", word_market.label);
    Ok(())
}
