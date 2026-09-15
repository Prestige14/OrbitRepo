# OrbitRepo — Software Requirements Specification (SRS)
### Fixed-Term Repo Market untuk Tokenized Equity, dengan Dynamic Risk Engine berbasis Arbitrum Stylus

**Versi:** 1.0 — Hackathon Build (Arbitrum Open House Singapore)
**Target deployment:** Robinhood Chain Testnet (fallback: Arbitrum Sepolia)
**Status dokumen:** Siap untuk mulai implementasi 14 September 2026

---

## Daftar Isi

0. Ringkasan Eksekutif
1. Problem Statement (Revisi)
2. Solusi: Apa Itu OrbitRepo
3. Ruang Lingkup (In-Scope vs Out-of-Scope)
4. Aktor & Stakeholder
5. Arsitektur Sistem
6. Functional Requirements
7. Deep-Dive: Dynamic Risk Engine (Stylus)
8. Spesifikasi Smart Contract
9. Non-Functional Requirements
10. Struktur Repository
11. Rencana Build 3 Minggu
12. Anggaran (Low-Budget Plan)
13. Risk Register & Batasan yang Diketahui
14. Pemetaan ke Kriteria Penilaian
15. Rencana Demo & Pitch
16. Roadmap Pasca-Hackathon
17. Referensi

---

## 0. Ringkasan Eksekutif

OrbitRepo adalah pasar repo (*repurchase agreement*) fixed-term terdesentralisasi untuk saham dan ETF AS ter-tokenisasi di Robinhood Chain. Alih-alih meminjamkan aset di pool terbuka dengan rasio agunan statis satu-ukuran-untuk-semua (pola yang sudah dipakai fitur lending bawaan Robinhood Chain sendiri lewat Morpho), OrbitRepo menghitung batas pinjaman (max LTV) **secara dinamis per aset dan per jangka waktu**, menggunakan mesin risiko yang ditulis di Arbitrum Stylus (Rust/WASM) karena kalkulasi volatilitas berulang seperti ini terlalu mahal untuk dijalankan langsung di EVM/Solidity.

Satu kalimat elevator pitch: *"Aave memberi semua orang LTV 75% yang sama. OrbitRepo menghitung ulang LTV yang aman untuk tiap saham, tiap malam, berdasarkan volatilitas riilnya — dan itu hanya mungkin secara ekonomis berkat Stylus."*

---

## 1. Problem Statement (Revisi)

### 1.1 Konteks TradFi
Pasar Repo di Wall Street mencatat rata-rata **lebih dari $4,3–4,4 triliun** nilai transaksi harian (data SIFMA) — salah satu pasar pendanaan jangka pendek terbesar di dunia. Institusi memakainya karena satu alasan sederhana: mereka butuh uang tunai jangka pendek tanpa menjual aset (menghindari pajak capital gain, mempertahankan eksposur strategis). Pola yang sama juga sudah jadi produk retail mainstream di TradFi — *securities-based line of credit* dari broker seperti Schwab atau Interactive Brokers pada dasarnya adalah repo yang dikemas untuk individu.

### 1.2 Koreksi Penting: Apa yang Sudah Ada di Robinhood Chain
Draft awal proyek ini mengklaim "tidak ada pasar likuiditas untuk aset ter-tokenisasi di Robinhood Chain." **Klaim ini sudah tidak akurat dan harus tidak dipakai lagi.** Saat mainnet Robinhood Chain resmi jalan 1 Juli 2026, chain ini langsung dibundel dengan primitif DeFi lending & borrowing out-of-the-box (produk *Robinhood Earn*, di-power protokol Morpho), dan Stock Token memang didesain eksplisit untuk bisa dijadikan agunan, dipinjamkan, dan diperdagangkan di DEX pihak ketiga sejak hari pertama.

Menyampaikan klaim lama itu ke juri (yang kemungkinan besar termasuk orang dari Robinhood/Arbitrum sendiri) berisiko tinggi dipatahkan langsung di sesi tanya-jawab.

### 1.3 Gap yang Sebenarnya (versi presisi, defensible)
Yang **tidak** tersedia — dan menjadi ruang lingkup OrbitRepo — ada dua:

1. **Struktur produk**: pool lending generik (Morpho/Aave-style) bersifat open-ended — durasi tidak tetap, rate mengambang mengikuti utilisasi. Repo sungguhan di TradFi selalu **fixed-term**: jangka waktu dan rate disepakati di muka (overnight, 7 hari, 30 hari), lalu ditebus di tanggal jatuh tempo. Ini bukan sekadar gaya — struktur ini memberi Liquidity Provider profil imbal hasil yang mirip obligasi (predictable, berjangka), bukan APY mengambang.
2. **Model risiko**: pool lending yang ada — seperti kebanyakan protokol DeFi lending (Aave, Compound, dan kemungkinan besar konfigurasi Morpho di Robinhood Earn juga) — memakai parameter LTV/liquidation threshold yang **statis** dan jarang berubah. Riset akademik mendokumentasikan ini sebagai kelemahan struktural nyata: parameter risiko Aave V2 misalnya hanya diubah 13 kali dalam dua tahun pertama meski volatilitas pasar naik-turun tajam. Untuk kripto-native asset ini sudah berisiko; untuk **saham individual**, ini jauh lebih berbahaya karena tiga alasan yang justru disebut sendiri di draft awal proyek ini: volatilitas pasar saham yang berbeda-beda tiap ticker, gap risk saat market re-open (harga bisa loncat 10-20%+ semalam karena earnings), dan korelasi antar aset dalam portofolio yang berubah-ubah. Satu LTV flat untuk semua saham berarti aset aman "dikenai pajak" modal berlebih (buruk untuk efisiensi modal & PMF), sementara aset berisiko justru kurang diberi margin pengaman (buruk untuk solvabilitas protokol).

### 1.4 Pernyataan Masalah Final
> Robinhood Chain sudah punya *tempat* untuk meminjamkan saham ter-tokenisasi, tapi belum punya *pasar repo fixed-term dengan manajemen risiko yang benar-benar disesuaikan per aset*. Setiap saham diperlakukan sama, padahal risikonya sangat tidak sama. OrbitRepo mengisi dua gap spesifik ini sekaligus — bukan mengklaim menciptakan lending dari nol.

---

## 2. Solusi: Apa Itu OrbitRepo

OrbitRepo adalah protokol dua sisi:

- **Borrower** mengagunkan Stock Token (mis. tAAPL, tNVDA), memilih jangka waktu repo (overnight / 7 hari / 30 hari), dan meminjam stablecoin sampai batas LTV yang **dihitung real-time oleh Risk Engine** — bukan angka tetap.
- **Liquidity Provider (LP)** menyetor stablecoin ke pool, mendapat imbal hasil berjangka (repo rate) yang terkunci di awal — profil risiko/return lebih mirip obligasi pendek daripada APY DeFi yang naik-turun liar.
- Di tanggal jatuh tempo, borrower menebus (bayar pokok + rate) untuk mengambil kembali agunannya, atau posisi dilikuidasi bila tidak ditebus/ tidak lagi memenuhi margin.
- **Risk Engine** (Stylus/Rust) menghitung volatilitas realized bergulir per aset dari buffer harga on-chain, mengonversinya jadi margin/haircut lewat rumus parametric VaR, dan mengekspos angka itu ke smart contract Solidity yang menegakkan aturannya.

---

## 3. Ruang Lingkup

### 3.1 In-Scope (MVP Buildathon, 14 Sept – 1 Okt)

| Komponen | Deskripsi |
|---|---|
| RepoVault (Solidity) | Buka posisi, setor agunan, pinjam, bayar/tebus, trigger likuidasi |
| LiquidityPool (Solidity) | Setor/tarik stablecoin LP, akrual yield berjangka |
| RiskEngine (Stylus/Rust) | Hitung realized volatility + margin dinamis per aset, per jangka waktu |
| Whitelist aset | 3 aset tetap: 2 Stock Token (mis. tAAPL, tNVDA) + 1 ETF token, testnet Robinhood Chain atau mock ERC-20 berlabel simulasi di Sepolia sebagai fallback |
| Oracle | Chainlink Price Feed (partner infrastruktur resmi Robinhood Chain sejak testnet) |
| Frontend minimal | Buka posisi, lihat margin live, dashboard LP |
| Deployment | Robinhood Chain Testnet **dan** Arbitrum Sepolia (memenuhi syarat T&C klausul 3.1) |

### 3.2 Out-of-Scope (dinyatakan eksplisit — jangan overclaim ke juri)

- Portfolio VaR multi-aset dengan matriks kovarians penuh (di-descope ke volatilitas single-asset per posisi)
- Governance/DAO layer
- Cross-margining lintas posisi
- Insurance fund / dana talangan bad debt
- Aplikasi mobile native
- Integrasi on/off-ramp fiat nyata
- ERC-8004 (identitas agen keeper) dan x402 (pembayaran data) — dicatat sebagai roadmap V2, lihat Bagian 16

---

## 4. Aktor & Stakeholder

| Aktor | Tujuan | Interaksi Utama |
|---|---|---|
| Borrower | Dapat likuiditas stablecoin jangka pendek tanpa menjual saham | `openPosition()`, `repay()` |
| Liquidity Provider | Yield berjangka yang aman & terprediksi | `deposit()`, `withdraw()` |
| Keeper/Liquidator | Menjaga solvabilitas protokol, dapat fee likuidasi | `liquidate()` (permissionless, siapa saja bisa panggil) |
| Protokol (kontrak) | Tidak ada admin key untuk parameter risiko inti — risiko dihitung Risk Engine, bukan governance manual | — |

---

## 5. Arsitektur Sistem

```
 Borrower                         Liquidity Provider
    │                                     │
    │ collateral (Stock Token)            │ stablecoin
    ▼                                     ▼
┌─────────────────────────────────────────────────┐
│                   RepoVault.sol                  │
│  - openPosition(asset, amount, term)             │
│  - repay(positionId)                             │
│  - liquidate(positionId)   ◄── Keeper (siapa saja)│
└───────────────┬───────────────────┬──────────────┘
                │ getMaxLTV()       │ price feed
                ▼                   ▼
     ┌─────────────────────┐  ┌───────────────┐
     │  RiskEngine (Stylus) │  │ Chainlink Feed │
     │  - rolling vol buffer│  │ (per aset)     │
     │  - parametric VaR    │  └───────────────┘
     │  - haircut → maxLTV  │
     └─────────────────────┘
                │
                ▼
     ┌─────────────────────┐
     │  LiquidityPool.sol   │
     │  - deposit/withdraw  │
     │  - accrue repo yield │
     └─────────────────────┘
```

**Alur singkat:** Borrower memanggil `openPosition()` → RepoVault meminta batas LTV terkini dari RiskEngine (yang sudah dihitung dari data oracle) → RepoVault mengunci agunan dan mencairkan stablecoin dari LiquidityPool sesuai batas itu → di jatuh tempo, borrower `repay()` untuk menebus, atau siapa pun bisa `liquidate()` bila margin call terlanggar sebelum jatuh tempo.

---

## 6. Functional Requirements

**Manajemen Agunan**
- FR-1: Sistem harus membatasi agunan hanya pada aset yang ada di whitelist (maks 3 aset untuk MVP).
- FR-2: Sistem harus menolak `openPosition()` jika oracle price untuk aset tsb sudah stale (lihat FR-9).

**Siklus Repo**
- FR-3: Borrower dapat membuka posisi dengan memilih salah satu dari 3 jangka waktu tetap (1 hari, 7 hari, 30 hari).
- FR-4: Jumlah pinjaman maksimum = `collateralValue × maxLTV(asset, term)`, dengan `maxLTV` diambil dari RiskEngine saat transaksi dieksekusi (bukan nilai cache lama).
- FR-5: Borrower dapat menebus agunan dengan `repay(principal + rate)` kapan saja sebelum atau tepat di jatuh tempo.
- FR-6: Jika tidak ditebus di jatuh tempo, ATAU jika `currentLTV > maxLTV` kapan saja sebelum jatuh tempo (mark-to-market), posisi menjadi *liquidatable*.

**Risk Engine**
- FR-7: RiskEngine harus menyimpan buffer harga bergulir (rolling window) per aset dan memperbaruinya setiap ada update harga baru dari oracle.
- FR-8: RiskEngine harus mengekspos fungsi `getMaxLTV(asset, termDays)` sebagai `view` function yang bisa dipanggil kontrak Solidity secara sinkron dalam satu transaksi.
- FR-9: RiskEngine harus menolak memberi kuotasi (`revert`/return nilai invalid) bila data harga terakhir lebih tua dari threshold staleness (mis. > 1 jam).

**Liquidity Pool**
- FR-10: LP dapat setor/tarik stablecoin selama tidak sedang dipinjamkan (utilisasi < 100%).
- FR-11: Yield LP dihitung dari rate repo yang terkunci saat posisi dibuka, diakumulasikan proporsional ke lama waktu.

**Likuidasi**
- FR-12: Fungsi `liquidate()` bersifat permissionless — siapa pun (termasuk bot keeper sederhana) dapat memanggilnya jika syarat FR-6 terpenuhi, dengan insentif fee likuidasi.

---

## 7. Deep-Dive: Dynamic Risk Engine (Stylus)

### 7.1 Kenapa Ini Butuh Stylus, Bukan Solidity Biasa

EVM tidak punya native floating point; menghitung return logaritmik, akar kuadrat, dan menjumlah varians dari N titik harga tersimpan (storage reads berulang) di Solidity berarti: (a) perlu library fixed-point math tambahan, (b) loop di atas storage yang mahal per SLOAD, dan (c) rawan overflow di kalkulasi bertingkat. Stylus (Rust → WASM) memberi compute 10–100x lebih murah dan memori 100–500x lebih murah dibanding EVM untuk beban kerja seperti ini (sumber: dokumentasi resmi Stylus), dan tetap bisa dipanggil langsung dari kontrak Solidity lewat interoperabilitas MultiVM. Ini alasan teknis konkret, bukan sekadar "pakai teknologi baru biar keren."

### 7.2 Formula (Parametric VaR — metode variance-covariance, disederhanakan single-asset)

```
1. Log return harian:        r_t = ln(P_t / P_(t-1))
2. Realized variance (N hari): σ² = (1/N) × Σ(r_t)²
3. Volatilitas harian:        σ_daily = √σ²
4. VaR (haircut) untuk jangka waktu t hari, confidence α:
       haircut = z_α × σ_daily × √t
5. Max LTV = clamp(1 − haircut, LTV_min, LTV_max)
   dengan LTV_min = 20%, LTV_max = 80% (hard cap tingkat protokol)
```

`z_α` = 2.33 untuk confidence 99%, atau 1.645 untuk 95%.

**Kenapa ada hard cap 80%, bukan murni hasil rumus?** Model VaR parametrik mengasumsikan return terdistribusi normal — asumsi ini cenderung meremehkan risiko *fat-tail*, termasuk gap risk saat market re-open setelah rilis earnings mendadak (persis yang disebut sebagai kekhawatiran di draft awal proyek ini). Karena itu hard cap di level protokol dipertahankan sebagai lapisan pengaman kedua, terlepas dari berapa pun hasil komputasi model. Ini poin yang sengaja ditonjolkan ke juri — menunjukkan kesadaran akan keterbatasan model, bukan overclaim.

### 7.3 Contoh Numerik (ilustratif, bukan data pasar riil)

| Aset (asumsi σ_daily) | Jangka | Haircut = z·σ·√t | Max LTV (clamp 20–80%) |
|---|---|---|---|
| Saham volatil, mis. σ=3.2%/hari | Overnight (1 hari) | 7.5% | 80% (kena cap) |
| Saham volatil, σ=3.2%/hari | 30 hari | 40.8% | **59.2%** |
| ETF broad-market, σ=1.2%/hari | Overnight (1 hari) | 2.8% | 80% (kena cap) |
| ETF broad-market, σ=1.2%/hari | 30 hari | 15.3% | 80% (kena cap) |

Perhatikan baris 30-hari: dua aset dengan profil risiko berbeda mendapat max LTV yang **berbeda signifikan** (59.2% vs 80%) — inilah yang tidak bisa diberikan pool LTV statis satu-angka-untuk-semua.

### 7.4 Mengatasi Cold-Start Data (jangan disembunyikan dari juri)

Robinhood Chain baru berjalan sejak Juli 2026 — belum ada 30 hari histori harga on-chain yang dalam untuk aset yang benar-benar baru di-tokenisasi. Solusi jujur untuk MVP: **bootstrap** buffer volatilitas dengan asumsi volatilitas sektor yang konservatif (mis. 35–45% annualized untuk saham teknologi, angka standar asumsi ekuitas) saat aset pertama kali di-whitelist, lalu biarkan buffer terisi data on-chain riil seiring waktu dan menggantikan asumsi awal secara bertahap. Ini didokumentasikan secara eksplisit sebagai batasan V1 di Bagian 13, bukan disembunyikan.

---

## 8. Spesifikasi Smart Contract

### 8.1 `RepoVault.sol` (Solidity)
State kunci: `mapping(uint256 => Position) positions`, `mapping(address => bool) whitelistedAssets`.
Fungsi kunci: `openPosition(address asset, uint256 collateralAmount, uint8 termDays) → uint256 positionId`; `repay(uint256 positionId)`; `liquidate(uint256 positionId)`; `getPositionHealth(uint256 positionId) view returns (uint256 currentLTV, uint256 maxLTV)`.
Events: `PositionOpened`, `PositionRepaid`, `PositionLiquidated`.

### 8.2 `LiquidityPool.sol` (Solidity)
Fungsi kunci: `deposit(uint256 amount)`, `withdraw(uint256 shares)`, `accrueYield(uint256 positionId, uint256 rateEarned)` (dipanggil internal oleh RepoVault saat repay).

### 8.3 `RiskEngine` (Stylus/Rust — sketsa interface, bukan kode final)
```rust
// Sketsa — sesuaikan dengan versi stylus-sdk terkini saat implementasi
#[public]
impl RiskEngine {
    pub fn push_price(&mut self, asset: Address, price: U256, timestamp: U256);
    pub fn get_max_ltv(&self, asset: Address, term_days: U256) -> U256;
    pub fn get_realized_vol(&self, asset: Address) -> U256; // basis poin, untuk transparansi/debug
}
```
Interface Solidity untuk memanggilnya:
```solidity
interface IRiskEngine {
    function getMaxLTV(address asset, uint8 termDays) external view returns (uint256);
}
```

### 8.4 Mock/Test Asset
`MockStockToken.sol` — ERC-20 sederhana berlabel jelas "SIMULATION — not real equity exposure", dipakai sebagai fallback jika akses/likuiditas testnet-asset Robinhood Chain terbatas selama buildathon.

---

## 9. Non-Functional Requirements

- **Keamanan**: pola checks-effects-interactions di semua fungsi yang mentransfer dana; reentrancy guard di `openPosition`, `repay`, `liquidate`; validasi staleness oracle wajib (FR-9) sebelum kuotasi dipakai.
- **Efisiensi gas**: target pemanggilan `getMaxLTV()` tidak melebihi anggaran gas yang membuat `openPosition()` terasa mahal dibanding pool lending biasa — inilah yang harus dibuktikan lewat benchmark aktual (bukan diasumsikan) sebelum submission.
- **Non-upgradeable untuk MVP**: tanpa proxy/admin key di jalur risiko inti, memperkuat narasi trust-minimization ke juri (lebih meyakinkan daripada "percaya saja ke tim kami").
- **Testability**: setiap fungsi FR punya minimal satu unit test (Solidity via Foundry/Hardhat, Rust via `cargo test`) sebelum deadline.
- **Target chain**: harus jalan di Arbitrum Sepolia minimal (syarat T&C 3.1); Robinhood Chain Testnet sebagai target utama bila akses tersedia.

---

## 10. Struktur Repository

```
orbitrepo/
├── contracts/
│   ├── solidity/
│   │   ├── RepoVault.sol
│   │   ├── LiquidityPool.sol
│   │   ├── interfaces/
│   │   │   ├── IRiskEngine.sol
│   │   │   └── IPriceOracle.sol
│   │   └── mocks/
│   │       └── MockStockToken.sol
│   └── stylus/
│       └── risk_engine/
│           ├── src/lib.rs
│           └── Cargo.toml
├── scripts/
│   ├── deploy.ts
│   └── bootstrap_volatility.ts
├── frontend/               # Next.js/React minimal
├── test/
│   ├── RepoVault.test.ts
│   └── risk_engine.rs
└── docs/
    └── SRS.md              # dokumen ini
```

---

## 11. Rencana Build 3 Minggu

*(Ingat: Code of Conduct mengizinkan riset/wireframe sebelum 14 Sept, tapi coding sungguhan baru mulai saat buildathon resmi jalan.)*

| Periode | Fokus | Output |
|---|---|---|
| Sekarang – 14 Sept | Riset docs Robinhood Chain testnet & Discord Arbitrum, cek ketersediaan Chainlink feed untuk aset target, wireframe UI, finalisasi pitch narrative | Dokumen ini + rencana teknis siap eksekusi |
| 14–19 Sept | `RepoVault.sol` + `LiquidityPool.sol` + mock asset + deploy ke Sepolia | Kontrak inti jalan di testnet, test dasar lulus |
| 19–24 Sept | `RiskEngine` Stylus: buffer harga, formula VaR, integrasi ke RepoVault; bootstrap volatilitas | Risk engine terhubung end-to-end, benchmark gas riil vs versi Solidity |
| 24–28 Sept | Fungsi likuidasi + keeper sederhana; migrasi/uji di Robinhood Chain Testnet | Siklus penuh: buka posisi → margin call → likuidasi, terdemonstrasi |
| 28 Sept–1 Okt | Frontend, video demo, polish pitch deck, submit | Submission lengkap sebelum 1 Okt 23:59 SGT |

---

## 12. Anggaran (Low-Budget Plan)

| Kebutuhan | Opsi Gratis/Murah |
|---|---|
| Deploy testnet | Faucet Arbitrum Sepolia + Robinhood Chain Testnet (gratis) |
| Oracle | Chainlink Price Feed testnet (gratis) |
| RPC/infra | Alchemy free tier (partner infrastruktur resmi Robinhood Chain) |
| Hosting frontend | Vercel/Netlify free tier |
| Library kontrak | OpenZeppelin (open-source), stylus-sdk (open-source) |
| Testing lokal | Nitro devnode lokal sebelum pakai testnet publik (hindari rate-limit faucet) |
| Audit | Tidak perlu untuk hackathon — cukup unit test menyeluruh; audit nyata jadi item roadmap pasca-hackathon (Bagian 16) |

---

## 13. Risk Register & Batasan yang Diketahui

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Data volatilitas historis tipis (aset baru) | Model kurang akurat di awal | Bootstrap dengan asumsi konservatif (7.4), didokumentasikan terbuka |
| Ketersediaan testnet asset Robinhood Chain terbatas selama buildathon | Tidak bisa deploy ke chain target utama | Fallback mock ERC-20 di Sepolia, kontrak didesain siap-pakai untuk migrasi |
| Model VaR parametrik meremehkan tail risk | Undercollateralization saat gap besar | Hard cap LTV di level protokol (7.2) |
| Kompleksitas likuidasi disepelekan | Pitch terlihat setengah jadi | FR-12 wajib ada di MVP walau sederhana, bukan opsional |
| Klaim "90% gas savings" tanpa benchmark sendiri | Kredibilitas turun jika ditanya juri | Jalankan benchmark aktual sebelum submission; jika belum sempat, kutip rentang resmi Stylus (10–100x compute) alih-alih angka spesifik yang belum diukur sendiri |
| Scope creep ke ERC-8004/x402 di menit akhir | Mengorbankan kualitas fitur inti | Eksplisit out-of-scope untuk V1 (Bagian 3.2) |

---

## 14. Pemetaan ke Kriteria Penilaian

| Kriteria | Bagaimana OrbitRepo Menjawabnya |
|---|---|
| Smart contract quality | Reentrancy guard, checks-effects-interactions, non-upgradeable core, unit test menyeluruh, arsitektur MultiVM (Solidity+Stylus) yang genuinely diperlukan (bukan dekoratif) |
| Product-Market Fit | Analogi TradFi $4,3T/hari + securities-based line of credit yang sudah mainstream di broker retail AS; gap presisi terhadap apa yang sudah di-ship Robinhood Chain sendiri |
| Innovation & Creativity | Risk engine dinamis per-aset via Stylus — gap yang diakui literatur akademik DeFi lending, belum ada presedennya di pemenang Open House sebelumnya |
| Real Problem Solving | Structural gap ganda: fixed-term (bukan open pool) + risk-based (bukan flat LTV), keduanya dijelaskan dengan alasan kuantitatif, bukan asumsi |
| Ecosystem alignment | Dibangun spesifik untuk Robinhood Chain → memenuhi syarat T&C klausul 6.2 (minimal 1 dari 3 slot juara direservasi untuk builder Robinhood Chain) |

---

## 15. Rencana Demo & Pitch

**Struktur demo (3–5 menit):**
1. Buka dengan angka TradFi ($4,3T/hari repo market) — 15 detik.
2. Tunjukkan LANGSUNG di UI: dua aset berbeda volatilitas, tampilkan Max LTV yang dihitung live berbeda untuk keduanya di jangka waktu yang sama (pakai tabel Bagian 7.3 sebagai referensi visual).
3. Buka posisi → tunjukkan agunan terkunci, stablecoin cair sesuai LTV dinamis.
4. Simulasikan harga jatuh (ubah mock price) → tunjukkan posisi jadi liquidatable → panggil `liquidate()`.
5. Tutup dengan "pukulan" teknis: kenapa ini tidak feasible di Solidity biasa, dan angka gas benchmark riil (bukan estimasi) jika sempat diukur.

**Satu kalimat penutup yang disarankan:** *"Kami tidak mengklaim membangun lending pertama di Robinhood Chain — kami membangun risk engine pertama yang cukup murah untuk dijalankan on-chain, per aset, per malam."*

---

## 16. Roadmap Pasca-Hackathon

- V2: portfolio VaR multi-aset dengan korelasi (bukan cuma single-asset)
- V2: registrasi keeper/liquidator lewat ERC-8004 agar rekam jejaknya bisa diverifikasi publik (mencegah keeper nakal front-running likuidasi)
- V2: RiskEngine membayar data feed pihak ketiga per-panggilan lewat x402
- V2: dana asuransi (insurance fund) untuk menyerap bad debt residual
- Jalur mainnet: audit smart contract independen, lalu proses grant agreement dengan Arbitrum Foundation sesuai struktur pencairan bertahap di T&C klausul 6.2 (25% saat sign, 25% usai check-in, 50% terikat mainnet launch + KPI)

---

## 17. Referensi

- SIFMA — Capital Markets Fact Book & Compendium on Fixed Income Market Structure (data repo market ~$4,3–4,4T/hari): sifma.org/research/statistics/fact-book
- Arbitrum Docs — Gas and Ink in Stylus (compute 10–100x lebih murah, memori 100–500x): docs.arbitrum.io/stylus/concepts/stylus-gas
- WELLDONE Studio — Arbitrum Stylus Gas Efficiency Test (benchmark independen, hingga 86,6% gas savings untuk komputasi intensif): docs.welldonestudio.io/tutorials/arbitrum-stylus-benchmark
- The Block — "Robinhood Chain goes live on mainnet alongside 24/7 tokenized stocks..." (konfirmasi lending/borrowing native sejak mainnet 1 Juli 2026): theblock.co
- bit.com Knowledge Hub — "Robinhood Chain" (Stock Token bisa dijadikan agunan/dipinjamkan sejak awal): bit.com/knowledge-hub/robinhood-chain
- Chiu, Ozdenoren, Yuan, Zhang — "On the Fragility of DeFi Lending" (parameter risiko Aave V2 hanya berubah 13 kali dalam 2 tahun): dikutip via PHBS/Warwick working paper series
- Arbitrum Foundation — First Half 2026 Progress Update (posisi RWA #1, kontribusi Robinhood Chain ke pendapatan DAO)

---

*Dokumen ini adalah spesifikasi kerja, bukan dokumen final beku — update Bagian 13 (Risk Register) begitu asumsi berubah selama proses build.*
