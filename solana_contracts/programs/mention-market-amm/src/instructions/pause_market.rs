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

    match market.status {
        MarketStatus::Open => {
            market.status = MarketStatus::Paused;
            msg!("Market {} paused", market.market_id);
        }
        MarketStatus::Paused => {
            market.status = MarketStatus::Open;
            msg!("Market {} unpaused", market.market_id);
        }
        MarketStatus::Resolved => {
            return err!(AmmError::MarketAlreadyResolved);
        }
    }

    Ok(())
}
