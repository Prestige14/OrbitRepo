// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IPriceOracle.sol";

/**
 * @title MockPriceOracle
 * @notice Mock Chainlink price feed with manual price adjustment for demo & testing.
 * @dev Enables simulating flash drops in stock price to demonstrate liquidations on command.
 */
contract MockPriceOracle is IPriceOracle {
    int256 private _price;
    uint8 private constant _DECIMALS = 8;
    string private _description;
    uint256 private _updatedAt;

    constructor(string memory description_, int256 initialPrice_) {
        _description = description_;
        _price = initialPrice_;
        _updatedAt = block.timestamp;
    }

    function decimals() external pure override returns (uint8) {
        return _DECIMALS;
    }

    function description() external view override returns (string memory) {
        return _description;
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, _price, _updatedAt, _updatedAt, 1);
    }

    /**
     * @notice Allows demo runner to update price on the fly (e.g., simulate a 25% crash).
     */
    function setPrice(int256 newPrice) external {
        _price = newPrice;
        _updatedAt = block.timestamp;
    }

    /**
     * @notice Allows simulator to trigger staleness tests.
     */
    function setUpdatedAt(uint256 timestamp) external {
        _updatedAt = timestamp;
    }
}
