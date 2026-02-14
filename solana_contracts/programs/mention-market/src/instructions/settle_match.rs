use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::state::{WordMarket, UserEscrow, MarketStatus};
use crate::errors::MentionMarketError;

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    /// Backend co-signer
    pub backend: Signer<'info>,

    #[account(mut)]
    pub word_market: Account<'info, WordMarket>,

    // --- YES buyer ---
    #[account(
        mut,
        seeds = [b"escrow", yes_buyer.key().as_ref()],
        bump = yes_buyer_escrow.bump,
    )]
    pub yes_buyer_escrow: Account<'info, UserEscrow>,

    /// CHECK: YES buyer wallet, validated by escrow seeds
    pub yes_buyer: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = yes_mint,
        token::authority = yes_buyer,
    )]
    pub yes_buyer_token_account: Account<'info, TokenAccount>,

    // --- NO buyer ---
    #[account(
        mut,
        seeds = [b"escrow", no_buyer.key().as_ref()],
        bump = no_buyer_escrow.bump,
    )]
    pub no_buyer_escrow: Account<'info, UserEscrow>,

    /// CHECK: NO buyer wallet, validated by escrow seeds
    pub no_buyer: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = no_mint,
        token::authority = no_buyer,
    )]
    pub no_buyer_token_account: Account<'info, TokenAccount>,

    // --- Mints ---
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

    // --- Vault ---
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

pub fn handle_settle_match(
    ctx: Context<SettleMatch>,
    price: u64,
    amount: u64,
) -> Result<()> {
    // 1. Market must be Active
    require!(
        ctx.accounts.word_market.status == MarketStatus::Active,
        MentionMarketError::MarketNotActive
    );

    // 2. Price must be between 0 and 1 SOL exclusive (in lamports)
    require!(
        price > 0 && price < 1_000_000_000,
        MentionMarketError::InvalidPrice
    );

    // 3. Amount must be > 0
    require!(amount > 0, MentionMarketError::ZeroAmount);

    // 4. Calculate costs
    //    price = lamports per 1 full token (1_000_000 base units, 6 decimals)
    //    yes_cost = price * amount / 1_000_000
    //    no_cost  = (1 SOL - price) * amount / 1_000_000
    let yes_cost = price
        .checked_mul(amount)
        .ok_or(MentionMarketError::MathOverflow)?
        / 1_000_000;
    let no_cost = (1_000_000_000u64 - price)
        .checked_mul(amount)
        .ok_or(MentionMarketError::MathOverflow)?
        / 1_000_000;

    // 5. Check escrow balances
    require!(
        ctx.accounts.yes_buyer_escrow.balance >= yes_cost,
        MentionMarketError::InsufficientYesFunds
    );
    require!(
        ctx.accounts.no_buyer_escrow.balance >= no_cost,
        MentionMarketError::InsufficientNoFunds
    );

    // 6. Deduct from escrow data balances
    ctx.accounts.yes_buyer_escrow.balance -= yes_cost;
    ctx.accounts.no_buyer_escrow.balance -= no_cost;

    // 7. Transfer lamports: escrow PDAs -> vault (program owns escrows)
    **ctx.accounts.yes_buyer_escrow.to_account_info().try_borrow_mut_lamports()? -= yes_cost;
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? += yes_cost;

    **ctx.accounts.no_buyer_escrow.to_account_info().try_borrow_mut_lamports()? -= no_cost;
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? += no_cost;

    // 8. Mint tokens via CPI (word_market PDA is mint authority)
    let market_id_bytes = ctx.accounts.word_market.market_id.to_le_bytes();
    let word_index_bytes = ctx.accounts.word_market.word_index.to_le_bytes();
    let bump = ctx.accounts.word_market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"market",
        market_id_bytes.as_ref(),
        word_index_bytes.as_ref(),
        &[bump],
    ]];

    // Mint YES tokens to yes_buyer
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.yes_mint.to_account_info(),
                to: ctx.accounts.yes_buyer_token_account.to_account_info(),
                authority: ctx.accounts.word_market.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Mint NO tokens to no_buyer
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.no_mint.to_account_info(),
                to: ctx.accounts.no_buyer_token_account.to_account_info(),
                authority: ctx.accounts.word_market.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // 9. Update total collateral
    let total_cost = yes_cost
        .checked_add(no_cost)
        .ok_or(MentionMarketError::MathOverflow)?;
    ctx.accounts.word_market.total_collateral = ctx
        .accounts
        .word_market
        .total_collateral
        .checked_add(total_cost)
        .ok_or(MentionMarketError::MathOverflow)?;

    msg!(
        "Settled: {} shares at price {}/{}",
        amount,
        price,
        1_000_000_000 - price
    );

    Ok(())
}
