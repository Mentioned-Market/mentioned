use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use crate::state::{
    MarketAccount, MarketStatus, WordState,
    MAX_WORDS, MAX_MARKET_LABEL, MAX_WORD_LABEL, USDC_MINT,
};
use crate::errors::AmmError;
use crate::math::PRECISION;

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

    /// The USDC mint — validated against the USDC_MINT constant
    #[account(
        constraint = usdc_mint.key() == USDC_MINT.parse::<Pubkey>().unwrap() @ AmmError::InvalidUsdcMint,
    )]
    pub usdc_mint: Account<'info, Mint>,

    /// Market's USDC vault: ATA owned by market PDA — address is deterministic
    /// client-side via getAssociatedTokenAddress(usdcMint, marketPDA)
    #[account(
        init,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,

    // remaining_accounts: for each word i:
    //   [i*2 + 0] = yes_mint  (writable, PDA)
    //   [i*2 + 1] = no_mint   (writable, PDA)
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
    base_b_per_usdc: u64,
) -> Result<()> {
    require!(label.len() <= MAX_MARKET_LABEL, AmmError::MarketLabelTooLong);
    require!(!word_labels.is_empty(), AmmError::NoWords);
    require!(word_labels.len() <= MAX_WORDS, AmmError::TooManyWords);
    for wl in &word_labels {
        require!(wl.len() <= MAX_WORD_LABEL, AmmError::WordLabelTooLong);
    }

    // H1: Cap fees at 10% to prevent trades that drain user funds
    require!(trade_fee_bps <= 1000, AmmError::FeeTooHigh);

    // M3: At least one b source must be non-zero or all trades fail immediately
    require!(initial_b > 0 || base_b_per_usdc > 0, AmmError::ZeroLiquidity);

    // C2: Cap dynamic b scaling so b can never exceed the vault balance.
    // With base_b_per_usdc <= PRECISION (1:1), b = vault * ratio <= vault, which
    // guarantees the vault always covers the worst-case LP loss of b * ln(2) < b.
    require!(
        base_b_per_usdc == 0 || base_b_per_usdc <= PRECISION,
        AmmError::InvalidBParameter,
    );

    let num_words = word_labels.len();

    // We expect 2 * num_words remaining accounts (yes_mint, no_mint per word)
    require!(
        ctx.remaining_accounts.len() == 2 * num_words,
        AmmError::TooManyWords
    );

    let market_id_bytes = market_id.to_le_bytes();
    let market_key = ctx.accounts.market.key();

    // Initialize each word's YES/NO mints via CPI
    let mut words: [WordState; MAX_WORDS] = core::array::from_fn(|_| WordState::default());

    for i in 0..num_words {
        let yes_mint_info = &ctx.remaining_accounts[i * 2];
        let no_mint_info  = &ctx.remaining_accounts[i * 2 + 1];
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

        // ── Create & init YES mint (6 decimals, matching USDC) ─────────────
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
            6,
            &market_key,
            None,
        )?;

        // ── Create & init NO mint (6 decimals, matching USDC) ──────────────
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
            6,
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
    market.label = label.clone();
    market.authority = ctx.accounts.authority.key();
    market.resolver = resolver;
    market.usdc_mint = ctx.accounts.usdc_mint.key();
    market.total_lp_shares = 0;
    market.liquidity_param_b = initial_b;
    market.base_b_per_usdc = base_b_per_usdc;
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

    emit!(MarketCreatedEvent {
        market_id,
        label,
        num_words: num_words as u8,
        authority: ctx.accounts.authority.key(),
        resolver,
        resolves_at,
        trade_fee_bps,
        initial_b,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Market created: {} (id={}, words={})",
        market.label,
        market_id,
        num_words
    );

    Ok(())
}

#[event]
pub struct MarketCreatedEvent {
    pub market_id: u64,
    pub label: String,
    pub num_words: u8,
    pub authority: Pubkey,
    pub resolver: Pubkey,
    pub resolves_at: i64,
    pub trade_fee_bps: u16,
    pub initial_b: u64,
    pub timestamp: i64,
}
