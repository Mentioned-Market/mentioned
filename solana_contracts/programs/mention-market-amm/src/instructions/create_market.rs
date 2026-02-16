use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token};
use crate::state::{MarketAccount, MarketStatus, WordState, MAX_WORDS, MAX_MARKET_LABEL, MAX_WORD_LABEL};
use crate::errors::AmmError;

#[derive(Accounts)]
#[instruction(market_id: u64, label: String, word_labels: Vec<String>)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + MarketAccount::SIZE,
        seeds = [b"market", market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub market: Box<Account<'info, MarketAccount>>,

    /// CHECK: PDA used as a native SOL vault, no data needed
    #[account(
        mut,
        seeds = [b"vault", market_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    // remaining_accounts: pairs of (yes_mint, no_mint) for each word
    // Each mint is a PDA: ["yes_mint", market_id, word_index] / ["no_mint", market_id, word_index]
}

pub fn handle_create_market<'info>(
    ctx: Context<'_, '_, 'info, 'info, CreateMarket<'info>>,
    market_id: u64,
    label: String,
    word_labels: Vec<String>,
    resolves_at: i64,
    resolver: Pubkey,
    trade_fee_bps: u16,
    initial_b: u64,
    base_b_per_sol: u64,
) -> Result<()> {
    require!(label.len() <= MAX_MARKET_LABEL, AmmError::MarketLabelTooLong);
    require!(!word_labels.is_empty(), AmmError::NoWords);
    require!(word_labels.len() <= MAX_WORDS, AmmError::TooManyWords);
    for wl in &word_labels {
        require!(wl.len() <= MAX_WORD_LABEL, AmmError::WordLabelTooLong);
    }

    let num_words = word_labels.len();

    // We expect 2 * num_words remaining accounts (yes_mint, no_mint per word)
    require!(
        ctx.remaining_accounts.len() == 2 * num_words,
        AmmError::TooManyWords // reuse error for wrong account count
    );

    let market_id_bytes = market_id.to_le_bytes();
    let market_key = ctx.accounts.market.key();

    // Initialize each mint via CPI
    let mut words: [WordState; MAX_WORDS] = core::array::from_fn(|_| WordState::default());

    for i in 0..num_words {
        let yes_mint_info = &ctx.remaining_accounts[i * 2];
        let no_mint_info = &ctx.remaining_accounts[i * 2 + 1];
        let word_index = i as u8;
        let word_index_bytes = word_index.to_le_bytes();

        // Derive and verify yes_mint PDA
        let (yes_mint_pda, yes_bump) = Pubkey::find_program_address(
            &[b"yes_mint", market_id_bytes.as_ref(), word_index_bytes.as_ref()],
            ctx.program_id,
        );
        require!(yes_mint_info.key() == yes_mint_pda, AmmError::InvalidWordIndex);

        // Derive and verify no_mint PDA
        let (no_mint_pda, no_bump) = Pubkey::find_program_address(
            &[b"no_mint", market_id_bytes.as_ref(), word_index_bytes.as_ref()],
            ctx.program_id,
        );
        require!(no_mint_info.key() == no_mint_pda, AmmError::InvalidWordIndex);

        // Create yes_mint account
        let yes_seeds: &[&[u8]] = &[b"yes_mint", market_id_bytes.as_ref(), word_index_bytes.as_ref(), &[yes_bump]];
        let mint_space = Mint::LEN;
        let rent_lamports = Rent::get()?.minimum_balance(mint_space);

        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::CreateAccount {
                    from: ctx.accounts.authority.to_account_info(),
                    to: yes_mint_info.clone(),
                },
                &[yes_seeds],
            ),
            rent_lamports,
            mint_space as u64,
            &token::ID,
        )?;

        token::initialize_mint2(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::InitializeMint2 {
                    mint: yes_mint_info.clone(),
                },
            ),
            9, // decimals = 9 to match PRECISION
            &market_key,
            None,
        )?;

        // Create no_mint account
        let no_seeds: &[&[u8]] = &[b"no_mint", market_id_bytes.as_ref(), word_index_bytes.as_ref(), &[no_bump]];

        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::CreateAccount {
                    from: ctx.accounts.authority.to_account_info(),
                    to: no_mint_info.clone(),
                },
                &[no_seeds],
            ),
            rent_lamports,
            mint_space as u64,
            &token::ID,
        )?;

        token::initialize_mint2(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::InitializeMint2 {
                    mint: no_mint_info.clone(),
                },
            ),
            9,
            &market_key,
            None,
        )?;

        words[i] = WordState {
            word_index,
            label: word_labels[i].clone(),
            yes_mint: yes_mint_pda,
            no_mint: no_mint_pda,
            yes_quantity: 0,
            no_quantity: 0,
            outcome: None,
            _reserved: [0u8; 32],
        };
    }

    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    market.version = 1;
    market.bump = ctx.bumps.market;
    market.market_id = market_id;
    market.label = label;
    market.authority = ctx.accounts.authority.key();
    market.resolver = resolver;
    market.router = None;
    market.pool_vault = ctx.accounts.vault.key();
    market.vault_bump = ctx.bumps.vault;
    market.total_lp_shares = 0;
    market.liquidity_param_b = initial_b;
    market.base_b_per_sol = base_b_per_sol;
    market.num_words = num_words as u8;
    market.words = words;
    market.status = MarketStatus::Open;
    market.created_at = clock.unix_timestamp;
    market.resolves_at = resolves_at;
    market.resolved_at = None;
    market.trade_fee_bps = trade_fee_bps;
    market.protocol_fee_bps = 0;
    market.accumulated_fees = 0;
    market._reserved = [0u8; 256];

    msg!(
        "Market created: {} (id={}, words={})",
        market.label,
        market_id,
        num_words
    );

    Ok(())
}
