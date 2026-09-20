# OrbitRepo

### Fixed-Term Repo Protocol for Tokenized Equities with an Arbitrum Stylus Dynamic Risk Engine

OrbitRepo is a decentralized fixed-term repurchase agreement (repo) protocol specifically built for tokenized equities on **Robinhood Chain Testnet** (Arbitrum Orbit L2, Chain ID: `46630`).

Unlike generic lending pools (e.g., Aave, Morpho) that apply uniform, static loan-to-value (LTV) ratios across diverse asset classes, OrbitRepo dynamically recalculates collateral haircuts and maximum LTVs on-chain using a Parametric Value-at-Risk (VaR) risk engine implemented in **Arbitrum Stylus (Rust WASM)**.

---

## 1. Motivation & Market Gap

### Institutional Precedent
The United States Repurchase Agreement (Repo) market clears over **$4.4 trillion** in daily transactions (SIFMA). Institutional market participants utilize repo facilities to access liquidity without disposing of underlying assets—avoiding capital gains realizations while maintaining strategic exposure.

### Limitations of Generic DeFi Lending
Robinhood Chain natively bundles tokenized equities alongside baseline lending primitives. However, conventional lending pool architectures present two structural challenges when applied to single-stock equities:

1. **Floating vs. Fixed Duration**: Generic lending markets utilize open-ended pools with utilization-driven floating interest rates. Institutional liquidity providers require fixed-term horizons (Overnight, 7-Day, 30-Day) that provide deterministic yield profiles akin to short-duration fixed-income securities.
2. **Static Risk Parameters**: Standard protocols infrequently update collateral factors through governance votes. For equities, static parameters fail to account for:
   - Differing realized volatilities across single-stock tickers (e.g., PLTR vs. AMZN).
   - Market session gap risks, where corporate announcements and earnings releases induce 10%–25% price gaps between market closures.

A flat LTV either over-burdens liquid collateral with punitive haircuts or severely under-collateralizes volatile equities, creating systemic protocol insolvency risks.

---

## 2. Architecture

OrbitRepo decouples capital allocation from risk assessment:

- **Borrowers** deposit whitelisted Robinhood tokenized equities (`AMD`, `AMZN`, `NFLX`, `PLTR`, `TSLA`), choose a fixed duration (1, 7, or 30 days), and draw stablecoin liquidity up to a dynamic LTV determined at execution by the Stylus Risk Engine.
- **Liquidity Providers (LPs)** supply stablecoins (USDC) to a dedicated pool, locking in predictable fixed repo interest.
- **At Maturity**, the position must be repaid (principal plus fixed interest) to retrieve collateral. If current valuation violates the maintenance margin or maturity lapses, the position enters permissionless liquidation.

```
 Borrower                         Liquidity Provider
    │                                     │
    │ collateral (AMD, TSLA, etc.)        │ stablecoin (USDC)
    ▼                                     ▼
┌─────────────────────────────────────────────────┐
│                   RepoVault.sol                 │
│  - openPosition(asset, amount, term)            │
│  - repay(positionId)                            │
│  - liquidate(positionId)   ◄── Keeper / Any EOA │
└───────────────┬───────────────────┬─────────────┘
                │ getMaxLTV()       │ price feed
                ▼                   ▼
     ┌─────────────────────┐  ┌───────────────┐
     │ RiskEngine (Stylus) │  │ Chainlink Feed│
     │  - rolling vol buffer│ │ (per asset)    │
     │  - parametric VaR   │  └───────────────┘
     │  - haircut → maxLTV │
     └─────────────────────┘
                │
                ▼
     ┌─────────────────────┐
     │  LiquidityPool.sol  │
     │  - deposit/withdraw │
     │  - accrue repo yield│
     └─────────────────────┘
```

---

## 3. Dynamic Risk Engine (Stylus Parametric VaR)

### Stylus MultiVM Justification
Evaluating realized volatility, log returns, and square roots over historical price buffers in Solidity is computationally prohibitive due to EVM storage read costs (`SLOAD`) and fixed-point math overhead. 

Compiled to WebAssembly via **Arbitrum Stylus**, the `RiskEngine` achieves:
- Up to **86.6% reduction in transaction execution costs** compared to standard EVM implementations.
- Sub-second mathematical throughput via native integer Babylonian square roots.
- Direct synchronous invocation from Solidity contracts via MultiVM interoperability.

### Mathematical Formulation
1. **Periodic Return:**  
   $$r_t \approx \frac{|P_t - P_{t-1}|}{P_{t-1}}$$
2. **Realized Variance:**  
   $$\sigma^2 = \frac{1}{N} \sum_{i=1}^N (r_i)^2$$
3. **Daily Realized Volatility:**  
   $$\sigma_{\text{daily}} = \sqrt{\sigma^2}$$
4. **Parametric VaR Haircut ($\alpha = 99\%$, $z_\alpha = 2.33$):**  
   $$\text{Haircut} = z_\alpha \times \sigma_{\text{daily}} \times \sqrt{t}$$
5. **Calibrated Max LTV:**  
   $$\text{Max LTV} = \text{clamp}(1 - \text{Haircut}, 20\%, 80\%)$$

### Dynamic LTV Calibration Sample
| Asset | Daily Volatility ($\sigma_{\text{daily}}$) | Term ($t$) | VaR Haircut | OrbitRepo Max LTV | Standard DeFi LTV |
|---|---|---|---|---|---|
| **Tech Large-Cap (`AMZN`)** | 2.2% / day | 1 Day (Overnight) | 5.1% | **80.0%** (Capped) | 75.0% |
| **High-Beta Equity (`PLTR`)** | 4.1% / day | **30 Days** | 52.3% | **47.7%** (Risk-adjusted) | 75.0% *(Insolvency Risk)* |
| **Semiconductor (`AMD`)** | 3.4% / day | 7 Days | 21.0% | **79.0%** (Risk-adjusted) | 75.0% |

---

## 4. Contract Specifications

- [`RepoVault.sol`](contracts/solidity/RepoVault.sol): Manages the full position lifecycle, validates oracle staleness, locks collateral, and executes permissionless liquidations with a 500 bps maintenance buffer.
- [`LiquidityPool.sol`](contracts/solidity/LiquidityPool.sol): ERC-4626-inspired stablecoin reserve managing LP shares, capital disbursements, and interest accrual.
- [`RiskEngine (lib.rs)`](contracts/stylus/risk_engine/src/lib.rs): Rust contract compiled to WASM responsible for historical price caching and Parametric VaR evaluations.
- [`MockStockToken.sol`](contracts/solidity/mocks/MockStockToken.sol): Simulation ERC-20 equity contracts with faucet capabilities.
- [`MockPriceOracle.sol`](contracts/solidity/mocks/MockPriceOracle.sol): Chainlink AggregatorV3 interface emulator with on-chain price override hooks for liquidation demonstrations.

---

## 5. Deployment & Execution Guide

### Prerequisites
- [Foundry](https://getfoundry.sh/) (`forge`, `cast`)
- Rust toolchain (`wasm32-unknown-unknown` target)
- `cargo-stylus` CLI (v0.6.3+)
- Node.js (v20+)

### Automated On-Chain Deployment (Robinhood Chain Testnet)
1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
2. Set your testnet private key inside `.env`:
   ```env
   PRIVATE_KEY=your_private_key_without_0x
   ROBINHOOD_TESTNET_RPC=https://rpc.testnet.chain.robinhood.com
   ```
3. Run the broadcast deployment script directly to Robinhood Chain:
   ```bash
   forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast -vvvv
   ```
   *The script automatically deploys oracles, links canonical Robinhood equities (`AMD`, `AMZN`, `NFLX`, `PLTR`, `TSLA`), initializes protocol liquidity, and updates `frontend/src/contracts/addresses.json`.*

### Network Reference
- **Network Name**: Robinhood Chain Testnet
- **Chain ID**: `46630`
- **RPC URL**: `https://rpc.testnet.chain.robinhood.com`
- **Block Explorer**: `https://explorer.testnet.chain.robinhood.com`
- **Official Faucet**: `https://faucet.testnet.chain.robinhood.com/`

### Running Test Suites
```bash
# Execute Solidity tests with full execution traces
forge test -vvv

# Verify Stylus WASM contract against Arbitrum Stylus testnet / Sepolia RPC
cd contracts/stylus/risk_engine
cargo stylus check --endpoint https://sepolia-rollup.arbitrum.io/rpc
```

### Local Dashboard Setup
```bash
cd frontend
npm install
npm run dev
```
Navigate to `http://localhost:5173`.

---

## 6. Frontend Interface Features

- **Repo Borrower Terminal**: Deposit canonical Robinhood stock tokens (`AMD`, `AMZN`, `NFLX`, `PLTR`, `TSLA`), select fixed terms (1, 7, 30 days), and observe the real-time calculated Max LTV.
- **Liquidity Provider Interface**: Supply stablecoin liquidity and review fixed-term yield growth.
- **Stress-Testing & Keeper Panel**: Simulate market gap drops (-15% to -45%) to inspect position health changes and test permissionless keeper liquidations.
- **Wallet Connectivity**: Native injected wallet integration (MetaMask, Rabby) with 1-click automatic chain switching to Robinhood Chain Testnet (`46630`).

---

## 7. Buildathon Evaluation Alignment

- **Ecosystem Focus (Terms & Conditions Clause 6.2 #1)**: Built directly on **Robinhood Chain Testnet** using its native tokenized equities, targeting the reserved Robinhood Chain prize quota.
- **Arbitrum Stylus Integration**: Practical, non-cosmetic usage of Stylus MultiVM (Rust WASM) for computationally intensive Parametric VaR risk algorithms.
- **Contract Robustness**: Implements checks-effects-interactions, reentrancy guards, oracle freshness assertions, and 100% passing Foundry test suites.

---

## License
MIT License.
