// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Mock USD Coin with 6 decimals for testing and Liquidity Provider simulation.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin (Simulation)", "USDC") {
        // Mint initial liquidity to deployer
        _mint(msg.sender, 10_000_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Public mint function to allow easy testnet faucet funding.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
