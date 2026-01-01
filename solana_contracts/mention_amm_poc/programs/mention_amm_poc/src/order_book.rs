use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("G11AaYPenVJw7MzbYLX6rp1USGhjRZwQ8eTgAu6G4pnk");

#[program]
pub mod mention_order_book {
    use super::*;

    /// Admin creates an event (e.g., "Trump Space Jan 15 2025")
    pub fn initialize_event(
        ctx: Context<InitializeEvent>, 
        event_id: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        require!(end_time > start_time, ErrorCode::InvalidTimeRange);
        
        let clock = Clock::get()?;
        let event = &mut ctx.accounts.event;
        event.admin = ctx.accounts.admin.key();
        event.event_id = event_id;
        event.state = EventState::PreMarket;
        event.start_time = start_time;
        event.end_time = end_time;
        event.created_at = clock.unix_timestamp;
        event.bump = ctx.bumps.event;
        
        msg!("Event {} created in PreMarket state", event_id);
        Ok(())
    }

    /// Admin creates a single market under an event
    /// Can only be called when event is in PreMarket state
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_id: u64,
        word_hash: [u8; 32],
    ) -> Result<()> {
        // Only allow market creation in PreMarket state
        require!(
            ctx.accounts.event.state == EventState::PreMarket,
            ErrorCode::InvalidEventState
        );
        
        let market = &mut ctx.accounts.market;
        market.event = ctx.accounts.event.key();
        market.market_id = market_id;
        market.word_hash = word_hash;
        market.admin = ctx.accounts.event.admin;
        market.resolved = false;
        market.winning_side = WinningSide::Unresolved;
        market.bump = ctx.bumps.market;
        market.next_order_id = 0;
        
        msg!("Market {} created for event in PreMarket state", market_id);
        Ok(())
    }

    /// Bulk create multiple markets for an event (convenience function)
    /// Pass an array of word hashes to create multiple markets at once
    pub fn bulk_create_markets(
        _ctx: Context<BulkCreateMarkets>,
        starting_market_id: u64,
        word_hashes: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(word_hashes.len() <= 50, ErrorCode::TooManyMarkets);
        require!(word_hashes.len() > 0, ErrorCode::NoMarketsProvided);

        // Store the word hashes and count in the event
        // Note: For actual bulk creation, you'd need to call initialize_market multiple times
        // This function serves as a helper to validate and prepare bulk operations
        
        msg!("Preparing to create {} markets starting from ID {}", word_hashes.len(), starting_market_id);
        
        // In a real implementation, you'd loop and create each market
        // For Solana, this is typically done client-side with multiple transactions
        // Or you could create a simpler approach where markets are lazy-initialized
        
        Ok(())
    }

    /// Admin transitions event from PreMarket to Live state
    /// After this, no new markets can be added and trading begins
    pub fn start_event(ctx: Context<UpdateEventState>) -> Result<()> {
        let event = &mut ctx.accounts.event;
        require!(event.state == EventState::PreMarket, ErrorCode::InvalidEventState);
        
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= event.start_time,
            ErrorCode::EventNotStarted
        );
        
        event.state = EventState::Live;
        msg!("Event {} transitioned to Live state", event.event_id);
        Ok(())
    }

    /// Admin transitions event from Live to Ended state
    /// After this, trading stops and admin can resolve markets
    pub fn end_event(ctx: Context<UpdateEventState>) -> Result<()> {
        let event = &mut ctx.accounts.event;
        require!(event.state == EventState::Live, ErrorCode::InvalidEventState);
        
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= event.end_time,
            ErrorCode::EventNotEnded
        );
        
        event.state = EventState::Ended;
        msg!("Event {} transitioned to Ended state", event.event_id);
        Ok(())
    }

    /// Admin marks event as fully resolved
    /// Called after all markets are resolved
    pub fn finalize_event(ctx: Context<UpdateEventState>) -> Result<()> {
        let event = &mut ctx.accounts.event;
        require!(event.state == EventState::Ended, ErrorCode::InvalidEventState);
        
        event.state = EventState::Resolved;
        msg!("Event {} transitioned to Resolved state", event.event_id);
        Ok(())
    }

    /// User deposits SOL and receives equal YES + NO tokens (mint a complete set)
    pub fn mint_set(ctx: Context<MintSet>, lamports: u64) -> Result<()> {
        require!(lamports > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        // Transfer SOL to market account (collateral storage)
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

        // Market PDA signs as mint authority
        let signer_seeds = market_signer_seeds(&ctx.accounts.market);
        let signer_slices: Vec<&[u8]> = signer_seeds.iter().map(|s| s.as_slice()).collect();
        let signer = &[signer_slices.as_slice()];

        // Mint YES tokens to user
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

        // Mint NO tokens to user
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

    /// User burns equal YES + NO to withdraw SOL 1:1 (pre-resolution only)
    pub fn burn_set(ctx: Context<BurnSet>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        // Burn YES from user
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

        // Burn NO from user
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

        // Return SOL from market account to user
        withdraw_sol_from_market(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            amount,
        )?;

        Ok(())
    }

    /// Place a limit order to buy or sell YES/NO tokens
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: OrderSide,
        outcome: OrderOutcome,
        price: u64,  // Price in basis points (0-10000, e.g., 6500 = 0.65 = 65%)
        size: u64,   // Number of tokens to buy/sell
    ) -> Result<()> {
        require!(price > 0 && price < 10_000, ErrorCode::InvalidPrice);
        require!(size > 0, ErrorCode::InvalidAmount);
        require!(!ctx.accounts.market.resolved, ErrorCode::MarketResolved);

        let order = &mut ctx.accounts.order;
        order.order_id = ctx.accounts.market.next_order_id;
        order.market = ctx.accounts.market.key();
        order.user = ctx.accounts.user.key();
        order.side = side;
        order.outcome = outcome;
        order.price = price;
        order.size = size;
        order.filled = 0;
        order.cancelled = false;
        order.bump = ctx.bumps.order;

        // Lock collateral in order's escrow account
        match side {
            OrderSide::Buy => {
                // Buying tokens: need to lock SOL
                // But we're using tokens, so lock the opposite outcome token
                // Cost = size * price / 10000
                let cost = (size as u128)
                    .checked_mul(price as u128)
                    .ok_or(ErrorCode::MathOverflow)?
                    / 10_000;

                // For buying, user locks the complementary outcome tokens as collateral
                // e.g., buying YES means locking NO tokens worth the price
                let user_lock_account = match outcome {
                    OrderOutcome::Yes => &ctx.accounts.user_no,
                    OrderOutcome::No => &ctx.accounts.user_yes,
                };

                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: user_lock_account.to_account_info(),
                            to: ctx.accounts.order_escrow_token.to_account_info(),
                            authority: ctx.accounts.user.to_account_info(),
                        },
                    ),
                    cost as u64,
                )?;
            }
            OrderSide::Sell => {
                // Selling tokens: lock the outcome tokens being sold
                let user_token_account = match outcome {
                    OrderOutcome::Yes => &ctx.accounts.user_yes,
                    OrderOutcome::No => &ctx.accounts.user_no,
                };

                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: user_token_account.to_account_info(),
                            to: ctx.accounts.order_escrow_token.to_account_info(),
                            authority: ctx.accounts.user.to_account_info(),
                        },
                    ),
                    size,
                )?;
            }
        }

        ctx.accounts.market.next_order_id += 1;
        Ok(())
    }

    /// Cancel an unfilled order and return locked collateral
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        require!(!ctx.accounts.order.cancelled, ErrorCode::OrderAlreadyCancelled);
        require!(ctx.accounts.order.user == ctx.accounts.user.key(), ErrorCode::Unauthorized);

        let unfilled = ctx.accounts.order.size - ctx.accounts.order.filled;
        require!(unfilled > 0, ErrorCode::OrderFullyFilled);

        // Store values we need before borrowing
        let side = ctx.accounts.order.side;
        let outcome = ctx.accounts.order.outcome;
        let price = ctx.accounts.order.price;
        let order_id = ctx.accounts.order.order_id;
        let market_key = ctx.accounts.order.market;
        let bump = ctx.accounts.order.bump;

        // Build signer seeds without borrowing order mutably
        let order_id_bytes = order_id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            b"order",
            market_key.as_ref(),
            &order_id_bytes,
            &[bump],
        ];
        let signer = &[signer_seeds];

        match side {
            OrderSide::Buy => {
                // Return locked complementary tokens
                let refund = (unfilled as u128 * price as u128) / 10_000;
                
                let user_return_account = match outcome {
                    OrderOutcome::Yes => &ctx.accounts.user_no,
                    OrderOutcome::No => &ctx.accounts.user_yes,
                };

                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.order_escrow_token.to_account_info(),
                            to: user_return_account.to_account_info(),
                            authority: ctx.accounts.order.to_account_info(),
                        },
                        signer,
                    ),
                    refund as u64,
                )?;
            }
            OrderSide::Sell => {
                // Return locked outcome tokens
                let user_token_account = match outcome {
                    OrderOutcome::Yes => &ctx.accounts.user_yes,
                    OrderOutcome::No => &ctx.accounts.user_no,
                };

                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.order_escrow_token.to_account_info(),
                            to: user_token_account.to_account_info(),
                            authority: ctx.accounts.order.to_account_info(),
                        },
                        signer,
                    ),
                    unfilled,
                )?;
            }
        }

        ctx.accounts.order.cancelled = true;
        Ok(())
    }

    /// Match a buy order with a sell order (permissionless - anyone can call to match orders)
    pub fn match_orders(
        ctx: Context<MatchOrders>,
        match_size: u64,
    ) -> Result<()> {
        let buy_order = &mut ctx.accounts.buy_order;
        let sell_order = &mut ctx.accounts.sell_order;

        // Validation
        require!(buy_order.side == OrderSide::Buy, ErrorCode::InvalidOrderSide);
        require!(sell_order.side == OrderSide::Sell, ErrorCode::InvalidOrderSide);
        require!(buy_order.outcome == sell_order.outcome, ErrorCode::OutcomeMismatch);
        require!(!buy_order.cancelled, ErrorCode::OrderCancelled);
        require!(!sell_order.cancelled, ErrorCode::OrderCancelled);
        require!(buy_order.price >= sell_order.price, ErrorCode::PriceNoMatch);

        let buy_remaining = buy_order.size - buy_order.filled;
        let sell_remaining = sell_order.size - sell_order.filled;
        require!(buy_remaining > 0 && sell_remaining > 0, ErrorCode::OrderFullyFilled);
        require!(
            match_size <= buy_remaining && match_size <= sell_remaining,
            ErrorCode::InvalidMatchSize
        );

        // Execute trade at seller's price (buyer gets price improvement if their bid was higher)
        let trade_price = sell_order.price;
        let cost = (match_size as u128 * trade_price as u128) / 10_000;

        // Transfer outcome tokens from seller's escrow to buyer
        let sell_signer_seeds = order_signer_seeds(&sell_order);
        let sell_signer_slices: Vec<&[u8]> = sell_signer_seeds.iter().map(|s| s.as_slice()).collect();
        let sell_signer = &[sell_signer_slices.as_slice()];

        let buyer_token_account = match buy_order.outcome {
            OrderOutcome::Yes => &ctx.accounts.buyer_yes,
            OrderOutcome::No => &ctx.accounts.buyer_no,
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.sell_order_escrow.to_account_info(),
                    to: buyer_token_account.to_account_info(),
                    authority: sell_order.to_account_info(),
                },
                sell_signer,
            ),
            match_size,
        )?;

        // Transfer complementary tokens from buyer's escrow to seller
        let buy_signer_seeds = order_signer_seeds(&buy_order);
        let buy_signer_slices: Vec<&[u8]> = buy_signer_seeds.iter().map(|s| s.as_slice()).collect();
        let buy_signer = &[buy_signer_slices.as_slice()];

        let seller_token_account = match sell_order.outcome {
            OrderOutcome::Yes => &ctx.accounts.seller_no,
            OrderOutcome::No => &ctx.accounts.seller_yes,
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buy_order_escrow.to_account_info(),
                    to: seller_token_account.to_account_info(),
                    authority: buy_order.to_account_info(),
                },
                buy_signer,
            ),
            cost as u64,
        )?;

        // Update filled amounts
        buy_order.filled += match_size;
        sell_order.filled += match_size;

        Ok(())
    }

    /// Admin resolves the market by setting the winning side
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

    /// Redeem winning tokens for SOL 1:1 after market resolution
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

        withdraw_sol_from_market(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            amount,
        )?;

        Ok(())
    }
}

/* ============================== ACCOUNT STRUCTS ============================== */

#[account]
pub struct Event {
    pub admin: Pubkey,
    pub event_id: u64,
    pub state: EventState,
    pub start_time: i64,    // Unix timestamp when event goes live
    pub end_time: i64,      // Unix timestamp when event ends
    pub created_at: i64,    // Unix timestamp of creation
    pub bump: u8,
}

#[account]
pub struct Market {
    pub event: Pubkey,
    pub admin: Pubkey,
    pub market_id: u64,
    pub word_hash: [u8; 32],
    pub resolved: bool,
    pub winning_side: WinningSide,
    pub next_order_id: u64,
    pub bump: u8,
}

#[account]
pub struct Order {
    pub order_id: u64,
    pub market: Pubkey,
    pub user: Pubkey,
    pub side: OrderSide,
    pub outcome: OrderOutcome,
    pub price: u64,     // Basis points (0-10000, e.g., 6500 = 65%)
    pub size: u64,      // Number of tokens
    pub filled: u64,    // Amount filled so far
    pub cancelled: bool,
    pub bump: u8,
}

impl Event {
    pub const SIZE: usize = 8 + 32 + 8 + 1 + 8 + 8 + 8 + 1; // discriminator + admin + event_id + state + start_time + end_time + created_at + bump
}

impl Market {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 32 + 1 + 1 + 8 + 1;
}

impl Order {
    pub const SIZE: usize = 8 + 8 + 32 + 32 + 1 + 1 + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EventState {
    PreMarket,  // Event created, markets can be added, no trading
    Live,       // Trading active
    Ended,      // Trading closed, awaiting resolution
    Resolved,   // All markets resolved
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum WinningSide {
    Unresolved,
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderSide {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderOutcome {
    Yes,
    No,
}

/* ============================== ACCOUNT CONTEXTS ============================== */

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
pub struct UpdateEventState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, has_one = admin)]
    pub event: Account<'info, Event>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(has_one = admin)]
    pub event: Account<'info, Event>,

    #[account(
        init,
        payer = admin,
        space = Market::SIZE,
        seeds = [b"market", event.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

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

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BulkCreateMarkets<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(has_one = admin)]
    pub event: Account<'info, Event>,

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
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = user,
        space = Order::SIZE,
        seeds = [b"order", market.key().as_ref(), &market.next_order_id.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        token::mint = yes_mint, // Simplified: using YES mint for escrow, actual impl would be dynamic
        token::authority = order,
        seeds = [b"order_escrow", order.key().as_ref()],
        bump
    )]
    pub order_escrow_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub order: Account<'info, Order>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    #[account(mut, token::mint = yes_mint, token::authority = user)]
    pub user_yes: Account<'info, TokenAccount>,
    
    #[account(mut, token::mint = no_mint, token::authority = user)]
    pub user_no: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"order_escrow", order.key().as_ref()],
        bump
    )]
    pub order_escrow_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    #[account(mut)]
    pub matcher: Signer<'info>, // Person calling the match function (can be anyone)

    #[account(mut)]
    pub buy_order: Account<'info, Order>,
    
    #[account(mut)]
    pub sell_order: Account<'info, Order>,

    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,

    // Buyer's token accounts
    #[account(mut, token::mint = yes_mint)]
    pub buyer_yes: Account<'info, TokenAccount>,
    
    #[account(mut, token::mint = no_mint)]
    pub buyer_no: Account<'info, TokenAccount>,

    // Seller's token accounts
    #[account(mut, token::mint = yes_mint)]
    pub seller_yes: Account<'info, TokenAccount>,
    
    #[account(mut, token::mint = no_mint)]
    pub seller_no: Account<'info, TokenAccount>,

    // Order escrow accounts
    #[account(
        mut,
        seeds = [b"order_escrow", buy_order.key().as_ref()],
        bump
    )]
    pub buy_order_escrow: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"order_escrow", sell_order.key().as_ref()],
        bump
    )]
    pub sell_order_escrow: Account<'info, TokenAccount>,

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

/* ============================== HELPER FUNCTIONS ============================== */

fn market_signer_seeds<'a>(market: &'a Account<Market>) -> Vec<Vec<u8>> {
    vec![
        b"market".to_vec(),
        market.event.as_ref().to_vec(),
        market.market_id.to_le_bytes().to_vec(),
        vec![market.bump],
    ]
}

fn order_signer_seeds<'a>(order: &'a Account<Order>) -> Vec<Vec<u8>> {
    vec![
        b"order".to_vec(),
        order.market.as_ref().to_vec(),
        order.order_id.to_le_bytes().to_vec(),
        vec![order.bump],
    ]
}

fn withdraw_sol_from_market(
    market_ai: &AccountInfo,
    user_ai: &AccountInfo,
    lamports: u64,
) -> Result<()> {
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

/* ============================== ERROR CODES ============================== */

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Invalid price. Must be between 0 and 10000 basis points.")]
    InvalidPrice,
    #[msg("Math overflow.")]
    MathOverflow,
    #[msg("Market already resolved.")]
    MarketResolved,
    #[msg("Market not resolved yet.")]
    MarketNotResolved,
    #[msg("Invalid winning side.")]
    InvalidWinner,
    #[msg("Unauthorized.")]
    Unauthorized,
    #[msg("Insufficient SOL in market.")]
    InsufficientSol,
    #[msg("Invalid order side.")]
    InvalidOrderSide,
    #[msg("Outcome mismatch between orders.")]
    OutcomeMismatch,
    #[msg("Order already cancelled.")]
    OrderAlreadyCancelled,
    #[msg("Order fully filled.")]
    OrderFullyFilled,
    #[msg("Order cancelled.")]
    OrderCancelled,
    #[msg("Prices don't match for trade. Buy price must be >= sell price.")]
    PriceNoMatch,
    #[msg("Invalid match size. Cannot exceed unfilled amounts.")]
    InvalidMatchSize,
    #[msg("Too many markets to create in bulk. Maximum 50.")]
    TooManyMarkets,
    #[msg("No markets provided for bulk creation.")]
    NoMarketsProvided,
    #[msg("Invalid event state for this operation.")]
    InvalidEventState,
    #[msg("Invalid time range. End time must be after start time.")]
    InvalidTimeRange,
    #[msg("Event has not started yet.")]
    EventNotStarted,
    #[msg("Event has not ended yet.")]
    EventNotEnded,
}

