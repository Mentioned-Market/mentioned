/// Fixed-point math library for LMSR pricing.
///
/// All values are scaled by PRECISION = 1e6 (matching USDC decimals).
/// Example: 0.65 USDC is stored as 650_000.
/// Uses u128 for intermediate calculations to avoid overflow.

use crate::errors::AmmError;
use anchor_lang::prelude::*;

pub const PRECISION: u64 = 1_000_000; // 1e6
const PRECISION_I128: i128 = PRECISION as i128;
const PRECISION_U128: u128 = PRECISION as u128;

/// ln(2) scaled by 1e6: ln(2) * 1_000_000 = 693_147.18... truncated to 693_147
const LN2: i128 = 693_147;

// ---------------------------------------------------------------------------
// Fixed-point exp(x) where x is scaled by 1e6
//
// Strategy: decompose x into integer and fractional parts of ln(2).
//   exp(x) = exp(k * ln2 + r) = 2^k * exp(r)
// where |r| < ln(2)/2, and exp(r) is approximated with a Taylor series.
//
// Supports negative inputs; output is always positive.
// Returns u128 scaled by 1e6.
// ---------------------------------------------------------------------------

/// Fixed-point exp. Input: i64 scaled by 1e6. Output: u128 scaled by 1e6.
pub fn fp_exp(x: i64) -> Result<u128> {
    let x = x as i128;

    // For very negative values, result rounds to 0
    if x < -20 * PRECISION_I128 {
        return Ok(0);
    }
    // For very large values, cap to prevent overflow
    if x > 30 * PRECISION_I128 {
        return err!(AmmError::MathOverflow);
    }

    // Decompose: x = k * ln(2) + r
    // k = floor(x / ln2), but we need to be careful with negative division
    let k = if x >= 0 {
        x / LN2
    } else {
        (x - LN2 + 1) / LN2 // floor division for negatives
    };
    let r = x - k * LN2; // remainder, |r| < ln(2)

    // Taylor series for exp(r): 1 + r + r²/2! + r³/3! + r⁴/4! + r⁵/5! + r⁶/6!
    // All computed in fixed-point with PRECISION scaling
    let r2 = r * r / PRECISION_I128;
    let r3 = r2 * r / PRECISION_I128;
    let r4 = r3 * r / PRECISION_I128;
    let r5 = r4 * r / PRECISION_I128;
    let r6 = r5 * r / PRECISION_I128;

    let exp_r = PRECISION_I128
        + r
        + r2 / 2
        + r3 / 6
        + r4 / 24
        + r5 / 120
        + r6 / 720;

    // Multiply by 2^k
    let result = if k >= 0 {
        let shift = k as u32;
        if shift > 60 {
            return err!(AmmError::MathOverflow);
        }
        (exp_r as u128) << shift
    } else {
        let shift = (-k) as u32;
        if shift > 60 {
            return Ok(0);
        }
        (exp_r as u128) >> shift
    };

    Ok(result)
}

// ---------------------------------------------------------------------------
// Fixed-point ln(x) where x is u128 scaled by 1e6
//
// Strategy: decompose x = m * 2^k where 1 <= m < 2 (in fixed-point).
//   ln(x) = k * ln(2) + ln(m)
// ln(m) is approximated with a polynomial for m in [1, 2).
//
// Returns i64 scaled by 1e6.
// ---------------------------------------------------------------------------

/// Fixed-point natural log. Input: u128 scaled by 1e6 (must be > 0). Output: i64 scaled by 1e6.
pub fn fp_ln(x: u128) -> Result<i64> {
    if x == 0 {
        return err!(AmmError::MathOverflow);
    }

    // Find k such that x / 2^k is in [PRECISION, 2*PRECISION)
    // i.e. normalized mantissa in [1.0, 2.0) in fixed-point
    let mut m = x;
    let mut k: i64 = 0;

    while m >= 2 * PRECISION_U128 {
        m >>= 1;
        k += 1;
    }
    while m < PRECISION_U128 {
        m <<= 1;
        k -= 1;
    }

    // Now m is in [PRECISION, 2*PRECISION)
    // Compute ln(m) where m = 1 + f, f in [0, 1)
    // ln(1 + f) ≈ f - f²/2 + f³/3 - f⁴/4 + f⁵/5
    let f = m as i128 - PRECISION_I128; // f in [0, PRECISION)

    let f2 = f * f / PRECISION_I128;
    let f3 = f2 * f / PRECISION_I128;
    let f4 = f3 * f / PRECISION_I128;
    let f5 = f4 * f / PRECISION_I128;

    let ln_m = f - f2 / 2 + f3 / 3 - f4 / 4 + f5 / 5;

    // ln(x) = k * ln(2) + ln(m)
    let result = k as i128 * LN2 + ln_m;
    Ok(result as i64)
}

// ---------------------------------------------------------------------------
// LMSR functions
// ---------------------------------------------------------------------------

/// Binary LMSR cost function for a single word.
/// C(q_yes, q_no) = b * ln( exp(q_yes / b) + exp(q_no / b) )
///
/// All inputs/outputs scaled by PRECISION (1e6).
pub fn binary_lmsr_cost(q_yes: i64, q_no: i64, b: u64) -> Result<u64> {
    if b == 0 {
        return err!(AmmError::ZeroLiquidity);
    }
    let b128 = b as i128;

    // Compute q_yes / b and q_no / b (fixed-point division)
    let scaled_yes = (q_yes as i128) * PRECISION_I128 / b128;
    let scaled_no = (q_no as i128) * PRECISION_I128 / b128;

    let exp_yes = fp_exp(scaled_yes as i64)?;
    let exp_no = fp_exp(scaled_no as i64)?;

    let sum = exp_yes.checked_add(exp_no).ok_or(AmmError::MathOverflow)?;

    let ln_sum = fp_ln(sum)?;

    // b * ln_sum / PRECISION
    let cost = (b128 * ln_sum as i128) / PRECISION_I128;

    if cost < 0 {
        return err!(AmmError::MathOverflow);
    }

    Ok(cost as u64)
}

/// Cost to buy `amount` of YES or NO tokens for a single word.
/// Returns the cost in USDC base units (scaled by 1e6).
pub fn calculate_buy_cost(
    q_yes: i64,
    q_no: i64,
    direction: crate::state::Side,
    amount: u64,
    b: u64,
) -> Result<u64> {
    let cost_before = binary_lmsr_cost(q_yes, q_no, b)?;

    let (new_yes, new_no) = match direction {
        crate::state::Side::Yes => (
            q_yes.checked_add(amount as i64).ok_or(AmmError::MathOverflow)?,
            q_no,
        ),
        crate::state::Side::No => (
            q_yes,
            q_no.checked_add(amount as i64).ok_or(AmmError::MathOverflow)?,
        ),
    };

    let cost_after = binary_lmsr_cost(new_yes, new_no, b)?;

    cost_after
        .checked_sub(cost_before)
        .ok_or_else(|| error!(AmmError::MathOverflow))
}

/// Amount recovered when selling `amount` of YES or NO tokens.
/// Returns the return in USDC base units (scaled by 1e6).
pub fn calculate_sell_return(
    q_yes: i64,
    q_no: i64,
    direction: crate::state::Side,
    amount: u64,
    b: u64,
) -> Result<u64> {
    let cost_before = binary_lmsr_cost(q_yes, q_no, b)?;

    let (new_yes, new_no) = match direction {
        crate::state::Side::Yes => (
            q_yes.checked_sub(amount as i64).ok_or(AmmError::MathOverflow)?,
            q_no,
        ),
        crate::state::Side::No => (
            q_yes,
            q_no.checked_sub(amount as i64).ok_or(AmmError::MathOverflow)?,
        ),
    };

    let cost_after = binary_lmsr_cost(new_yes, new_no, b)?;

    cost_before
        .checked_sub(cost_after)
        .ok_or_else(|| error!(AmmError::MathOverflow))
}

/// Implied YES price for a single word.
/// Returns fixed-point price in [0, PRECISION].
pub fn implied_price(q_yes: i64, q_no: i64, b: u64) -> Result<u64> {
    if b == 0 {
        return err!(AmmError::ZeroLiquidity);
    }
    let b128 = b as i128;

    let scaled_yes = (q_yes as i128) * PRECISION_I128 / b128;
    let scaled_no = (q_no as i128) * PRECISION_I128 / b128;

    let exp_yes = fp_exp(scaled_yes as i64)?;
    let exp_no = fp_exp(scaled_no as i64)?;

    let sum = exp_yes.checked_add(exp_no).ok_or(AmmError::MathOverflow)?;

    if sum == 0 {
        return err!(AmmError::MathOverflow);
    }

    // p_yes = exp_yes * PRECISION / sum
    let price = exp_yes * PRECISION_U128 / sum;
    Ok(price as u64)
}
