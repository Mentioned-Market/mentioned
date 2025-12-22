use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("MarkeTAMM11111111111111111111111111111111");

#[program]
pub mod mention_amm_poc {
    use super::*;

    pub fn initialize_event(ctx: Context<InitializeEvent>, event_id: u64) -> Result<()> {
        let event = &mut ctx.accounts.event;
        event.admin = ctx.accounts.admin.key();
        event.event_id = event_id;
        event.bump = ctx.bumps.event;
        Ok(())
    }

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        word_hash: [u8; 32],
        fee_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= 1_000, ErrorCode::FeeTooHigh); // max 10% for safety

        let market = &mut ctx.accounts.market;
        market.event = ctx.accounts.event.key();
        market.market_id = market_id;
        market.word_hash = word_hash;
        market.admin = ctx.accounts.event.admin;
        market.fee_bps = fee_bps;
        market.resolved = false;
        market.winning_side = WinningSide::Unresolved;
        market.bump = ctx.bumps.market;
        market.sol_vault_bump = ctx.bumps.sol_vault;

        Ok(())
    }

    /// Admin deposits SOL and mints YES+NO into the pool vaults (initial or additional liquidity).
    pub fn add_liquidity(ctx: Context<AddLiquidity>, lamports: u64) -> Result<()> {
        require!(lamports > 0, ErrorCode::InvalidAmount);
        // Move SOL into the market SOL vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            lamports,
        )?;

        // Mint YES and NO into the pool vaults, 1:1 with lamports.
        mint_to_vaults(&ctx, lamports)?;

        Ok(())
    }

    /// User deposits SOL to receive a complete set: YES + NO (1:1).
    pub fn mint_set(ctx: Context<MintSet>, lamports: u64) -> Result<()> {
        require!(lamports > 0, ErrorCode::InvalidAmount);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            lamports,
        )?;

        // Mint YES and NO to the user's token accounts.
        let signer_seeds = market_signer_seeds(&ctx.accounts.market);
        let signer = &[&signer_seeds[..]];

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

    /// User burns equal YES and NO to withdraw SOL (pre-resolution).
    pub fn burn_set(ctx: Context<BurnSet>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        // Burn YES and NO from user.
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

        // Transfer SOL out of vault back to user
        transfer_sol_from_vault(
            &ctx.accounts.sol_vault,
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.market,
            ctx.accounts.system_program.to_account_info(),
            amount,
        )?;

        Ok(())
    }

    /// Swap token_in -> token_out using constant product AMM held in the pool vaults.
    /// User supplies amount_in and receives amount_out (must be >= min_out).
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

        // Compute output with fee:
        // amount_in_after_fee = amount_in * (10_000 - fee_bps) / 10_000
        // amount_out = reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee)
        let fee_bps = ctx.accounts.market.fee_bps as u64;
        let amount_in_after_fee = amount_in
            .checked_mul(10_000 - fee_bps)
            .ok_or(ErrorCode::MathOverflow)?
            / 10_000;

        let reserve_in = vault_in.amount as u128;
        let reserve_out = vault_out.amount as u128;
        let ai = amount_in_after_fee as u128;

        require!(reserve_in > 0 && reserve_out > 0, ErrorCode::NoLiquidity);

        let numerator = reserve_out.checked_mul(ai).ok_or(ErrorCode::MathOverflow)?;
        let denominator = reserve_in.checked_add(ai).ok_or(ErrorCode::MathOverflow)?;
        let amount_out_u128 = numerator / denominator;

        let amount_out: u64 = amount_out_u128
            .try_into()
            .map_err(|_| ErrorCode::MathOverflow)?;

        require!(amount_out >= min_out, ErrorCode::SlippageExceeded);

        // Transfer token_in from user -> vault_in
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

        // Transfer token_out from vault_out -> user_out (market PDA signs)
        let signer_seeds = market_signer_seeds(&ctx.accounts.market);
        let signer = &[&signer_seeds[..]];

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

    pub fn resolve_market(ctx: Context<ResolveMarket>, winning: WinningSide) -> Result<()> {
        require!(
            winning == WinningSide::Yes || winning == WinningSide::No,
            ErrorCode::InvalidWinner
        );
        let market = &mut ctx.accounts.market;
        require!(!market.resolved, ErrorCode::MarketResolved);

        market.resolved = true;
        market.winning_side = winning;
        Ok(())
    }

    /// Burn winning tokens and withdraw SOL 1:1 (lamports).
    pub fn redeem(ctx: Context<Redeem>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(ctx.accounts.market.resolved, ErrorCode::MarketNotResolved);

        let winning = ctx.accounts.market.winning_side;

        match winning {
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

        transfer_sol_from_vault(
            &ctx.accounts.sol_vault,
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.market,
            ctx.accounts.system_program.to_account_info(),
            amount,
        )?;

        Ok(())
    }
}

/* ----------------------------- Accounts ----------------------------- */

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
    pub sol_vault_bump: u8,
}

impl Event {
    pub const SIZE: usize = 8 + 32 + 8 + 1;
}

impl Market {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 32 + 2 + 1 + 1 + 1 + 1;
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
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin
    )]
    pub event: Account<'info, Event>,

    #[account(
        init,
        payer = admin,
        space = Market::SIZE,
        seeds = [b"market", event.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    /// SOL vault PDA (SystemAccount) to hold collateral lamports
    #[account(
        init,
        payer = admin,
        space = 8, // minimal
        seeds = [b"sol_vault", market.key().as_ref()],
        bump
    )]
    pub sol_vault: SystemAccount<'info>,

    // Outcome token mints (YES/NO), mint authority is the market PDA
    #[account(
        init,
        payer = admin,
        mint::decimals = 9,
        mint::authority = market
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        mint::decimals = 9,
        mint::authority = market
    )]
    pub no_mint: Account<'info, Mint>,

    // Pool vault token accounts owned by market PDA
    #[account(
        init,
        payer = admin,
        token::mint = yes_mint,
        token::authority = market
    )]
    pub yes_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        token::mint = no_mint,
        token::authority = market
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

    #[account(mut, has_one = admin)]
    pub event: Account<'info, Event>,

    #[account(mut, has_one = event)]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"sol_vault", market.key().as_ref()],
        bump = market.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,

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

    #[account(
        mut,
        seeds = [b"sol_vault", market.key().as_ref()],
        bump = market.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,

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

    #[account(
        mut,
        seeds = [b"sol_vault", market.key().as_ref()],
        bump = market.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,

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
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, has_one = admin)]
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

    #[account(
        mut,
        seeds = [b"sol_vault", market.key().as_ref()],
        bump = market.sol_vault_bump
    )]
    pub sol_vault: SystemAccount<'info>,

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

/* ----------------------------- Helpers ----------------------------- */

fn market_signer_seeds(market: &Account<Market>) -> Vec<u8> {
    // not used directly; anchor wants slice-of-slices, so we build seeds in call sites
    market.bump.to_le_bytes().to_vec()
}

fn market_signer_seeds<'a>(market: &'a Account<Market>) -> [&'a [u8]; 4] {
    let market_id_bytes = market.market_id.to_le_bytes();
    [
        b"market",
        market.event.as_ref(),
        &market_id_bytes,
        &[market.bump],
    ]
}

fn transfer_sol_from_vault(
    sol_vault: &SystemAccount,
    to: &AccountInfo,
    market: &Account<Market>,
    system_program_ai: AccountInfo,
    lamports: u64,
) -> Result<()> {
    let market_id_bytes = market.market_id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        b"market",
        market.event.as_ref(),
        &market_id_bytes,
        &[market.bump],
    ];

    // We need the SOL vault to sign; it's a PDA with its own seeds.
    // We'll use invoke_signed with sol_vault PDA seeds.
    let sol_vault_seeds: &[&[u8]] = &[b"sol_vault", market.key().as_ref(), &[market.sol_vault_bump]];

    let ix = system_program::Transfer {
        from: sol_vault.to_account_info(),
        to: to.clone(),
    };

    system_program::transfer(
        CpiContext::new_with_signer(system_program_ai, ix, &[sol_vault_seeds]),
        lamports,
    )?;

    Ok(())
}

fn mint_to_vaults(ctx: &Context<AddLiquidity>, amount: u64) -> Result<()> {
    let market_id_bytes = ctx.accounts.market.market_id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        b"market",
        ctx.accounts.market.event.as_ref(),
        &market_id_bytes,
        &[ctx.accounts.market.bump],
    ];
    let signer = &[seeds];

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
        amount,
    )?;

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
        amount,
    )?;

    Ok(())
}

/* ----------------------------- Errors ----------------------------- */

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
}