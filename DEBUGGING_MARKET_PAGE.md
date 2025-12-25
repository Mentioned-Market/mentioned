# 🐛 Debugging Market Page

## What I Added

Enhanced error handling and logging to help diagnose the issue:

### 1. Better Console Logging
- Shows which event/markets are being loaded
- Displays all PDAs being derived
- Shows token balances fetched
- Logs success/failure for each market

### 2. More Specific Error Messages
- Shows which events exist in registry
- Identifies which step failed
- Provides actionable next steps

---

## 🔍 How to Debug

### Step 1: Open Browser Console

1. Go to `http://localhost:3000/event/1`
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Go to Console tab

### Step 2: Check Console Output

You should see logs like:

```
Full registry: { "1": [{id: "...", word: "..."}] }
Markets for event 1: [{...}]
Event PDA: ABC123...
Fetching market for word: Mexico, id: 1234567890
Market PDA: XYZ789...
Derived PDAs for Mexico: { yesMint: ..., noMint: ..., yesVault: ..., noVault: ... }
Token balances for Mexico: { yes: 100000000, no: 100000000 }
Successfully loaded Mexico: { yesPrice: 0.5, noPrice: 0.5, liquidity: 0.1 }
```

### Step 3: Identify the Issue

**Common Issues:**

#### Issue 1: "No markets found"
```
Full registry: {}
```
**Fix:** Create markets in admin panel first

#### Issue 2: "No markets for Event 1"
```
Full registry: { "2": [...] }
Markets for event 1: undefined
```
**Fix:** Registry has different event ID. Check what events exist.

#### Issue 3: "Market account not found"
```
Market account not found for Mexico at ABC123...
```
**Fix:** Market wasn't created on-chain. Check admin panel.

#### Issue 4: "Token balances: { yes: 0, no: 0 }"
```
Token balances for Mexico: { yes: 0, no: 0 }
```
**Fix:** No liquidity added. Click "💧 Add Liquidity" in admin panel.

#### Issue 5: Vault account doesn't exist
```
Error fetching token balance: Account not found
```
**Fix:** Vaults weren't initialized. This means contract deployment issue.

---

## 🛠️ Quick Fixes

### Fix 1: Check localStorage

Open browser console and run:

```javascript
localStorage.getItem("marketRegistry")
```

Should show:
```json
{"1":[{"id":"1234567890","word":"Mexico","yesMint":"...","noMint":"..."}]}
```

If empty: Create markets in admin panel

### Fix 2: Verify Admin Pubkey

The page uses hardcoded admin:
```typescript
const ADMIN_PUBKEY = new PublicKey("AmMusRD99A7CnHNhNziN4f2Fm6V9D4NW1soH4rUn8t7S")
```

Make sure this matches YOUR wallet address that created the event!

**To check your wallet address:**
1. Go to admin panel
2. Connect wallet
3. Look at "Connected" address
4. Should match `AmMusRD99A7CnHNhNziN4f2Fm6V9D4NW1soH4rUn8t7S`

If different, update line 60 in `/app/event/[id]/page.tsx`

### Fix 3: Verify Event Exists On-Chain

```javascript
// In browser console
const connection = new Connection("https://api.devnet.solana.com")
const eventPda = new PublicKey("YOUR_EVENT_PDA_FROM_CONSOLE")
const accountInfo = await connection.getAccountInfo(eventPda)
console.log("Event exists:", accountInfo !== null)
```

### Fix 4: Check Solana Explorer

1. Copy the Event PDA from console logs
2. Visit: `https://explorer.solana.com/address/[EVENT_PDA]?cluster=devnet`
3. Should show account exists
4. Check if it has data

Same for Market PDAs, Vault PDAs, etc.

---

## 📊 What Should Work

### Successful Load Sequence:

```
1. ✅ Full registry loaded
2. ✅ Markets for event 1 found (array with 1+ items)
3. ✅ Event PDA derived
4. ✅ For each market:
   ✅ Market PDA derived
   ✅ Market account found on-chain
   ✅ Mint PDAs derived
   ✅ Vault PDAs derived
   ✅ Token balances fetched (> 0 if liquidity added)
   ✅ Prices calculated
5. ✅ Markets displayed in UI
```

---

## 🔧 Manual Test

If automated loading fails, test manually in console:

```javascript
// Test 1: Check registry
const registry = JSON.parse(localStorage.getItem("marketRegistry"))
console.log("Registry:", registry)

// Test 2: Derive PDA manually
import { PublicKey } from "@solana/web3.js"
import BN from "bn.js"

const adminPubkey = new PublicKey("AmMusRD99A7CnHNhNziN4f2Fm6V9D4NW1soH4rUn8t7S")
const eventId = new BN(1)
const programId = new PublicKey("F8EsP2rp6FBuaTfKQ8ywx4hqhM3YpcJr4HPkXHeGsZyJ")

const [eventPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("event"), adminPubkey.toBuffer(), eventId.toArrayLike(Buffer, "le", 8)],
  programId
)

console.log("Event PDA:", eventPda.toString())

// Test 3: Check on Solana Explorer
// Visit: https://explorer.solana.com/address/[eventPda]?cluster=devnet
```

---

## 🎯 Next Steps

1. **Refresh the page** (Cmd+Shift+R / Ctrl+Shift+R)
2. **Check console logs** - copy and share any errors
3. **Verify localStorage** - make sure registry exists
4. **Check admin pubkey** - make sure it matches your wallet

Share the console output and I can help diagnose further!

---

## 📝 Common Mistakes

### Mistake 1: Wrong Event ID
- Admin panel shows Event #1234567890
- But you're visiting /event/1
- **Fix:** Visit /event/1234567890 instead

### Mistake 2: Wrong Admin
- Markets created by wallet A
- Trying to load with wallet B's address
- **Fix:** Update ADMIN_PUBKEY in page.tsx

### Mistake 3: No Liquidity
- Markets created ✅
- But no liquidity added ❌
- Balances show 0/0
- **Fix:** Add liquidity in admin panel

### Mistake 4: Browser Cache
- Old data in localStorage
- **Fix:** Clear and recreate markets

---

**Check the console and let me know what you see!** 🔍

