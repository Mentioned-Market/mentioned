use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{MarketAccount, MarketStatus, Side};
use crate::errors::AmmError;
use crate::math::{calculate_sell_return, implied_price};

#[derive(Accounts)]
#[instruction(word_index: u8)]
pub struct Sell<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Open @ AmmError::MarketNotOpen,
    )]
    pub market: Box<Account<'info, MarketAccount>>,

    /// Market's USDC vault — source of the sell proceeds
    #[account(
        mut,
        constraint = vault.mint == market.usdc_mint @ AmmError::InvalidVault,
        constraint = vault.owner == market.key() @ AmmError::InvalidVault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Trader's USDC token account — receives proceeds
    #[account(
        mut,
        constraint = trader_usdc.owner == trader.key() @ AmmError::NotOwner,
        constraint = trader_usdc.mint == market.usdc_mint @ AmmError::InvalidUsdcMint,
    )]
    pub trader_usdc: Account<'info, TokenAccount>,

    /// The YES or NO mint for the target word
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    /// Trader's token account holding the tokens to sell
    #[account(
        mut,
        constraint = trader_token_account.owner == trader.key() @ AmmError::NotOwner,
        constraint = trader_token_account.mint == token_mint.key() @ AmmError::WrongMint,
    )]
    pub trader_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_sell(
    ctx: Context<Sell>,
    word_index: u8,
    direction: Side,
    quantity: u64,
    min_return: u64,
) -> Result<()> {
    require!(quantity > 0, AmmError::ZeroAmount);

    let market = &ctx.accounts.market;
    require!((word_index as usize) < market.num_words as usize, AmmError::InvalidWordIndex);

    let word = &market.words[word_index as usize];

    // Verify the mint matches the expected direction
    let expected_mint = match direction {
        Side::Yes => word.yes_mint,
        Side::No => word.no_mint,
    };
    require!(
        ctx.accounts.token_mint.key() == expected_mint,
        AmmError::WrongMint
    );

    // Verify trader has enough tokens
    require!(
        ctx.accounts.trader_token_account.amount >= quantity,
        AmmError::InsufficientTokens
    );

    // Calculate return via LMSR (returns USDC base units)
    let gross_return = calculate_sell_return(
        word.yes_quantity,
        word.no_quantity,
        direction,
        quantity,
        market.liquidity_param_b,
    )?;

    // Apply trade fee
    let fee = (gross_return as u128)
        .checked_mul(market.trade_fee_bps as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(AmmError::MathOverflow)? as u64;

    let net_return = gross_return.checked_sub(fee).ok_or(AmmError::MathOverflow)?;

    // Slippage check
    require!(net_return >= min_return, AmmError::SlippageBelowMin);

    // Burn tokens from trader (trader is authority — no PDA signer needed)
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Burn {
                mint: ctx.accounts.token_mint.to_account_info(),
                from: ctx.accounts.trader_token_account.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        quantity,
    )?;

    // Transfer USDC from vault to trader using market PDA as signer
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let signer_seeds: &[&[u8]] = &[b"market", market_id_bytes.as_ref(), &[bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.trader_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[signer_seeds],
        ),
        net_return,
    )?;

    // Update word quantities and accumulated fees
    let market = &mut ctx.accounts.market;
    let word = &mut market.words[word_index as usize];
    match direction {
        Side::Yes => {
            word.yes_quantity = word.yes_quantity
                .checked_sub(quantity as i64)
                .ok_or(AmmError::MathOverflow)?;
        }
        Side::No => {
            word.no_quantity = word.no_quantity
                .checked_sub(quantity as i64)
                .ok_or(AmmError::MathOverflow)?;
        }
    }
    market.accumulated_fees = market.accumulated_fees
        .checked_add(fee)
        .ok_or(AmmError::MathOverflow)?;

    // Calculate new implied price for event
    let new_price = implied_price(
        market.words[word_index as usize].yes_quantity,
        market.words[word_index as usize].no_quantity,
        market.liquidity_param_b,
    )?;

    emit!(super::buy::TradeEvent {
        market_id: market.market_id,
        word_index,
        direction,
        quantity,
        cost: net_return,
        fee,
        new_yes_qty: market.words[word_index as usize].yes_quantity,
        new_no_qty: market.words[word_index as usize].no_quantity,
        implied_yes_price: new_price,
        trader: ctx.accounts.trader.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Sell {} {:?} tokens for word {} — return: {} USDC base units (fee: {})",
        quantity,
        direction,
        word_index,
        net_return,
        fee,
    );
    Ok(())
}
