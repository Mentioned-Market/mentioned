use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount};
use crate::state::{WordMarket, MarketStatus, Outcome};
use crate::errors::MentionMarketError;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub word_market: Account<'info, WordMarket>,

    #[account(
        mut,
        token::mint = yes_mint,
        token::authority = user,
    )]
    pub user_yes_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = no_mint,
        token::authority = user,
    )]
    pub user_no_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = yes_mint.key() == word_market.yes_mint,
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = no_mint.key() == word_market.no_mint,
    )]
    pub no_mint: Account<'info, Mint>,

    /// CHECK: SOL vault PDA
    #[account(
        mut,
        seeds = [b"vault", word_market.key().as_ref()],
        bump = word_market.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_claim(ctx: Context<Claim>) -> Result<()> {
    // 1. Market must be Resolved
    require!(
        ctx.accounts.word_market.status == MarketStatus::Resolved,
        MentionMarketError::MarketNotResolved
    );

    // 2. Determine winning side
    let outcome = ctx.accounts.word_market.outcome.clone()
        .ok_or(MentionMarketError::MarketNotResolved)?;

    // 3. Get winning token balance and accounts
    let (winning_balance, winning_token, winning_mint) = match outcome {
        Outcome::Yes => (
            ctx.accounts.user_yes_account.amount,
            ctx.accounts.user_yes_account.to_account_info(),
            ctx.accounts.yes_mint.to_account_info(),
        ),
        Outcome::No => (
            ctx.accounts.user_no_account.amount,
            ctx.accounts.user_no_account.to_account_info(),
            ctx.accounts.no_mint.to_account_info(),
        ),
    };

    // 4. Must have winning tokens to claim
    require!(winning_balance > 0, MentionMarketError::NothingToClaim);

    // 5. Calculate payout: 6-decimal tokens -> 9-decimal lamports
    //    1 full token (1_000_000 base units) = 1 SOL (1_000_000_000 lamports)
    //    payout = winning_balance * 1000
    let payout = winning_balance
        .checked_mul(1_000)
        .ok_or(MentionMarketError::MathOverflow)?;

    // 6. Burn winning tokens (user is authority over their token account)
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: winning_mint,
                from: winning_token,
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        winning_balance,
    )?;

    // 7. Transfer SOL from vault to user (vault PDA signs via invoke_signed)
    let wm_key = ctx.accounts.word_market.key();
    let vault_bump = ctx.accounts.word_market.vault_bump;
    let vault_seeds: &[&[&[u8]]] = &[&[
        b"vault",
        wm_key.as_ref(),
        &[vault_bump],
    ]];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            vault_seeds,
        ),
        payout,
    )?;

    // 8. Decrement total collateral
    ctx.accounts.word_market.total_collateral = ctx
        .accounts
        .word_market
        .total_collateral
        .checked_sub(payout)
        .ok_or(MentionMarketError::MathOverflow)?;

    msg!("Claimed {} lamports (burned {} tokens)", payout, winning_balance);

    Ok(())
}
