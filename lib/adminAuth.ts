const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '').split(',').map(w => w.trim()).filter(Boolean)

export function isAdmin(wallet: string): boolean {
  return ADMIN_WALLETS.includes(wallet)
}
