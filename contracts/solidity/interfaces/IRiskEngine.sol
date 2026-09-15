// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IRiskEngine
 * @notice Interface for the Arbitrum Stylus Dynamic Risk Engine.
 * @dev Computes rolling volatility and dynamic haircuts / Max LTV based on parametric VaR.
 */
interface IRiskEngine {
    /**
     * @notice Returns the dynamically calculated Max LTV in basis points (10000 = 100%).
     * @param asset The collateral asset address.
     * @param termDays The fixed term in days (e.g. 1, 7, 30).
     * @return maxLtvBps The maximum Loan-to-Value ratio in basis points (e.g. 7500 = 75%).
     */
    function getMaxLTV(address asset, uint8 termDays) external view returns (uint256 maxLtvBps);

    /**
     * @notice Returns realized rolling volatility for the asset in basis points (10000 = 100%).
     * @param asset The collateral asset address.
     * @return volBps The annualized or daily realized volatility in basis points.
     */
    function getRealizedVol(address asset) external view returns (uint256 volBps);
}
