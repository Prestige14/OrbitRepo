// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../contracts/solidity/RepoVault.sol";
import "../contracts/solidity/LiquidityPool.sol";
import "../contracts/solidity/mocks/MockStockToken.sol";
import "../contracts/solidity/mocks/MockUSDC.sol";
import "../contracts/solidity/mocks/MockPriceOracle.sol";
import "../contracts/solidity/mocks/MockRiskEngine.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(keccak256(abi.encodePacked("orbitrepo.local.test.deployer.key")))
        );
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        console.log("Deploying OrbitRepo system with deployer:", deployer);

        // 1. Deploy Tokens
        MockUSDC usdc = new MockUSDC();
        MockStockToken taapl = new MockStockToken("Tokenized Apple (Simulation)", "tAAPL");
        MockStockToken tnvda = new MockStockToken("Tokenized NVIDIA (Simulation)", "tNVDA");

        // 2. Deploy Price Feeds (8 decimals)
        // AAPL = $225.50 (22550000000), NVDA = $120.00 (12000000000)
        MockPriceOracle aaplOracle = new MockPriceOracle("AAPL / USD", 22550000000);
        MockPriceOracle nvdaOracle = new MockPriceOracle("NVDA / USD", 12000000000);

        // 3. Deploy Risk Engine (Solidity mirror for Sepolia/Orbit testnet, pluggable with Stylus WASM)
        MockRiskEngine riskEngine = new MockRiskEngine();
        riskEngine.setDefaultVol(address(taapl), 320); // 3.2% daily vol (volatile stock)
        riskEngine.setDefaultVol(address(tnvda), 120); // 1.2% daily vol (stable broad equity)

        // 4. Deploy LiquidityPool & RepoVault
        LiquidityPool pool = new LiquidityPool(address(usdc));
        RepoVault vault = new RepoVault(address(pool), address(riskEngine));
        pool.setRepoVault(address(vault));

        // 5. Whitelist Assets on RepoVault (1 hour staleness threshold)
        vault.whitelistAsset(address(taapl), address(aaplOracle), 3600);
        vault.whitelistAsset(address(tnvda), address(nvdaOracle), 3600);

        // 6. Seed Liquidity
        usdc.mint(deployer, 1_000_000 * 1e6);
        usdc.approve(address(pool), 500_000 * 1e6);
        pool.deposit(500_000 * 1e6);

        // 7. Mint initial test tokens for faucet
        taapl.mint(deployer, 500 * 1e18);
        tnvda.mint(deployer, 500 * 1e18);

        vm.stopBroadcast();

        console.log("=== OrbitRepo Deployment Complete ===");
        console.log("USDC:", address(usdc));
        console.log("tAAPL:", address(taapl));
        console.log("tNVDA:", address(tnvda));
        console.log("AAPL Oracle:", address(aaplOracle));
        console.log("NVDA Oracle:", address(nvdaOracle));
        console.log("RiskEngine:", address(riskEngine));
        console.log("LiquidityPool:", address(pool));
        console.log("RepoVault:", address(vault));
    }
}
