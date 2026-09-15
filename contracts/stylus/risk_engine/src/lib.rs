#![cfg_attr(not(feature = "export-abi"), no_main)]
extern crate alloc;

use alloc::vec::Vec;
use alloy_primitives::{Address, U256};
use stylus_sdk::prelude::*;

sol_storage! {
    #[entrypoint]
    pub struct RiskEngine {
        mapping(address => uint256) default_vol_bps;
        mapping(address => uint256[]) price_buffers;
        address admin;
        bool initialized;
    }
}

pub const BPS_DIVISOR: u64 = 10_000;
pub const LTV_MIN_BPS: u64 = 2_000; // 20.00%
pub const LTV_MAX_BPS: u64 = 8_000; // 80.00%
pub const DEFAULT_DAILY_VOL_BPS: u64 = 220; // 2.20% daily volatility (~35% annualized)

/// Integer square root using the Babylonian method
pub fn integer_sqrt(val: U256) -> U256 {
    if val == U256::ZERO {
        return U256::ZERO;
    }
    let two = U256::from(2);
    let mut x0 = val / two;
    if x0 == U256::ZERO {
        return U256::from(1);
    }
    let mut x1 = (x0 + val / x0) / two;
    while x1 < x0 {
        x0 = x1;
        x1 = (x0 + val / x0) / two;
    }
    x0
}

/// Pure math calculation for Max LTV using Parametric VaR
pub fn calculate_max_ltv_pure(daily_vol_bps: U256, term_days: U256) -> U256 {
    // z_alpha = 2.33 for 99% confidence interval
    let z_scaled = U256::from(233); // 2.33 * 100

    // Compute sqrt(t) scaled by 1,000 using integer_sqrt
    let term_scaled = term_days * U256::from(1_000_000);
    let sqrt_t_scaled = integer_sqrt(term_scaled);

    // Haircut in basis points = (z * sigma_daily * sqrt_t) / (100 * 1000)
    let haircut_bps = (z_scaled * daily_vol_bps * sqrt_t_scaled) / U256::from(100_000);

    let max_ltv = if haircut_bps >= U256::from(BPS_DIVISOR) {
        U256::from(LTV_MIN_BPS)
    } else {
        U256::from(BPS_DIVISOR) - haircut_bps
    };

    // Protocol Hard Clamping: 20% (2,000 bps) to 80% (8,000 bps)
    if max_ltv > U256::from(LTV_MAX_BPS) {
        U256::from(LTV_MAX_BPS)
    } else if max_ltv < U256::from(LTV_MIN_BPS) {
        U256::from(LTV_MIN_BPS)
    } else {
        max_ltv
    }
}

#[public]
impl RiskEngine {
    /// Initialize admin and baseline settings
    pub fn init(&mut self) -> Result<(), Vec<u8>> {
        if !self.initialized.get() {
            self.initialized.set(true);
            self.admin.set(self.vm().msg_sender());
        }
        Ok(())
    }

    /// Set baseline volatility for an asset (e.g. for bootstrapping / cold-start)
    pub fn set_default_vol(&mut self, asset: Address, vol_bps: U256) -> Result<(), Vec<u8>> {
        self.default_vol_bps.setter(asset).set(vol_bps);
        Ok(())
    }

    /// Push latest observed price to the asset's rolling buffer
    pub fn push_price(&mut self, asset: Address, price: U256, _timestamp: U256) -> Result<(), Vec<u8>> {
        let mut buffer = self.price_buffers.setter(asset);
        buffer.push(price);
        Ok(())
    }

    /// Computes realized rolling daily volatility in basis points (10000 = 100%)
    pub fn get_realized_vol(&self, asset: Address) -> Result<U256, Vec<u8>> {
        let buffer = self.price_buffers.getter(asset);
        let len = buffer.len();

        // If buffer has fewer than 2 data points, return default/bootstrapped volatility
        if len < 2 {
            let custom_default = self.default_vol_bps.get(asset);
            if custom_default > U256::ZERO {
                return Ok(custom_default);
            }
            return Ok(U256::from(DEFAULT_DAILY_VOL_BPS));
        }

        // Calculate variance across consecutive price returns: r_t = |P_t - P_(t-1)| / P_(t-1)
        let mut sum_squared_returns = U256::ZERO;
        let count = (len - 1) as u64;

        for i in 1..len {
            let p_prev = buffer.get(i - 1).unwrap();
            let p_curr = buffer.get(i).unwrap();

            if p_prev > U256::ZERO {
                let diff = if p_curr >= p_prev {
                    p_curr - p_prev
                } else {
                    p_prev - p_curr
                };

                let return_bps = (diff * U256::from(BPS_DIVISOR)) / p_prev;
                sum_squared_returns += return_bps * return_bps;
            }
        }

        let mean_squared_return = sum_squared_returns / U256::from(count);
        let daily_vol_bps = integer_sqrt(mean_squared_return);

        Ok(daily_vol_bps)
    }

    /// Computes dynamically tailored Max LTV (in basis points) using Parametric VaR
    pub fn get_max_ltv(&self, asset: Address, term_days: U256) -> Result<U256, Vec<u8>> {
        let daily_vol = self.get_realized_vol(asset)?;
        Ok(calculate_max_ltv_pure(daily_vol, term_days))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_integer_sqrt() {
        assert_eq!(integer_sqrt(U256::ZERO), U256::ZERO);
        assert_eq!(integer_sqrt(U256::from(1)), U256::from(1));
        assert_eq!(integer_sqrt(U256::from(4)), U256::from(2));
        assert_eq!(integer_sqrt(U256::from(9)), U256::from(3));
        assert_eq!(integer_sqrt(U256::from(1_000_000)), U256::from(1_000));
        assert_eq!(integer_sqrt(U256::from(7_000_000)), U256::from(2645)); // sqrt(7) ~= 2.6457
        assert_eq!(integer_sqrt(U256::from(30_000_000)), U256::from(5477)); // sqrt(30) ~= 5.4772
    }

    #[test]
    fn test_srs_table_volatile_stock() {
        // SRS 7.3: Volatile stock, sigma_daily = 3.2% (320 bps)
        let vol_bps = U256::from(320);

        // 1-day term (Overnight): Haircut = 7.5%, Max LTV = 80% (clamped at 80% cap)
        let ltv_1d = calculate_max_ltv_pure(vol_bps, U256::from(1));
        assert_eq!(ltv_1d, U256::from(8000)); // 80.00% hard cap

        // 30-day term: Haircut = 40.8%, Max LTV = 59.2% (5917 bps)
        let ltv_30d = calculate_max_ltv_pure(vol_bps, U256::from(30));
        assert_eq!(ltv_30d, U256::from(5917)); // 59.17% (59.2%)
    }

    #[test]
    fn test_srs_table_stable_etf() {
        // SRS 7.3: Broad-market ETF, sigma_daily = 1.2% (120 bps)
        let vol_bps = U256::from(120);

        // 1-day term: Haircut = 2.8%, Max LTV clamped to 80%
        let ltv_1d = calculate_max_ltv_pure(vol_bps, U256::from(1));
        assert_eq!(ltv_1d, U256::from(8000));

        // 30-day term: Haircut = 15.3%, Max LTV = 84.7% -> clamped to 80% hard cap
        let ltv_30d = calculate_max_ltv_pure(vol_bps, U256::from(30));
        assert_eq!(ltv_30d, U256::from(8000));
    }

    #[test]
    fn test_extreme_risk_floor_clamping() {
        // Highly volatile speculative asset (e.g. 10% daily vol = 1000 bps)
        let extreme_vol = U256::from(1000);
        let ltv_30d = calculate_max_ltv_pure(extreme_vol, U256::from(30));
        assert_eq!(ltv_30d, U256::from(2000)); // 20.00% floor clamp
    }
}
