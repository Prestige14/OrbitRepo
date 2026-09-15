// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockStockToken
 * @notice Simulation ERC-20 token representing tokenized equity (e.g., tAAPL, tNVDA).
 * @dev Explicitly labeled for simulation purposes as per SRS specifications.
 */
contract MockStockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        // Mint initial supply to deployer for convenience
        _mint(msg.sender, 100_000 * 10 ** decimals());
    }

    /**
     * @notice Public mint function to allow easy faucet access during hackathon evaluation.
     * @param to The recipient address.
     * @param amount The token amount in base units (18 decimals).
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
