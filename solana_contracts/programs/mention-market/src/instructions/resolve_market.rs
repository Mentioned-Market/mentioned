use anchor_lang::prelude::*;
use crate::state::{WordMarket, MarketStatus, Outcome};
use crate::errors::MentionMarketError;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = word_market.authority == authority.key() @ MentionMarketError::UnauthorizedAuthority,
    )]
    pub word_market: Account<'info, WordMarket>,
}

pub fn handle_resolve_market(ctx: Context<ResolveMarket>, outcome: Outcome) -> Result<()> {
    let word_market = &mut ctx.accounts.word_market;

    require!(
        word_market.status != MarketStatus::Resolved,
        MentionMarketError::MarketAlreadyResolved
    );

    word_market.status = MarketStatus::Resolved;
    word_market.outcome = Some(outcome);

    msg!("Market resolved: {}", word_market.label);
    Ok(())
}
