use anchor_lang::prelude::*;
use crate::state::UserEscrow;
use crate::errors::MentionMarketError;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", user.key().as_ref()],
        bump = escrow.bump,
        constraint = escrow.owner == user.key() @ MentionMarketError::NotOwner,
    )]
    pub escrow: Account<'info, UserEscrow>,

    pub system_program: Program<'info, System>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, MentionMarketError::ZeroAmount);

    let escrow = &mut ctx.accounts.escrow;
    require!(
        amount <= escrow.balance,
        MentionMarketError::InsufficientBalance
    );

    escrow.balance = escrow
        .balance
        .checked_sub(amount)
        .ok_or(MentionMarketError::MathOverflow)?;

    // Transfer SOL from escrow PDA back to user wallet
    **escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.user.to_account_info().try_borrow_mut_lamports()? += amount;

    msg!(
        "Withdrew {} lamports. Remaining balance: {}, locked: {}",
        amount,
        escrow.balance,
        escrow.locked,
    );

    Ok(())
}
