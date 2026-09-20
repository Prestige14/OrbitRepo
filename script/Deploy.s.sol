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
    // Canonical Robinhood Chain Testnet Token Addresses
    address constant RH_AMD  = 0x71178BAc73cBeb415514eB542a8995b82669778d;
    address constant RH_AMZN = 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02;
    address constant RH_NFLX = 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93;
    address constant RH_PLTR = 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0;
    address constant RH_TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;

    struct Deployment {
        address usdc;
        address pool;
        address vault;
        address riskEngine;
        address amd;
        address amzn;
        address nflx;
        address pltr;
        address tsla;
        address amdOracle;
        address amznOracle;
        address nflxOracle;
        address pltrOracle;
        address tslaOracle;
    }

    function _getPrivateKey() internal view returns (uint256) {
        try vm.envBytes32("PRIVATE_KEY") returns (bytes32 key) {
            return uint256(key);
        } catch {
            try vm.envUint("PRIVATE_KEY") returns (uint256 key) {
                return key;
            } catch {
                return uint256(keccak256(abi.encodePacked("orbitrepo.local.test.deployer.key")));
            }
        }
    }

    function run() external {
        uint256 deployerPrivateKey = _getPrivateKey();
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Balance: ", deployer.balance);
        console.log("Chain ID:", block.chainid);

        if (block.chainid != 31337 && deployer.balance == 0) {
            console.log("WARNING: Deployer account has 0 ETH on chain ID:", block.chainid);
        }

        vm.startBroadcast(deployerPrivateKey);

        Deployment memory d;

        // 1. Stablecoin
        MockUSDC usdc = new MockUSDC();
        d.usdc = address(usdc);

        // 2. Token addresses (Canonical on Robinhood Chain, Mocks on local Anvil)
        if (block.chainid == 46630) {
            d.amd = RH_AMD;
            d.amzn = RH_AMZN;
            d.nflx = RH_NFLX;
            d.pltr = RH_PLTR;
            d.tsla = RH_TSLA;
        } else {
            d.amd = address(new MockStockToken("Advanced Micro Devices", "AMD"));
            d.amzn = address(new MockStockToken("Amazon.com Inc.", "AMZN"));
            d.nflx = address(new MockStockToken("Netflix Inc.", "NFLX"));
            d.pltr = address(new MockStockToken("Palantir Technologies", "PLTR"));
            d.tsla = address(new MockStockToken("Tesla Inc.", "TSLA"));
        }

        // 3. Oracles
        d.amdOracle  = address(new MockPriceOracle("AMD / USD",  15500000000));
        d.amznOracle = address(new MockPriceOracle("AMZN / USD", 18500000000));
        d.nflxOracle = address(new MockPriceOracle("NFLX / USD", 69000000000));
        d.pltrOracle = address(new MockPriceOracle("PLTR / USD",  3600000000));
        d.tslaOracle = address(new MockPriceOracle("TSLA / USD", 24500000000));

        // 4. Risk Engine
        MockRiskEngine riskEngine = new MockRiskEngine();
        d.riskEngine = address(riskEngine);
        riskEngine.setDefaultVol(d.amd,  340);
        riskEngine.setDefaultVol(d.amzn, 220);
        riskEngine.setDefaultVol(d.nflx, 280);
        riskEngine.setDefaultVol(d.pltr, 410);
        riskEngine.setDefaultVol(d.tsla, 380);

        // 5. Core Protocol
        LiquidityPool pool = new LiquidityPool(d.usdc);
        d.pool = address(pool);

        RepoVault vault = new RepoVault(d.pool, d.riskEngine);
        d.vault = address(vault);
        pool.setRepoVault(d.vault);

        // 6. Whitelist all 5 Robinhood Equities
        vault.whitelistAsset(d.amd,  d.amdOracle,  3600);
        vault.whitelistAsset(d.amzn, d.amznOracle, 3600);
        vault.whitelistAsset(d.nflx, d.nflxOracle, 3600);
        vault.whitelistAsset(d.pltr, d.pltrOracle, 3600);
        vault.whitelistAsset(d.tsla, d.tslaOracle, 3600);

        // 7. Seed Liquidity
        usdc.mint(deployer, 1_000_000 * 1e6);
        usdc.approve(d.pool, 500_000 * 1e6);
        pool.deposit(500_000 * 1e6);

        vm.stopBroadcast();

        _printSummary(d);
        _writeConfigFile(d);
    }

    function _printSummary(Deployment memory d) internal pure {
        console.log("=== OrbitRepo Robinhood Chain Deployment Successful ===");
        console.log("USDC:          ", d.usdc);
        console.log("Liquidity Pool:", d.pool);
        console.log("Repo Vault:    ", d.vault);
        console.log("Risk Engine:   ", d.riskEngine);
        console.log("AMD:           ", d.amd);
        console.log("AMZN:          ", d.amzn);
        console.log("NFLX:          ", d.nflx);
        console.log("PLTR:          ", d.pltr);
        console.log("TSLA:          ", d.tsla);
    }

    function _writeConfigFile(Deployment memory d) internal {
        string memory p1 = string.concat(
            '{\n  "chainId": 46630,\n  "network": "Robinhood Chain Testnet",\n  "rpcUrl": "https://rpc.testnet.chain.robinhood.com",\n  "explorerUrl": "https://explorer.testnet.chain.robinhood.com",\n  "faucetUrl": "https://faucet.testnet.chain.robinhood.com/",\n  "usdc": "',
            vm.toString(d.usdc),
            '",\n  "liquidityPool": "',
            vm.toString(d.pool),
            '",\n  "repoVault": "',
            vm.toString(d.vault),
            '",\n  "riskEngine": "',
            vm.toString(d.riskEngine),
            '",\n'
        );

        string memory p2 = string.concat(
            '  "tokens": {\n    "AMD": {\n      "name": "Advanced Micro Devices",\n      "symbol": "AMD",\n      "address": "',
            vm.toString(d.amd),
            '",\n      "oracle": "',
            vm.toString(d.amdOracle),
            '",\n      "initialPrice": 155.0,\n      "volatility": 3.4\n    },\n    "AMZN": {\n      "name": "Amazon.com Inc.",\n      "symbol": "AMZN",\n      "address": "',
            vm.toString(d.amzn),
            '",\n      "oracle": "',
            vm.toString(d.amznOracle),
            '",\n      "initialPrice": 185.0,\n      "volatility": 2.2\n    },\n'
        );

        string memory p3 = string.concat(
            '    "NFLX": {\n      "name": "Netflix Inc.",\n      "symbol": "NFLX",\n      "address": "',
            vm.toString(d.nflx),
            '",\n      "oracle": "',
            vm.toString(d.nflxOracle),
            '",\n      "initialPrice": 690.0,\n      "volatility": 2.8\n    },\n    "PLTR": {\n      "name": "Palantir Technologies",\n      "symbol": "PLTR",\n      "address": "',
            vm.toString(d.pltr),
            '",\n      "oracle": "',
            vm.toString(d.pltrOracle),
            '",\n      "initialPrice": 36.0,\n      "volatility": 4.1\n    },\n'
        );

        string memory p4 = string.concat(
            '    "TSLA": {\n      "name": "Tesla Inc.",\n      "symbol": "TSLA",\n      "address": "',
            vm.toString(d.tsla),
            '",\n      "oracle": "',
            vm.toString(d.tslaOracle),
            '",\n      "initialPrice": 245.0,\n      "volatility": 3.8\n    }\n  }\n}\n'
        );

        string memory outputJson = string.concat(p1, p2, p3, p4);

        try vm.writeFile("frontend/src/contracts/addresses.json", outputJson) {
            console.log("Configuration exported to frontend/src/contracts/addresses.json");
        } catch {}
    }
}
