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
    struct Deployment {
        address usdc;
        address taapl;
        address tnvda;
        address aaplOracle;
        address nvdaOracle;
        address riskEngine;
        address pool;
        address vault;
    }

    function run() external {
        uint256 deployerPrivateKey;
        try vm.envUint("PRIVATE_KEY") returns (uint256 key) {
            deployerPrivateKey = key;
        } catch {
            deployerPrivateKey = uint256(keccak256(abi.encodePacked("orbitrepo.local.test.deployer.key")));
        }

        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Assets
        MockUSDC usdc = new MockUSDC();
        MockStockToken taapl = new MockStockToken("Tokenized Apple", "tAAPL");
        MockStockToken tnvda = new MockStockToken("Tokenized NVIDIA", "tNVDA");

        // 2. Oracles
        MockPriceOracle aaplOracle = new MockPriceOracle("AAPL / USD", 22550000000);
        MockPriceOracle nvdaOracle = new MockPriceOracle("NVDA / USD", 12000000000);

        // 3. Risk Engine
        MockRiskEngine riskEngine = new MockRiskEngine();
        riskEngine.setDefaultVol(address(taapl), 320); // 3.2% daily vol
        riskEngine.setDefaultVol(address(tnvda), 120); // 1.2% daily vol

        // 4. Core Protocol
        LiquidityPool pool = new LiquidityPool(address(usdc));
        RepoVault vault = new RepoVault(address(pool), address(riskEngine));
        pool.setRepoVault(address(vault));

        // 5. Whitelist & Parameters
        vault.whitelistAsset(address(taapl), address(aaplOracle), 3600);
        vault.whitelistAsset(address(tnvda), address(nvdaOracle), 3600);

        // 6. Liquidity Seeding
        usdc.mint(deployer, 1_000_000 * 1e6);
        usdc.approve(address(pool), 500_000 * 1e6);
        pool.deposit(500_000 * 1e6);

        taapl.mint(deployer, 500 * 1e18);
        tnvda.mint(deployer, 500 * 1e18);

        vm.stopBroadcast();

        Deployment memory d = Deployment({
            usdc: address(usdc),
            taapl: address(taapl),
            tnvda: address(tnvda),
            aaplOracle: address(aaplOracle),
            nvdaOracle: address(nvdaOracle),
            riskEngine: address(riskEngine),
            pool: address(pool),
            vault: address(vault)
        });

        _printSummary(d);
        _writeConfigFile(d);
    }

    function _printSummary(Deployment memory d) internal pure {
        console.log("=== OrbitRepo Deployment Successful ===");
        console.log("USDC:          ", d.usdc);
        console.log("tAAPL:         ", d.taapl);
        console.log("tNVDA:         ", d.tnvda);
        console.log("AAPL Oracle:   ", d.aaplOracle);
        console.log("NVDA Oracle:   ", d.nvdaOracle);
        console.log("Risk Engine:   ", d.riskEngine);
        console.log("Liquidity Pool:", d.pool);
        console.log("Repo Vault:    ", d.vault);
    }

    function _writeConfigFile(Deployment memory d) internal {
        string memory p1 = string.concat(
            '{\n  "chainId": 421614,\n  "network": "Arbitrum Sepolia",\n  "usdc": "',
            vm.toString(d.usdc),
            '",\n  "taapl": "',
            vm.toString(d.taapl),
            '",\n  "tnvda": "'
        );
        string memory p2 = string.concat(
            vm.toString(d.tnvda),
            '",\n  "aaplOracle": "',
            vm.toString(d.aaplOracle),
            '",\n  "nvdaOracle": "',
            vm.toString(d.nvdaOracle),
            '",\n  "riskEngine": "'
        );
        string memory p3 = string.concat(
            vm.toString(d.riskEngine),
            '",\n  "liquidityPool": "',
            vm.toString(d.pool),
            '",\n  "repoVault": "',
            vm.toString(d.vault),
            '"\n}\n'
        );

        string memory outputJson = string.concat(p1, p2, p3);

        try vm.writeFile("frontend/src/contracts/addresses.json", outputJson) {
            console.log("Configuration exported to frontend/src/contracts/addresses.json");
        } catch {}
    }
}
