use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::metadata::{
    create_metadata_accounts_v3,
    mpl_token_metadata,
    CreateMetadataAccountsV3,
    Metadata,
};
use anchor_spl::metadata::mpl_token_metadata::types::DataV2;
use crate::state::{
    MarketAccount, MarketStatus, WordState,
    MAX_WORDS, MAX_MARKET_LABEL, MAX_WORD_LABEL, USDC_MINT,
};
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
    pub token_metadata_program: Program<'info, Metadata>,

    // remaining_accounts: for each word i:
    //   [i*4 + 0] = yes_mint      (writable, PDA)
    //   [i*4 + 1] = yes_metadata  (writable, Metaplex PDA)
    //   [i*4 + 2] = no_mint       (writable, PDA)
    //   [i*4 + 3] = no_metadata   (writable, Metaplex PDA)
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

    let num_words = word_labels.len();

    // We expect 4 * num_words remaining accounts (yes_mint, yes_metadata, no_mint, no_metadata per word)
    require!(
        ctx.remaining_accounts.len() == 4 * num_words,
        AmmError::TooManyWords
    );

    let market_id_bytes = market_id.to_le_bytes();
    let market_key = ctx.accounts.market.key();
    let market_bump = ctx.bumps.market;
    let market_seeds: &[&[u8]] = &[b"market", market_id_bytes.as_ref(), &[market_bump]];

    // Initialize each word's YES/NO mints via CPI
    let mut words: [WordState; MAX_WORDS] = core::array::from_fn(|_| WordState::default());

    for i in 0..num_words {
        let yes_mint_info     = &ctx.remaining_accounts[i * 4];
        let yes_metadata_info = &ctx.remaining_accounts[i * 4 + 1];
        let no_mint_info      = &ctx.remaining_accounts[i * 4 + 2];
        let no_metadata_info  = &ctx.remaining_accounts[i * 4 + 3];
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

        // Verify metadata PDAs
        let (yes_metadata_pda, _) = Pubkey::find_program_address(
            &[b"metadata", mpl_token_metadata::ID.as_ref(), yes_mint_pda.as_ref()],
            &mpl_token_metadata::ID,
        );
        require!(yes_metadata_info.key() == yes_metadata_pda, AmmError::InvalidWordIndex);

        let (no_metadata_pda, _) = Pubkey::find_program_address(
            &[b"metadata", mpl_token_metadata::ID.as_ref(), no_mint_pda.as_ref()],
            &mpl_token_metadata::ID,
        );
        require!(no_metadata_info.key() == no_metadata_pda, AmmError::InvalidWordIndex);

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

        // 6 decimals: 1 full YES token = 1_000_000 base units = 1 USDC
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

        // Attach metadata to YES mint
        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: yes_metadata_info.clone(),
                    mint: yes_mint_info.clone(),
                    mint_authority: ctx.accounts.market.to_account_info(),
                    payer: ctx.accounts.authority.to_account_info(),
                    update_authority: ctx.accounts.market.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                &[market_seeds],
            ),
            DataV2 {
                name: build_name(&word_labels[i], "YES"),
                symbol: build_symbol(&word_labels[i], "Y"),
                uri: String::new(),
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true,  // is_mutable
            true,  // update_authority_is_signer
            None,  // collection_details
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

        // 6 decimals: 1 full NO token = 1_000_000 base units = 1 USDC
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

        // Attach metadata to NO mint
        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: no_metadata_info.clone(),
                    mint: no_mint_info.clone(),
                    mint_authority: ctx.accounts.market.to_account_info(),
                    payer: ctx.accounts.authority.to_account_info(),
                    update_authority: ctx.accounts.market.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                &[market_seeds],
            ),
            DataV2 {
                name: build_name(&word_labels[i], "NO"),
                symbol: build_symbol(&word_labels[i], "N"),
                uri: String::new(),
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            true,
            true,
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

/// Build token name, truncated to 32 chars.
/// e.g. "Bitcoin YES", "Economy NO"
fn build_name(word_label: &str, side: &str) -> String {
    let name = format!("{} {}", word_label, side);
    if name.len() > 32 {
        name[..32].to_string()
    } else {
        name
    }
}

/// Build token symbol (max 10 chars).
/// Takes first 4 alphanumeric chars of word, uppercased, plus "-Y" or "-N".
/// e.g. "Bitcoin" + "Y" -> "BITC-Y", "Economy" + "N" -> "ECON-N"
fn build_symbol(word_label: &str, side: &str) -> String {
    let prefix: String = word_label
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(4)
        .collect::<String>()
        .to_uppercase();
    let sym = format!("{}-{}", prefix, side);
    if sym.len() > 10 {
        sym[..10].to_string()
    } else {
        sym
    }
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
