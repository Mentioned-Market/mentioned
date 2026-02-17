use anchor_lang::prelude::*;
use crate::state::{MarketAccount, MarketStatus};
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct PauseMarket<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = market.authority == authority.key() @ AmmError::UnauthorizedAuthority,
    )]
    pub market: Box<Account<'info, MarketAccount>>,
}

pub fn handle_pause_market(ctx: Context<PauseMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    let paused = match market.status {
        MarketStatus::Open => {
            market.status = MarketStatus::Paused;
            msg!("Market {} paused", market.market_id);
            true
        }
        MarketStatus::Paused => {
            market.status = MarketStatus::Open;
            msg!("Market {} unpaused", market.market_id);
            false
        }
        MarketStatus::Resolved => {
            return err!(AmmError::MarketAlreadyResolved);
        }
    };

    emit!(MarketPausedEvent {
        market_id: market.market_id,
        paused,
        authority: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

#[event]
pub struct MarketPausedEvent {
    pub market_id: u64,
    pub paused: bool,
    pub authority: Pubkey,
    pub timestamp: i64,
}
