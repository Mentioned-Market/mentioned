use anchor_lang::prelude::*;
use crate::state::UserEscrow;
use crate::errors::AmmError;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", user.key().as_ref()],
        bump = escrow.bump,
        constraint = escrow.owner == user.key() @ AmmError::NotOwner,
    )]
    pub escrow: Account<'info, UserEscrow>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, AmmError::ZeroAmount);

    let escrow = &mut ctx.accounts.escrow;
    require!(amount <= escrow.balance, AmmError::InsufficientBalance);

    escrow.balance = escrow
        .balance
        .checked_sub(amount)
        .ok_or(AmmError::MathOverflow)?;

    // Transfer SOL from escrow PDA back to user wallet
    **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += amount;

    msg!("Withdrew {} lamports. Remaining balance: {}", amount, escrow.balance);
    Ok(())
}
