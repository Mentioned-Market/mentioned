use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{MarketAccount, UserEscrow, Side};
use crate::errors::AmmError;

#[derive(Accounts)]
#[instruction(word_index: u8)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", trader.key().as_ref()],
        bump = trader_escrow.bump,
        constraint = trader_escrow.owner == trader.key() @ AmmError::NotOwner,
    )]
    pub trader_escrow: Account<'info, UserEscrow>,

    #[account(mut)]
    pub market: Box<Account<'info, MarketAccount>>,

    /// CHECK: PDA vault holding native SOL
    #[account(
        mut,
        seeds = [b"vault", market.market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    /// The winning token's mint
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    /// Trader's token account holding the winning tokens
    #[account(
        mut,
        constraint = trader_token_account.owner == trader.key(),
        constraint = trader_token_account.mint == token_mint.key(),
    )]
    pub trader_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_redeem(
    ctx: Context<Redeem>,
    word_index: u8,
    direction: Side,
) -> Result<()> {
    let market = &ctx.accounts.market;
    require!(
        (word_index as usize) < market.num_words as usize,
        AmmError::InvalidWordIndex
    );

    let word = &market.words[word_index as usize];

    // Word must be resolved
    let outcome = word.outcome.ok_or(AmmError::WordNotResolved)?;

    // Direction must match winning side
    let is_winner = match direction {
        Side::Yes => outcome == true,
        Side::No => outcome == false,
    };
    require!(is_winner, AmmError::NotWinningDirection);

    // Verify mint matches direction
    let expected_mint = match direction {
        Side::Yes => word.yes_mint,
        Side::No => word.no_mint,
    };
    require!(
        ctx.accounts.token_mint.key() == expected_mint,
        AmmError::InvalidWordIndex
    );

    // Get token balance
    let token_amount = ctx.accounts.trader_token_account.amount;
    require!(token_amount > 0, AmmError::NothingToRedeem);

    // Payout: 1 SOL (1e9 lamports) per token (tokens have 9 decimals, so 1 token = 1e9 base units)
    // token_amount is already in base units (1e9 per full token)
    // So payout = token_amount lamports (1 base unit = 1 lamport)
    let payout = token_amount;

    // Burn all tokens
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.token_mint.to_account_info(),
                from: ctx.accounts.trader_token_account.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        token_amount,
    )?;

    // Transfer payout from vault PDA to escrow PDA via CPI
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let vault_bump = ctx.accounts.market.vault_bump;
    let vault_seeds: &[&[u8]] = &[b"vault", market_id_bytes.as_ref(), &[vault_bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.trader_escrow.to_account_info(),
            },
            &[vault_seeds],
        ),
        payout,
    )?;

    // Credit escrow balance
    let escrow = &mut ctx.accounts.trader_escrow;
    escrow.balance = escrow.balance.checked_add(payout).ok_or(AmmError::MathOverflow)?;

    emit!(RedemptionEvent {
        market_id: market.market_id,
        word_index,
        direction,
        tokens_burned: token_amount,
        sol_paid: payout,
        redeemer: ctx.accounts.trader.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Redeemed {} tokens for word {} — payout: {} lamports",
        token_amount,
        word_index,
        payout,
    );
    Ok(())
}

#[event]
pub struct RedemptionEvent {
    pub market_id: u64,
    pub word_index: u8,
    pub direction: Side,
    pub tokens_burned: u64,
    pub sol_paid: u64,
    pub redeemer: Pubkey,
    pub timestamp: i64,
}
