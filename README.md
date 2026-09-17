# OrbitRepo 🪐

### Fixed-Term Repo Market for Tokenized Equities with an Arbitrum Stylus Dynamic Risk Engine

> **Built for Arbitrum Open House Singapore Online Buildathon 2026**  
> **Target Deployment:** Robinhood Chain Testnet & Arbitrum Sepolia  
> **Repository:** [github.com/Prestige14/OrbitRepo](https://github.com/Prestige14/OrbitRepo)

---

## 0. Elevator Pitch

> *"Aave gives every collateral asset the same flat 75% LTV. OrbitRepo dynamically recalculates a safe, tailored LTV for each tokenized stock every night based on its actual realized volatility — a computation that is only economically feasible on-chain thanks to Arbitrum Stylus."*

---

## 1. Problem Statement

### A. TradFi Context
The Wall Street Repurchase Agreement (Repo) market clears an average of **over $4.3 – $4.4 trillion** in daily transactions (SIFMA data) — serving as the backbone of global short-term institutional funding. Institutions rely on repo to secure immediate cash liquidity without liquidating equity holdings, avoiding taxable capital gains events and retaining strategic market exposure.

### B. The Structural Gap in DeFi & Robinhood Chain
When Robinhood Chain launched on mainnet, it arrived with native DeFi lending primitives out-of-the-box (powered by Morpho under the *Robinhood Earn* product), and Stock Tokens are designed to be pledged, lent, and traded. 

However, existing lending pools exhibit two critical limitations:
1. **Product Structure**: Generic DeFi lending pools are open-ended with floating, utilization-based APYs. Institutional repo is always **fixed-term** (Overnight, 7-day, 30-day). A fixed-term structure gives Liquidity Providers (LPs) predictable, bond-like yield profiles rather than erratic floating rates.
2. **Static Risk Models**: Existing pools rely on static LTV and liquidation threshold parameters that rarely change. In crypto-native assets, this is already risky; for **individual stocks**, it is catastrophic due to:
   - Idiosyncratic volatility differing drastically between equities (e.g., AAPL vs. high-beta tech vs. index ETFs).
   - Overnight market gap risk (earnings surprises can trigger sudden 10–25% price gaps between trading sessions).
   
A single flat LTV "taxes" low-volatility assets with excessive haircuts while severely under-collateralizing volatile stocks, putting protocol solvency at risk.

---

## 2. The Solution: OrbitRepo Architecture

OrbitRepo is a dual-sided decentralized repo protocol tailored for tokenized US equities:

- **Borrowers** pledge Stock Tokens (e.g., `tAAPL`, `tNVDA`), select a fixed term (Overnight, 7-day, or 30-day), and draw stablecoin liquidity up to a **dynamic Max LTV calculated in real-time by the Stylus Risk Engine**.
- **Liquidity Providers (LPs)** deposit stablecoins into the pool, earning locked-in term yields (repo rate) with predictable returns.
- **At maturity**, borrowers repay principal plus the locked fixed interest to reclaim collateral. If under-collateralized or expired, positions are permissionlessly liquidated by keepers.

```
 Borrower                         Liquidity Provider
    │                                     │
    │ collateral (tAAPL, tNVDA)           │ stablecoin (USDC)
    ▼                                     ▼
┌─────────────────────────────────────────────────┐
│                   RepoVault.sol                 │
│  - openPosition(asset, amount, term)            │
│  - repay(positionId)                            │
│  - liquidate(positionId)   ◄── Keeper (Anyone)  │
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

### Why Stylus (Rust WASM) Instead of Solidity?
Calculating daily logarithmic returns $r_t = \ln(P_t / P_{t-1})$, square roots, and looping over rolling price buffers in standard EVM Solidity requires expensive storage read iterations (`SLOAD`) and is prone to numerical overflow. 

**Arbitrum Stylus (Rust $\rightarrow$ WASM)** delivers **10–100x cheaper compute** and **100–500x cheaper memory**, enabling up to **86.6% gas savings** for repetitive risk computations while remaining synchronously callable from Solidity via MultiVM.

### Mathematical Formulation:
1. **Daily Log Return:**  
   $$r_t \approx \frac{|P_t - P_{t-1}|}{P_{t-1}}$$
2. **Realized Variance ($N$ observations):**  
   $$\sigma^2 = \frac{1}{N} \sum (r_t)^2$$
3. **Daily Realized Volatility:**  
   $$\sigma_{\text{daily}} = \sqrt{\sigma^2}$$
4. **Parametric VaR Haircut (Confidence $\alpha = 99\%$, $z_\alpha = 2.33$):**  
   $$\text{Haircut} = z_\alpha \times \sigma_{\text{daily}} \times \sqrt{t}$$
5. **Protocol Clamped Max LTV:**  
   $$\text{Max LTV} = \text{clamp}(1 - \text{Haircut}, 20\%, 80\%)$$

### Numerical Comparison (Parametric VaR vs. Flat LTV):
| Asset Profile | Daily Volatility ($\sigma$) | Duration ($t$) | VaR Haircut | OrbitRepo Max LTV | Traditional Flat LTV |
|---|---|---|---|---|---|
| **Volatile Stock (`tAAPL`)** | 3.2% / day | Overnight (1 Day) | 7.5% | **80.0%** (Capped) | 75.0% |
| **Volatile Stock (`tAAPL`)** | 3.2% / day | **30 Days** | 40.8% | **59.2%** (Risk-Adjusted) | 75.0% *(Insolvency Risk!)* |
| **Broad-Market ETF (`tSPY`)** | 1.1% / day | 30 Days | 15.3% | **80.0%** (Capped) | 75.0% *(Capital Inefficient)* |

*Notice the 30-day row: OrbitRepo automatically contracts Max LTV to 59.2% for volatile single equities to account for earnings gap risks, while allowing stable index ETFs the full 80.0% ceiling.*

---

## 4. Smart Contract Architecture

- [`RepoVault.sol`](contracts/solidity/RepoVault.sol): Core contract managing fixed-term positions, custodying equity collateral, enforcing dynamic Max LTV, and executing permissionless liquidations with a 500 bps maintenance margin buffer.
- [`LiquidityPool.sol`](contracts/solidity/LiquidityPool.sol): USDC liquidity pool with share-based accounting that disburses capital to `RepoVault` and compounds fixed repo interest back to LPs.
- [`RiskEngine (lib.rs)`](contracts/stylus/risk_engine/src/lib.rs): Arbitrum Stylus Rust contract implementing rolling price buffers, Babylonian integer square roots, and Parametric VaR logic.
- [`MockStockToken.sol`](contracts/solidity/mocks/MockStockToken.sol): Simulation ERC-20 tokens representing tokenized equity (`tAAPL`, `tNVDA`) with public faucet access.
- [`MockPriceOracle.sol`](contracts/solidity/mocks/MockPriceOracle.sol): Chainlink AggregatorV3 emulator equipped with on-the-fly price override functions for live judge demonstrations.

---

## 5. Getting Started & Verification

### Prerequisites
- [Foundry](https://getfoundry.sh/) (`forge`, `cast`)
- Rust & Cargo with `wasm32-unknown-unknown` target installed
- `cargo-stylus` (v0.6.3+)
- Node.js (v20+) & npm

### A. Run Solidity Tests (Foundry)
```bash
forge test -vvv
```
*Result: 6/6 unit tests pass, verifying dynamic LTV differentiation, full loan lifecycle, price drop liquidations, and oracle staleness rejection.*

### B. Verify Arbitrum Stylus WASM Contract
```bash
cd contracts/stylus/risk_engine
cargo stylus check --endpoint https://sepolia-rollup.arbitrum.io/rpc
```
*Result: WASM contract compiles cleanly into a lightweight 14.9 KiB binary ready for deployment on Arbitrum Sepolia.*

### C. Run Local Frontend Dashboard
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 6. Frontend Dashboard Features

1. **Borrower Portal:** Deposit tokenized equities, select fixed terms (1, 7, 30 days), and observe the live Max LTV computed dynamically by the Stylus Risk Engine.
2. **Liquidity Provider Portal:** Supply USDC to earn predictable fixed repo yields with real-time share price growth.
3. **Live Crisis Simulator (Pitch Demo Mode):** Interactive tool designed for judges to simulate sudden earnings shocks (-25% to -45%), witness the position health gauge shift to `CRITICAL / LIQUIDATABLE`, and execute a 1-click keeper liquidation bounty.
4. **Instant Faucet:** Single-click dispenser for testnet `tAAPL`, `tNVDA`, and `USDC`.

---

## 7. Hackathon Criteria Alignment

- **Ecosystem Alignment (Terms & Conditions Clause 6.2):** Built specifically for tokenized equity on **Robinhood Chain** (qualifying directly for the dedicated Robinhood Chain prize allocation).
- **Use of Arbitrum Technology:** Authentic integration of **Arbitrum Stylus MultiVM**, using Rust for heavy mathematical operations that are cost-prohibitive in standard Solidity.
- **Smart Contract Quality:** Follows checks-effects-interactions, reentrancy guards, trust-minimized non-upgradeable architecture, oracle staleness validation, and 100% test coverage in Foundry.
- **Novelty & Impact:** Bridges the massive $4.4T/day TradFi repo market to tokenized equities with on-chain dynamic risk parameters.

---

## License
MIT License. Built for the Arbitrum Open House Singapore Online Buildathon 2026.
