# OrbitRepo 🪐

### Fixed-Term Repo Market untuk Tokenized Equity dengan Dynamic Risk Engine berbasis Arbitrum Stylus (Rust WASM)

> **Arbitrum Open House Singapore Online Buildathon 2026**  
> **Target Deployment:** Robinhood Chain Testnet & Arbitrum Sepolia  
> **Repository:** [github.com/Prestige14/OrbitRepo](https://github.com/Prestige14/OrbitRepo)

---

## 0. Elevator Pitch

> *"Aave memberi semua orang LTV 75% yang sama. OrbitRepo menghitung ulang LTV yang aman untuk tiap saham, tiap malam, berdasarkan volatilitas riilnya — dan itu hanya mungkin secara ekonomis berkat Arbitrum Stylus."*

---

## 1. Problem Statement

### A. TradFi Context
Pasar Repo (*repurchase agreement*) di Wall Street mencatat rata-rata **lebih dari $4,3 – $4,4 triliun** transaksi harian (data SIFMA). Institusi memakainya untuk mendapatkan likuiditas kas jangka pendek tanpa harus menjual saham (menghindari pajak *capital gain* dan mempertahankan kepemilikan aset).

### B. Gap Nyata di DeFi & Robinhood Chain
Robinhood Chain telah hadir dengan fitur lending bawaan (Morpho / Robinhood Earn). Namun, terdapat 2 keterbatasan mendasar:
1. **Struktur Produk**: Pool lending generik bersifat *open-ended* dengan suku bunga mengambang (floating APY). Repo TradFi selalu **fixed-term** (Overnight, 7 hari, 30 hari) yang memberikan kepastian hasil mirip obligasi pendek bagi Liquidity Provider.
2. **Model Risiko**: Protokol lending konvensional menggunakan parameter LTV **statis** (flat). Pada saham individual, satu LTV statis sangat berbahaya karena adanya *gap risk* saat market re-open (harga bisa anjlok 10–20%+ akibat laporan keuangan mendadak). Aset volatil kurang diberi margin pengaman, sedangkan aset aman dikenai penalti modal berlebih.

---

## 2. Solusi: Arsitektur OrbitRepo

OrbitRepo memecahkan masalah ini dengan memisahkan instrumen pinjaman menjadi fixed-term repo, di mana batas pinjaman (**Max LTV**) dihitung dinamis oleh **Risk Engine di Arbitrum Stylus (Rust/WASM)**.

```
 Borrower                         Liquidity Provider
    │                                     │
    │ collateral (tAAPL, tNVDA)           │ stablecoin (USDC)
    ▼                                     ▼
┌─────────────────────────────────────────────────┐
│                   RepoVault.sol                 │
│  - openPosition(asset, amount, term)            │
│  - repay(positionId)                            │
│  - liquidate(positionId)   ◄── Keeper (siapa saja)
└───────────────┬───────────────────┬─────────────┘
                │ getMaxLTV()       │ price feed
                ▼                   ▼
     ┌─────────────────────┐  ┌───────────────┐
     │  RiskEngine (Stylus)│  │ Chainlink Feed│
     │  - rolling vol buffer│ │ (per aset)    │
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

Komputasi akar kuadrat berulang, log return harian, dan kalkulasi varians di EVM/Solidity biasa memakan biaya gas yang sangat mahal. Dengan **Arbitrum Stylus (Rust $\rightarrow$ WASM)**, efisiensi komputasi meningkat 10–100x lipat dengan pemangkasan biaya gas hingga **86.6%**.

### Formula Matematis:
1. **Return logaritmik harian:**  
   $$r_t \approx \frac{P_t - P_{t-1}}{P_{t-1}}$$
2. **Realized variance:**  
   $$\sigma^2 = \frac{1}{N} \sum (r_t)^2$$
3. **Daily realized volatility:**  
   $$\sigma_{\text{daily}} = \sqrt{\sigma^2}$$
4. **Parametric VaR Haircut (Confidence $\alpha = 99\%$, $z_\alpha = 2.33$):**  
   $$\text{Haircut} = z_\alpha \times \sigma_{\text{daily}} \times \sqrt{t}$$
5. **Clamped Max LTV:**  
   $$\text{Max LTV} = \text{clamp}(1 - \text{Haircut}, 20\%, 80\%)$$

### Perbandingan Hasil Perhitungan:
| Aset | Volatilitas Harian ($\sigma$) | Jangka Waktu | Haircut | Max LTV (OrbitRepo) | LTV Aave / Morpho Biasa |
|---|---|---|---|---|---|
| **Saham Volatil (tAAPL)** | 3.2% / hari | Overnight (1 Hari) | 7.5% | **80.0%** (Capped) | 75.0% |
| **Saham Volatil (tAAPL)** | 3.2% / hari | **30 Hari** | 40.8% | **59.2%** (Disesuaikan) | 75.0% *(Rawan Bad Debt!)* |
| **Broad-market ETF (tSPY)** | 1.1% / hari | 30 Hari | 15.3% | **80.0%** (Capped) | 75.0% *(Under-leveraged)* |

---

## 4. Struktur Smart Contract

- [`RepoVault.sol`](contracts/solidity/RepoVault.sol): Kontrak inti pengelola posisi repo, penguncian agunan tokenized stock, kalkulasi bunga tetap, dan likuidasi permissionless.
- [`LiquidityPool.sol`](contracts/solidity/LiquidityPool.sol): Pool likuiditas USDC dengan sistem *shares-based accounting* dan akrual imbal hasil repo.
- [`RiskEngine (lib.rs)`](contracts/stylus/risk_engine/src/lib.rs): Kontrak Arbitrum Stylus dalam Rust yang mengimplementasikan Parametric VaR dan integer square root.
- [`MockStockToken.sol`](contracts/solidity/mocks/MockStockToken.sol): Mock ERC-20 untuk simulasi saham ter-tokenisasi (`tAAPL`, `tNVDA`).
- [`MockPriceOracle.sol`](contracts/solidity/mocks/MockPriceOracle.sol): Oracle Chainlink simulator dengan fitur drop harga on-the-fly untuk demo likuidasi live.

---

## 5. Cara Menjalankan (Testing & Build)

### Prasyarat
- [Foundry](https://getfoundry.sh/) (`forge`, `cast`)
- Rust & Cargo dengan target `wasm32-unknown-unknown`
- `cargo-stylus` (versi 0.6.3+)
- Node.js (v20+) & npm

### A. Uji Coba Smart Contract (Foundry)
```bash
# Jalankan seluruh unit test Solidity (LiquidityPool, RepoVault, Dynamic LTV, & Liquidation)
forge test -vvv
```

### B. Verifikasi Arbitrum Stylus WASM
```bash
cd contracts/stylus/risk_engine
cargo stylus check --endpoint https://sepolia-rollup.arbitrum.io/rpc
```

### C. Menjalankan Frontend Dashboard
```bash
cd frontend
npm install
npm run dev
```
Buka browser di `http://localhost:5173`.

---

## 6. Fitur Frontend Web Dashboard

1. **Borrower Tab:** Pilih saham (tAAPL/tNVDA), tentukan jangka waktu repo (1, 7, 30 hari), dan amati kalkulasi LTV live yang disesuaikan oleh Stylus Risk Engine.
2. **Liquidity Provider Tab:** Setor stablecoin USDC untuk memperoleh imbal hasil tetap berjangka yang terkunci di muka.
3. **Live Crisis Simulator:** Tombol demo khusus juri untuk mensimulasikan *earnings drop* (-25% s/d -45%), memicu status *Liquidatable*, dan mengeksekusi likuidasi 1-klik dengan keeper profit bounty.
4. **Testnet Faucet:** Klaim token simulasi (tAAPL, tNVDA, USDC) dengan satu klik.

---

## 7. Pemetaan Kriteria Penilaian Hackathon

- **Ecosystem Alignment (T&C Klausul 6.2):** Didesain secara spesifik untuk tokenized equity di **Robinhood Chain** (memenuhi kuota prioritas juara Robinhood Chain).
- **Use of Arbitrum Technology:** Menggunakan **Arbitrum Stylus MultiVM** secara otentik untuk komputasi matematika berat (Parametric VaR & realized volatility buffer) yang tidak ekonomis di EVM biasa.
- **Smart Contract Quality:** Menerapkan *checks-effects-interactions*, *ReentrancyGuard*, non-upgradeable core (trust-minimized), validasi staleness oracle, dan 100% lulus uji unit test Foundry.
- **Novelty & Impact:** Mengadaptasi pasar repo institusional senilai $4,4T/hari ke ekosistem tokenized stock dengan manajemen risiko dinamis pertama di on-chain.

---

## Lisensi
MIT License. Dibuat untuk Arbitrum Open House Singapore Online Buildathon 2026.
