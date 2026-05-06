use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{MarketAccount, Side};
use crate::errors::AmmError;

#[derive(Accounts)]
#[instruction(word_index: u8)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    #[account(mut)]
    pub market: Box<Account<'info, MarketAccount>>,

    /// Market's USDC vault — source of payout
    #[account(
        mut,
        constraint = vault.mint == market.usdc_mint @ AmmError::InvalidVault,
        constraint = vault.owner == market.key() @ AmmError::InvalidVault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Redeemer's USDC token account — receives 1:1 USDC payout
    #[account(
        mut,
        constraint = redeemer_usdc.owner == redeemer.key() @ AmmError::NotOwner,
        constraint = redeemer_usdc.mint == market.usdc_mint @ AmmError::InvalidUsdcMint,
    )]
    pub redeemer_usdc: Account<'info, TokenAccount>,

    /// The winning token's mint
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    /// Redeemer's token account holding the winning tokens to burn
    #[account(
        mut,
        constraint = redeemer_token_account.owner == redeemer.key() @ AmmError::NotOwner,
        constraint = redeemer_token_account.mint == token_mint.key() @ AmmError::WrongMint,
    )]
    pub redeemer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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

    // Direction must match the winning side
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
        AmmError::WrongMint
    );

    // Get token balance to redeem
    let token_amount = ctx.accounts.redeemer_token_account.amount;
    require!(token_amount > 0, AmmError::NothingToRedeem);

    // 1:1 payout: 1 winning token (1_000_000 base units) = 1 USDC (1_000_000 base units)
    // Both YES/NO tokens and USDC use 6 decimals, so base units are equal.
    let payout = token_amount;

    // Burn all winning tokens (redeemer is authority)
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.token_mint.to_account_info(),
                from: ctx.accounts.redeemer_token_account.to_account_info(),
                authority: ctx.accounts.redeemer.to_account_info(),
            },
        ),
        token_amount,
    )?;

    // Transfer USDC payout from vault to redeemer using market PDA as signer
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let signer_seeds: &[&[u8]] = &[b"market", market_id_bytes.as_ref(), &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.redeemer_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[signer_seeds],
        ),
        payout,
    )?;

    emit!(RedemptionEvent {
        market_id: market.market_id,
        word_index,
        direction,
        tokens_burned: token_amount,
        usdc_paid: payout,
        redeemer: ctx.accounts.redeemer.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Redeemed {} tokens for word {} — payout: {} USDC base units",
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
    pub usdc_paid: u64,
    pub redeemer: Pubkey,
    pub timestamp: i64,
}
