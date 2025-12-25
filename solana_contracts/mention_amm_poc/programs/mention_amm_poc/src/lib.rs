use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ");

#[program]
pub mod mention_amm_poc {
    use super::*;

    /// Admin creates an "event" container (e.g. "Trump Space 2025-01-01")
    pub fn initialize_event(ctx: Context<InitializeEvent>, event_id: u64) -> Result<()> {
        let event = &mut ctx.accounts.event;
        event.admin = ctx.accounts.admin.key();
        event.event_id = event_id;
        event.bump = ctx.bumps.event;
        Ok(())
    }

    /// Admin creates one binary market under an event (e.g. "word X mentioned?")
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        word_hash: [u8; 32],
        fee_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= 1_000, ErrorCode::FeeTooHigh); // <= 10%

        let market = &mut ctx.accounts.market;
        market.event = ctx.accounts.event.key();
        market.admin = ctx.accounts.event.admin;
        market.market_id = market_id;
        market.word_hash = word_hash;
        market.fee_bps = fee_bps;
        market.resolved = false;
        market.winning_side = WinningSide::Unresolved;
        market.bump = ctx.bumps.market;
        Ok(())
    }

    /// Admin deposits SOL into the program-owned market account (market acts as SOL vault)
    /// and mints YES+NO into the pool vault token accounts.
    pub fn add_liquidity(ctx: Context<AddLiquidity>, lamports: u64) -> Result<()> {
        require!(lamports > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        // Move SOL into the market account (program-owned account can hold lamports).
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            lamports,
        )?;

        // Market PDA signs as mint authority.
        let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let event_key = ctx.accounts.event.key();
        let seeds: &[&[u8]] = &[
            b"market",
            event_key.as_ref(),
            &market_id_bytes,
            &[ctx.accounts.market.bump],
        ];
        let signer = &[seeds];

        // Mint YES to pool vault
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    to: ctx.accounts.yes_vault.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            lamports,
        )?;

        // Mint NO to pool vault
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    to: ctx.accounts.no_vault.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            lamports,
        )?;

        Ok(())
    }

    /// User deposits SOL into the market account and receives a complete set: YES + NO (1:1).
    pub fn mint_set(ctx: Context<MintSet>, lamports: u64) -> Result<()> {
        require!(lamports > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            lamports,
        )?;

        // Market PDA signs as mint authority.
        let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let event_key = ctx.accounts.event.key();
        let seeds: &[&[u8]] = &[
            b"market",
            event_key.as_ref(),
            &market_id_bytes,
            &[ctx.accounts.market.bump],
        ];
        let signer = &[seeds];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    to: ctx.accounts.user_yes.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            lamports,
        )?;

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    to: ctx.accounts.user_no.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            lamports,
        )?;

        Ok(())
    }

    /// User burns equal YES and NO and withdraws SOL 1:1 (pre-resolution).
    pub fn burn_set(ctx: Context<BurnSet>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.yes_mint.to_account_info(),
                    from: ctx.accounts.user_yes.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.no_mint.to_account_info(),
                    from: ctx.accounts.user_no.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        withdraw_sol_from_market(&ctx.accounts.market.to_account_info(), &ctx.accounts.user.to_account_info(), amount)?;
        Ok(())
    }

    /// Swap YES <-> NO against the pool vaults using constant product with fee.
    pub fn swap(ctx: Context<Swap>, side: SwapSide, amount_in: u64, min_out: u64) -> Result<()> {
        require!(amount_in > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        let (vault_in, vault_out, user_in, user_out) = match side {
            SwapSide::YesToNo => (
                &ctx.accounts.yes_vault,
                &ctx.accounts.no_vault,
                &ctx.accounts.user_yes,
                &ctx.accounts.user_no,
            ),
            SwapSide::NoToYes => (
                &ctx.accounts.no_vault,
                &ctx.accounts.yes_vault,
                &ctx.accounts.user_no,
                &ctx.accounts.user_yes,
            ),
        };

        let fee_bps = ctx.accounts.market.fee_bps as u64;
        let amount_in_after_fee = amount_in
            .checked_mul(10_000 - fee_bps)
            .ok_or(ErrorCode::MathOverflow)?
            / 10_000;

        let reserve_in = vault_in.amount as u128;
        let reserve_out = vault_out.amount as u128;
        require!(reserve_in > 0 && reserve_out > 0, ErrorCode::NoLiquidity);

        let ai = amount_in_after_fee as u128;
        let numerator = reserve_out.checked_mul(ai).ok_or(ErrorCode::MathOverflow)?;
        let denominator = reserve_in.checked_add(ai).ok_or(ErrorCode::MathOverflow)?;
        let amount_out_u128 = numerator / denominator;

        let amount_out: u64 = amount_out_u128.try_into().map_err(|_| ErrorCode::MathOverflow)?;
        require!(amount_out >= min_out, ErrorCode::SlippageExceeded);

        // user -> vault_in
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: user_in.to_account_info(),
                    to: vault_in.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_in,
        )?;

        // vault_out -> user (market PDA signs)
        let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
        let event_key = ctx.accounts.event.key();
        let seeds: &[&[u8]] = &[
            b"market",
            event_key.as_ref(),
            &market_id_bytes,
            &[ctx.accounts.market.bump],
        ];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: vault_out.to_account_info(),
                    to: user_out.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer,
            ),
            amount_out,
        )?;

        Ok(())
    }

    /// Admin sets the winning side.
    pub fn resolve_market(ctx: Context<ResolveMarket>, winning: WinningSide) -> Result<()> {
        require!(
            winning == WinningSide::Yes || winning == WinningSide::No,
            ErrorCode::InvalidWinner
        );
        require!(ctx.accounts.event.admin == ctx.accounts.admin.key(), ErrorCode::Unauthorized);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        let market = &mut ctx.accounts.market;
        market.resolved = true;
        market.winning_side = winning;
        Ok(())
    }

    /// Burn winning tokens and withdraw SOL 1:1 (lamports).
    pub fn redeem(ctx: Context<Redeem>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.market.resolved, ErrorCode::MarketNotResolved);

        match ctx.accounts.market.winning_side {
            WinningSide::Yes => {
                token::burn(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Burn {
                            mint: ctx.accounts.yes_mint.to_account_info(),
                            from: ctx.accounts.user_yes.to_account_info(),
                            authority: ctx.accounts.user.to_account_info(),
                        },
                    ),
                    amount,
                )?;
            }
            WinningSide::No => {
                token::burn(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Burn {
                            mint: ctx.accounts.no_mint.to_account_info(),
                            from: ctx.accounts.user_no.to_account_info(),
                            authority: ctx.accounts.user.to_account_info(),
                        },
                    ),
                    amount,
                )?;
            }
            WinningSide::Unresolved => return err!(ErrorCode::MarketNotResolved),
        }

        withdraw_sol_from_market(&ctx.accounts.market.to_account_info(), &ctx.accounts.user.to_account_info(), amount)?;
        Ok(())
    }

    /// Convenience wrapper: deposit SOL, mint YES+NO, then swap ALL NO -> YES.
/// Result: user ends with ~ (lamports + swapped_yes) YES and ~0 NO.
pub fn buy_yes_with_sol(
    ctx: Context<BuyWithSol>,
    lamports: u64,
    min_yes_out_from_swap: u64,
) -> Result<()> {
    require!(lamports > 0, ErrorCode::InvalidAmount);
    require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

    // 1) Deposit SOL collateral into the market account
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.market.to_account_info(),
            },
        ),
        lamports,
    )?;

    // 2) Market PDA signer seeds
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let event_key = ctx.accounts.event.key();
    let seeds: &[&[u8]] = &[
        b"market",
        event_key.as_ref(),
        &market_id_bytes,
        &[ctx.accounts.market.bump],
    ];
    let signer = &[seeds];

    // 3) Mint complete set to user: YES + NO
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.yes_mint.to_account_info(),
                to: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        lamports,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.no_mint.to_account_info(),
                to: ctx.accounts.user_no.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        lamports,
    )?;

    // 4) Swap ALL user NO -> YES against pool vaults (constant product with fee)
    let amount_in = lamports;

    let fee_bps = ctx.accounts.market.fee_bps as u64;
    let amount_in_after_fee = amount_in
        .checked_mul(10_000 - fee_bps)
        .ok_or(ErrorCode::MathOverflow)?
        / 10_000;

    let reserve_in = ctx.accounts.no_vault.amount as u128;  // NO in pool
    let reserve_out = ctx.accounts.yes_vault.amount as u128; // YES in pool
    require!(reserve_in > 0 && reserve_out > 0, ErrorCode::NoLiquidity);

    let ai = amount_in_after_fee as u128;
    let numerator = reserve_out.checked_mul(ai).ok_or(ErrorCode::MathOverflow)?;
    let denominator = reserve_in.checked_add(ai).ok_or(ErrorCode::MathOverflow)?;
    let amount_out_u128 = numerator / denominator;

    let yes_out: u64 = amount_out_u128.try_into().map_err(|_| ErrorCode::MathOverflow)?;
    require!(yes_out >= min_yes_out_from_swap, ErrorCode::SlippageExceeded);

    // user NO -> pool NO
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_no.to_account_info(),
                to: ctx.accounts.no_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_in,
    )?;

    // pool YES -> user YES (market signs)
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.yes_vault.to_account_info(),
                to: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        yes_out,
    )?;

    Ok(())
}

/// Convenience wrapper: deposit SOL, mint YES+NO, then swap ALL YES -> NO.
/// Result: user ends with ~0 YES and ~ (lamports + swapped_no) NO.
pub fn buy_no_with_sol(
    ctx: Context<BuyWithSol>,
    lamports: u64,
    min_no_out_from_swap: u64,
) -> Result<()> {
    require!(lamports > 0, ErrorCode::InvalidAmount);
    require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.market.to_account_info(),
            },
        ),
        lamports,
    )?;

    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let event_key = ctx.accounts.event.key();
    let seeds: &[&[u8]] = &[
        b"market",
        event_key.as_ref(),
        &market_id_bytes,
        &[ctx.accounts.market.bump],
    ];
    let signer = &[seeds];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.yes_mint.to_account_info(),
                to: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        lamports,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.no_mint.to_account_info(),
                to: ctx.accounts.user_no.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        lamports,
    )?;

    let amount_in = lamports;

    let fee_bps = ctx.accounts.market.fee_bps as u64;
    let amount_in_after_fee = amount_in
        .checked_mul(10_000 - fee_bps)
        .ok_or(ErrorCode::MathOverflow)?
        / 10_000;

    let reserve_in = ctx.accounts.yes_vault.amount as u128; // YES in pool
    let reserve_out = ctx.accounts.no_vault.amount as u128; // NO in pool
    require!(reserve_in > 0 && reserve_out > 0, ErrorCode::NoLiquidity);

    let ai = amount_in_after_fee as u128;
    let numerator = reserve_out.checked_mul(ai).ok_or(ErrorCode::MathOverflow)?;
    let denominator = reserve_in.checked_add(ai).ok_or(ErrorCode::MathOverflow)?;
    let amount_out_u128 = numerator / denominator;

    let no_out: u64 = amount_out_u128.try_into().map_err(|_| ErrorCode::MathOverflow)?;
    require!(no_out >= min_no_out_from_swap, ErrorCode::SlippageExceeded);

    // user YES -> pool YES
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_yes.to_account_info(),
                to: ctx.accounts.yes_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_in,
    )?;

    // pool NO -> user NO (market signs)
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.no_vault.to_account_info(),
                to: ctx.accounts.user_no.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        no_out,
    )?;

    Ok(())
}
}

/* ============================== Accounts ============================== */

#[account]
pub struct Event {
    pub admin: Pubkey,
    pub event_id: u64,
    pub bump: u8,
}

#[account]
pub struct Market {
    pub event: Pubkey,
    pub admin: Pubkey,
    pub market_id: u64,
    pub word_hash: [u8; 32],
    pub fee_bps: u16,
    pub resolved: bool,
    pub winning_side: WinningSide,
    pub bump: u8,
}

impl Event {
    pub const SIZE: usize = 8 + 32 + 8 + 1;
}

impl Market {
    pub const SIZE: usize =
        8  // discriminator
        + 32 // event
        + 32 // admin
        + 8  // market_id
        + 32 // word_hash
        + 2  // fee_bps
        + 1  // resolved
        + 1  // winning_side
        + 1; // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum WinningSide {
    Unresolved,
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum SwapSide {
    YesToNo,
    NoToYes,
}

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct InitializeEvent<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Event::SIZE,
        seeds = [b"event", admin.key().as_ref(), &event_id.to_le_bytes()],
        bump
    )]
    pub event: Account<'info, Event>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyWithSol<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    #[account(mut)]
    pub yes_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub no_vault: Account<'info, TokenAccount>,

    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, has_one = admin)]
    pub event: Account<'info, Event>,

    #[account(
        init,
        payer = admin,
        space = Market::SIZE,
        seeds = [b"market", event.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    // Outcome token mints as PDAs; market PDA is mint authority.
    #[account(
        init,
        payer = admin,
        mint::decimals = 9,
        mint::authority = market,
        seeds = [b"yes_mint", market.key().as_ref()],
        bump
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 9,
        mint::authority = market,
        seeds = [b"no_mint", market.key().as_ref()],
        bump
    )]
    pub no_mint: Account<'info, Mint>,

    // Pool vault token accounts owned by market PDA as PDAs.
    #[account(
        init,
        payer = admin,
        token::mint = yes_mint,
        token::authority = market,
        seeds = [b"yes_vault", market.key().as_ref()],
        bump
    )]
    pub yes_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        token::mint = no_mint,
        token::authority = market,
        seeds = [b"no_vault", market.key().as_ref()],
        bump
    )]
    pub no_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(has_one = admin)]
    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    #[account(mut)]
    pub yes_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub no_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintSet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnSet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub yes_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub no_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_no: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    pub admin: Signer<'info>,

    #[account(has_one = admin)]
    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/* ============================== Helpers ============================== */

fn withdraw_sol_from_market(market_ai: &AccountInfo, user_ai: &AccountInfo, lamports: u64) -> Result<()> {
    require!(market_ai.lamports() >= lamports, ErrorCode::InsufficientSol);

    **market_ai.try_borrow_mut_lamports()? = market_ai
        .lamports()
        .checked_sub(lamports)
        .ok_or(ErrorCode::MathOverflow)?;

    **user_ai.try_borrow_mut_lamports()? = user_ai
        .lamports()
        .checked_add(lamports)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(())
}

/* ============================== Errors ============================== */

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Fee too high.")]
    FeeTooHigh,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("No liquidity in pool.")]
    NoLiquidity,
    #[msg("Market already resolved.")]
    MarketResolved,
    #[msg("Market not resolved yet.")]
    MarketNotResolved,
    #[msg("Invalid winning side.")]
    InvalidWinner,
    #[msg("Slippage exceeded.")]
    SlippageExceeded,
    #[msg("Unauthorized.")]
    Unauthorized,
    #[msg("Insufficient SOL in market.")]
    InsufficientSol,
}
