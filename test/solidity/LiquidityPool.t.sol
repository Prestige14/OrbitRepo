// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../contracts/solidity/LiquidityPool.sol";
import "../../contracts/solidity/mocks/MockUSDC.sol";

contract LiquidityPoolTest is Test {
    LiquidityPool public pool;
    MockUSDC public usdc;

    address public lp1 = address(1);
    address public lp2 = address(2);
    address public mockVault = address(3);

    function setUp() public {
        usdc = new MockUSDC();
        pool = new LiquidityPool(address(usdc));
        pool.setRepoVault(mockVault);

        usdc.mint(lp1, 100_000 * 1e6);
        usdc.mint(lp2, 100_000 * 1e6);

        vm.prank(lp1);
        usdc.approve(address(pool), type(uint256).max);

        vm.prank(lp2);
        usdc.approve(address(pool), type(uint256).max);
    }

    function test_deposit_and_withdraw() public {
        // LP1 deposits 10,000 USDC
        vm.prank(lp1);
        uint256 shares = pool.deposit(10_000 * 1e6);
        assertEq(shares, 10_000 * 1e6);
        assertEq(pool.sharesOf(lp1), shares);
        assertEq(pool.availableLiquidity(), 10_000 * 1e6);

        // LP1 withdraws half
        vm.prank(lp1);
        uint256 withdrawn = pool.withdraw(5_000 * 1e6);
        assertEq(withdrawn, 5_000 * 1e6);
        assertEq(pool.availableLiquidity(), 5_000 * 1e6);
    }

    function test_yield_accrual_benefits_lps() public {
        // LP1 deposits 10,000 USDC
        vm.prank(lp1);
        pool.deposit(10_000 * 1e6);

        // MockVault borrows 5,000 USDC
        address borrower = address(10);
        vm.prank(mockVault);
        pool.borrowStablecoin(borrower, 5_000 * 1e6);

        assertEq(pool.totalBorrowed(), 5_000 * 1e6);
        assertEq(pool.availableLiquidity(), 5_000 * 1e6);
        assertEq(pool.totalAssets(), 10_000 * 1e6);

        // Vault returns loan with 100 USDC interest (5,000 principal + 100 interest = 5,100 USDC)
        usdc.mint(mockVault, 5_100 * 1e6);
        vm.startPrank(mockVault);
        usdc.approve(address(pool), type(uint256).max);
        pool.returnStablecoin(5_000 * 1e6, 100 * 1e6);
        vm.stopPrank();

        // Total assets grew to 10,100 USDC
        assertEq(pool.totalAssets(), 10_100 * 1e6);

        // When LP1 withdraws all shares, they receive 10,100 USDC (earned 100 USDC yield)
        uint256 lp1Shares = pool.sharesOf(lp1);
        vm.prank(lp1);
        uint256 finalAmount = pool.withdraw(lp1Shares);
        assertEq(finalAmount, 10_100 * 1e6);
    }
}
