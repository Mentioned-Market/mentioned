use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{MarketAccount, MarketStatus, Side};
use crate::errors::AmmError;
use crate::math::{calculate_buy_cost, implied_price};

#[derive(Accounts)]
#[instruction(word_index: u8)]
pub struct Buy<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Open @ AmmError::MarketNotOpen,
    )]
    pub market: Box<Account<'info, MarketAccount>>,

    /// Market's USDC vault — receives the trader's payment
    #[account(
        mut,
        constraint = vault.mint == market.usdc_mint @ AmmError::InvalidVault,
        constraint = vault.owner == market.key() @ AmmError::InvalidVault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Trader's USDC token account — source of payment
    #[account(
        mut,
        constraint = trader_usdc.owner == trader.key() @ AmmError::NotOwner,
        constraint = trader_usdc.mint == market.usdc_mint @ AmmError::InvalidUsdcMint,
    )]
    pub trader_usdc: Account<'info, TokenAccount>,

    /// The YES or NO mint for the target word
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,

    /// Trader's token account for the prediction token (receives minted tokens)
    #[account(
        mut,
        constraint = trader_token_account.owner == trader.key() @ AmmError::NotOwner,
        constraint = trader_token_account.mint == token_mint.key() @ AmmError::WrongMint,
    )]
    pub trader_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_buy(
    ctx: Context<Buy>,
    word_index: u8,
    direction: Side,
    quantity: u64,
    max_cost: u64,
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

    // Calculate cost via LMSR (returns USDC base units)
    let cost = calculate_buy_cost(
        word.yes_quantity,
        word.no_quantity,
        direction,
        quantity,
        market.liquidity_param_b,
    )?;

    // Apply trade fee
    let fee = (cost as u128)
        .checked_mul(market.trade_fee_bps as u128)
        .ok_or(AmmError::MathOverflow)?
        .checked_div(10_000)
        .ok_or(AmmError::MathOverflow)? as u64;

    let total_cost = cost.checked_add(fee).ok_or(AmmError::MathOverflow)?;

    // Slippage check
    require!(total_cost <= max_cost, AmmError::SlippageExceeded);

    // Transfer USDC from trader to vault (trader signs directly — no escrow)
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.trader_usdc.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        ),
        total_cost,
    )?;

    // Mint prediction tokens to trader (market PDA is the mint authority)
    let market_id_bytes = market.market_id.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[u8]] = &[b"market", market_id_bytes.as_ref(), &[bump]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::MintTo {
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.trader_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            &[signer_seeds],
        ),
        quantity,
    )?;

    // Update word quantities and accumulated fees
    let market = &mut ctx.accounts.market;
    let word = &mut market.words[word_index as usize];
    match direction {
        Side::Yes => {
            word.yes_quantity = word.yes_quantity
                .checked_add(quantity as i64)
                .ok_or(AmmError::MathOverflow)?;
        }
        Side::No => {
            word.no_quantity = word.no_quantity
                .checked_add(quantity as i64)
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

    emit!(TradeEvent {
        market_id: market.market_id,
        word_index,
        direction,
        quantity,
        cost: total_cost,
        fee,
        new_yes_qty: market.words[word_index as usize].yes_quantity,
        new_no_qty: market.words[word_index as usize].no_quantity,
        implied_yes_price: new_price,
        trader: ctx.accounts.trader.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!(
        "Buy {} {:?} tokens for word {} — cost: {} USDC base units (fee: {})",
        quantity,
        direction,
        word_index,
        total_cost,
        fee,
    );
    Ok(())
}

#[event]
pub struct TradeEvent {
    pub market_id: u64,
    pub word_index: u8,
    pub direction: Side,
    pub quantity: u64,
    pub cost: u64,
    pub fee: u64,
    pub new_yes_qty: i64,
    pub new_no_qty: i64,
    pub implied_yes_price: u64,
    pub trader: Pubkey,
    pub timestamp: i64,
}
