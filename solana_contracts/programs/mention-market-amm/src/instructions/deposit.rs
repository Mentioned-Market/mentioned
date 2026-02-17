use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::UserEscrow;
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserEscrow::SIZE,
        seeds = [b"escrow", user.key().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, UserEscrow>,

    pub system_program: Program<'info, System>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, AmmError::ZeroAmount);

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        ),
        amount,
    )?;

    let escrow = &mut ctx.accounts.escrow;
    escrow.owner = ctx.accounts.user.key();
    escrow.balance = escrow
        .balance
        .checked_add(amount)
        .ok_or(AmmError::MathOverflow)?;
    escrow.bump = ctx.bumps.escrow;

    emit!(EscrowEvent {
        user: ctx.accounts.user.key(),
        action: EscrowAction::Deposit,
        amount,
        new_balance: escrow.balance,
        timestamp: Clock::get()?.unix_timestamp,
    });

    msg!("Deposited {} lamports. New balance: {}", amount, escrow.balance);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowAction {
    Deposit,
    Withdraw,
}

#[event]
pub struct EscrowEvent {
    pub user: Pubkey,
    pub action: EscrowAction,
    pub amount: u64,
    pub new_balance: u64,
    pub timestamp: i64,
}
