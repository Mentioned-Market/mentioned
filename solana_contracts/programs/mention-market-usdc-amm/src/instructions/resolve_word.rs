use anchor_lang::prelude::*;
use crate::state::{MarketAccount, MarketStatus};
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct ResolveWord<'info> {
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.resolver == resolver.key() @ AmmError::NotResolver,
    )]
    pub market: Box<Account<'info, MarketAccount>>,
}

pub fn handle_resolve_word(
    ctx: Context<ResolveWord>,
    word_index: u8,
    outcome: bool,
) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(
        market.status != MarketStatus::Resolved,
        AmmError::MarketAlreadyResolved
    );
    require!(
        (word_index as usize) < market.num_words as usize,
        AmmError::InvalidWordIndex
    );
    require!(
        market.words[word_index as usize].outcome.is_none(),
        AmmError::WordAlreadyResolved
    );

    market.words[word_index as usize].outcome = Some(outcome);

    // Check if all words are now resolved — if so mark the whole market resolved
    let all_resolved = market.words[..market.num_words as usize]
        .iter()
        .all(|w| w.outcome.is_some());

    if all_resolved {
        market.status = MarketStatus::Resolved;
        market.resolved_at = Some(Clock::get()?.unix_timestamp);
        msg!("All words resolved — market {} fully resolved", market.market_id);
    }

    emit!(ResolutionEvent {
        market_id: market.market_id,
        word_index,
        outcome,
        resolver: ctx.accounts.resolver.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Word {} resolved: mentioned={}",
        word_index,
        outcome,
    );
    Ok(())
}

#[event]
pub struct ResolutionEvent {
    pub market_id: u64,
    pub word_index: u8,
    pub outcome: bool,
    pub resolver: Pubkey,
    pub timestamp: i64,
}
