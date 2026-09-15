use alloy_primitives::U256;
use risk_engine::{calculate_max_ltv_pure, integer_sqrt};

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
