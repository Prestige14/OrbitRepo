// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../contracts/solidity/RepoVault.sol";
import "../../contracts/solidity/LiquidityPool.sol";
import "../../contracts/solidity/mocks/MockStockToken.sol";
import "../../contracts/solidity/mocks/MockUSDC.sol";
import "../../contracts/solidity/mocks/MockPriceOracle.sol";
import "../../contracts/solidity/mocks/MockRiskEngine.sol";

contract RepoVaultTest is Test {
    RepoVault public vault;
    LiquidityPool public pool;
    MockUSDC public usdc;
    MockStockToken public taapl;
    MockStockToken public tnvda;
    MockPriceOracle public aaplOracle;
    MockPriceOracle public nvdaOracle;
    MockRiskEngine public riskEngine;

    address public admin = address(1);
    address public lp = address(2);
    address public borrower = address(3);
    address public liquidator = address(4);

    function setUp() public {
        vm.startPrank(admin);

        // 1. Deploy Tokens & Oracles
        usdc = new MockUSDC();
        taapl = new MockStockToken("Tokenized Apple", "tAAPL");
        tnvda = new MockStockToken("Tokenized Nvidia", "tNVDA");

        // Initial prices: AAPL = $200 (8 decimals: 200 * 10^8), NVDA = $100 (100 * 10^8)
        aaplOracle = new MockPriceOracle("AAPL / USD", 200 * 1e8);
        nvdaOracle = new MockPriceOracle("NVDA / USD", 100 * 1e8);

        // 2. Deploy Risk Engine & Pool & Vault
        riskEngine = new MockRiskEngine();
        // Configure AAPL daily vol: 3.2% (320 bps) - volatile stock
        riskEngine.setDefaultVol(address(taapl), 320);
        // Configure NVDA daily vol: 1.2% (120 bps) - stable asset
        riskEngine.setDefaultVol(address(tnvda), 120);

        pool = new LiquidityPool(address(usdc));
        vault = new RepoVault(address(pool), address(riskEngine));
        pool.setRepoVault(address(vault));

        // Whitelist assets (1 hour = 3600s staleness threshold)
        vault.whitelistAsset(address(taapl), address(aaplOracle), 3600);
        vault.whitelistAsset(address(tnvda), address(nvdaOracle), 3600);

        vm.stopPrank();

        // 3. Fund LP with USDC and deposit into pool
        usdc.mint(lp, 1_000_000 * 1e6); // 1,000,000 USDC
        vm.startPrank(lp);
        usdc.approve(address(pool), type(uint256).max);
        pool.deposit(500_000 * 1e6); // Deposit 500,000 USDC into pool
        vm.stopPrank();

        // 4. Fund Borrower with tAAPL, tNVDA & initial USDC (to pay repo interest)
        taapl.mint(borrower, 100 * 1e18); // 100 tAAPL
        tnvda.mint(borrower, 100 * 1e18); // 100 tNVDA
        usdc.mint(borrower, 1_000 * 1e6); // 1,000 USDC for fees/interest
        vm.startPrank(borrower);
        taapl.approve(address(vault), type(uint256).max);
        tnvda.approve(address(vault), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        // 5. Fund Liquidator with USDC
        usdc.mint(liquidator, 500_000 * 1e6);
        vm.startPrank(liquidator);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function test_dynamic_ltv_differentiation() public view {
        // Overnight (1 day): both hit the 80% protocol hard cap
        uint256 ltv1d_aapl = riskEngine.getMaxLTV(address(taapl), 1);
        uint256 ltv1d_nvda = riskEngine.getMaxLTV(address(tnvda), 1);
        assertEq(ltv1d_aapl, 8000); // 80.00%
        assertEq(ltv1d_nvda, 8000); // 80.00%

        // 30-day term: distinct Max LTV based on realized volatility!
        uint256 ltv30d_volatile = riskEngine.getMaxLTV(address(taapl), 30);
        uint256 ltv30d_stable = riskEngine.getMaxLTV(address(tnvda), 30);

        // Volatile stock receives ~59.17% Max LTV
        assertEq(ltv30d_volatile, 5917);
        // Stable stock receives 80.00% (hit cap)
        assertEq(ltv30d_stable, 8000);

        // Significant difference demonstrating Dynamic Risk Engine utility
        assertTrue(ltv30d_stable > ltv30d_volatile);
    }

    function test_openPosition_and_repay() public {
        vm.startPrank(borrower);

        // Deposit 10 tAAPL ($2,000 value) for 7 days
        uint256 collateralAmt = 10 * 1e18;
        uint256 usdcBefore = usdc.balanceOf(borrower);

        uint256 posId = vault.openPosition(address(taapl), collateralAmt, 7);
        assertEq(posId, 1);

        uint256 usdcAfter = usdc.balanceOf(borrower);
        assertTrue(usdcAfter > usdcBefore);

        // Check health: should be safe and not liquidatable
        (uint256 currentLtv, uint256 maxLtv, bool isLiquidatable) = vault.getPositionHealth(posId);
        assertFalse(isLiquidatable);
        assertTrue(currentLtv <= maxLtv);

        // Repay before maturity
        uint256 taaplBeforeRepay = taapl.balanceOf(borrower);
        vault.repay(posId);
        uint256 taaplAfterRepay = taapl.balanceOf(borrower);

        // Collateral fully returned
        assertEq(taaplAfterRepay - taaplBeforeRepay, collateralAmt);

        vm.stopPrank();
    }

    function test_liquidate_on_price_drop() public {
        vm.startPrank(borrower);
        // 10 tAAPL @ $200 = $2,000 value. 30-day term -> 59.17% Max LTV -> Borrow ~$1,183 USDC
        uint256 posId = vault.openPosition(address(taapl), 10 * 1e18, 30);
        vm.stopPrank();

        (,, bool isLiquidatableBefore) = vault.getPositionHealth(posId);
        assertFalse(isLiquidatableBefore);

        // Simulate market drop: AAPL price crashes 35% from $200 to $130
        aaplOracle.setPrice(130 * 1e8);

        // Now collateral value is 10 * $130 = $1,300 USDC.
        // Debt ~$1,183 USDC -> Current LTV is ~91% > 59.17% + 5% Maintenance Margin!
        (uint256 currentLtv, uint256 maxLtv, bool isLiquidatableAfter) = vault.getPositionHealth(posId);
        assertTrue(currentLtv > maxLtv);
        assertTrue(isLiquidatableAfter);

        // Liquidator liquidates position
        uint256 liquidatorTaaplBefore = taapl.balanceOf(liquidator);
        vm.prank(liquidator);
        vault.liquidate(posId);
        uint256 liquidatorTaaplAfter = taapl.balanceOf(liquidator);

        // Liquidator receives all 10 tAAPL collateral
        assertEq(liquidatorTaaplAfter - liquidatorTaaplBefore, 10 * 1e18);

        // Position is now closed
        (,, bool isLiquidatableClosed) = vault.getPositionHealth(posId);
        assertFalse(isLiquidatableClosed);
    }

    function test_oracle_staleness_rejection() public {
        // Fast forward time past staleness threshold (3600 seconds)
        vm.warp(block.timestamp + 4000);

        vm.startPrank(borrower);
        vm.expectRevert(RepoVault.OraclePriceStale.selector);
        vault.openPosition(address(taapl), 10 * 1e18, 1);
        vm.stopPrank();
    }
}
