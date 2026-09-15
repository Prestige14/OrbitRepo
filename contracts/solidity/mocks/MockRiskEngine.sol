// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IRiskEngine.sol";

/**
 * @title MockRiskEngine
 * @notice Mirror of Arbitrum Stylus Risk Engine for local Foundry unit testing.
 * @dev Replicates the parametric VaR math from contracts/stylus/risk_engine/src/lib.rs.
 */
contract MockRiskEngine is IRiskEngine {
    uint256 public constant BPS_DIVISOR = 10_000;
    uint256 public constant LTV_MIN_BPS = 2_000; // 20.00%
    uint256 public constant LTV_MAX_BPS = 8_000; // 80.00%

    mapping(address => uint256) public defaultVolBps;

    function setDefaultVol(address asset, uint256 volBps) external {
        defaultVolBps[asset] = volBps;
    }

    function integerSqrt(uint256 val) public pure returns (uint256) {
        if (val == 0) return 0;
        uint256 x0 = val / 2;
        if (x0 == 0) return 1;
        uint256 x1 = (x0 + val / x0) / 2;
        while (x1 < x0) {
            x0 = x1;
            x1 = (x0 + val / x0) / 2;
        }
        return x0;
    }

    function getRealizedVol(address asset) public view override returns (uint256) {
        uint256 vol = defaultVolBps[asset];
        if (vol == 0) {
            return 220; // 2.2% default daily vol (~35% annualized)
        }
        return vol;
    }

    function getMaxLTV(address asset, uint8 termDays) external view override returns (uint256) {
        uint256 dailyVol = getRealizedVol(asset);
        uint256 zScaled = 233; // 2.33 * 100 for 99% confidence interval

        uint256 termScaled = uint256(termDays) * 1_000_000;
        uint256 sqrtTScaled = integerSqrt(termScaled);

        uint256 haircutBps = (zScaled * dailyVol * sqrtTScaled) / 100_000;

        uint256 maxLtv;
        if (haircutBps >= BPS_DIVISOR) {
            maxLtv = LTV_MIN_BPS;
        } else {
            maxLtv = BPS_DIVISOR - haircutBps;
        }

        if (maxLtv > LTV_MAX_BPS) {
            return LTV_MAX_BPS;
        } else if (maxLtv < LTV_MIN_BPS) {
            return LTV_MIN_BPS;
        } else {
            return maxLtv;
        }
    }
}
