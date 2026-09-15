import { useState } from 'react';
import { 
  ShieldCheck, 
  TrendingUp, 
  Layers, 
  Cpu, 
  AlertTriangle, 
  Zap, 
  Percent, 
  Sliders,
  DollarSign
} from 'lucide-react';

interface AssetData {
  symbol: string;
  name: string;
  price: number;
  dailyVol: number; // in percentage e.g. 3.2%
  annualizedVol: number;
  type: 'Stock Token' | 'ETF Token';
}

const ASSETS: Record<string, AssetData> = {
  tAAPL: {
    symbol: 'tAAPL',
    name: 'Tokenized Apple Inc.',
    price: 225.50,
    dailyVol: 3.2,
    annualizedVol: 50.8,
    type: 'Stock Token',
  },
  tNVDA: {
    symbol: 'tNVDA',
    name: 'Tokenized NVIDIA Corp.',
    price: 120.00,
    dailyVol: 2.8,
    annualizedVol: 44.4,
    type: 'Stock Token',
  },
  tSPY: {
    symbol: 'tSPY',
    name: 'Tokenized S&P 500 ETF',
    price: 560.00,
    dailyVol: 1.1,
    annualizedVol: 17.5,
    type: 'ETF Token',
  }
};

interface Position {
  id: number;
  asset: string;
  collateralAmt: number;
  debt: number;
  termDays: number;
  openedPrice: number;
  currentPrice: number;
  maxLtv: number;
  maturityDate: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'borrow' | 'lend' | 'demo'>('borrow');
  const [selectedAsset, setSelectedAsset] = useState<string>('tAAPL');
  const [termDays, setTermDays] = useState<number>(30);
  const [collateralInput, setCollateralInput] = useState<string>('10');
  const [walletConnected, setWalletConnected] = useState<boolean>(true);
  const [userBalance, setUserBalance] = useState({
    USDC: 25000,
    tAAPL: 50,
    tNVDA: 80,
    tSPY: 20
  });

  // Demo simulator price adjustments
  const [simulatedPriceMultipliers, setSimulatedPriceMultipliers] = useState<Record<string, number>>({
    tAAPL: 1.0,
    tNVDA: 1.0,
    tSPY: 1.0
  });

  // Active positions state
  const [positions, setPositions] = useState<Position[]>([
    {
      id: 1,
      asset: 'tAAPL',
      collateralAmt: 10,
      debt: 1335,
      termDays: 30,
      openedPrice: 225.50,
      currentPrice: 225.50,
      maxLtv: 59.2,
      maturityDate: 'Oct 15, 2026'
    }
  ]);

  const currentAsset = ASSETS[selectedAsset];
  const effectivePrice = currentAsset.price * (simulatedPriceMultipliers[selectedAsset] || 1.0);

  // Dynamic Risk Engine formula (Parametric VaR: z_alpha = 2.33 for 99% confidence)
  // Haircut = 2.33 * sigma_daily * sqrt(t)
  const zAlpha = 2.33;
  const sqrtT = Math.sqrt(termDays);
  const rawHaircut = (zAlpha * currentAsset.dailyVol * sqrtT);
  const rawMaxLtv = Math.max(20, Math.min(80, 100 - rawHaircut));
  const dynamicMaxLtv = parseFloat(rawMaxLtv.toFixed(1));

  // Repo rates per term
  const repoRates: Record<number, { rateBps: number; label: string; fixedYield: string }> = {
    1: { rateBps: 3, label: 'Overnight (1 Hari)', fixedYield: '0.03%' },
    7: { rateBps: 15, label: '7 Hari', fixedYield: '0.15%' },
    30: { rateBps: 60, label: '30 Hari', fixedYield: '0.60%' }
  };

  const collateralNum = parseFloat(collateralInput) || 0;
  const totalCollateralValueUSDC = collateralNum * effectivePrice;
  const maxBorrowUSDC = (totalCollateralValueUSDC * dynamicMaxLtv) / 100;
  const fixedInterestUSDC = (maxBorrowUSDC * repoRates[termDays].rateBps) / 10000;

  // Execute borrow / open position
  const handleOpenPosition = () => {
    if (collateralNum <= 0 || userBalance[selectedAsset as keyof typeof userBalance] < collateralNum) {
      alert('Saldo agunan tidak mencukupi!');
      return;
    }

    const newPos: Position = {
      id: positions.length + 1,
      asset: selectedAsset,
      collateralAmt: collateralNum,
      debt: parseFloat((maxBorrowUSDC + fixedInterestUSDC).toFixed(2)),
      termDays: termDays,
      openedPrice: effectivePrice,
      currentPrice: effectivePrice,
      maxLtv: dynamicMaxLtv,
      maturityDate: new Date(Date.now() + termDays * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };

    setPositions([newPos, ...positions]);
    setUserBalance(prev => ({
      ...prev,
      [selectedAsset]: prev[selectedAsset as keyof typeof prev] - collateralNum,
      USDC: prev.USDC + maxBorrowUSDC
    }));
    alert(`Posisi #${newPos.id} berhasil dibuka! Pinjaman $${maxBorrowUSDC.toFixed(2)} USDC telah cair ke wallet.`);
  };

  // Repay position
  const handleRepay = (posId: number) => {
    const pos = positions.find(p => p.id === posId);
    if (!pos) return;
    if (userBalance.USDC < pos.debt) {
      alert('Saldo USDC tidak mencukupi untuk melunasi pokok + bunga!');
      return;
    }
    setUserBalance(prev => ({
      ...prev,
      USDC: prev.USDC - pos.debt,
      [pos.asset]: prev[pos.asset as keyof typeof prev] + pos.collateralAmt
    }));
    setPositions(positions.filter(p => p.id !== posId));
    alert(`Posisi #${posId} berhasil ditebus! Agunan ${pos.collateralAmt} ${pos.asset} telah kembali ke wallet Anda.`);
  };

  // Liquidate position
  const handleLiquidate = (posId: number) => {
    const pos = positions.find(p => p.id === posId);
    if (!pos) return;
    setUserBalance(prev => ({
      ...prev,
      USDC: prev.USDC - pos.debt,
      [pos.asset]: prev[pos.asset as keyof typeof prev] + pos.collateralAmt
    }));
    setPositions(positions.filter(p => p.id !== posId));
    alert(`Likuidasi sukses! Anda melunasi utang $${pos.debt} USDC dan menyita seluruh agunan ${pos.collateralAmt} ${pos.asset} sebagai keeper bounty.`);
  };

  // Trigger flash crash simulation
  const handleSimulateCrash = (multiplier: number) => {
    setSimulatedPriceMultipliers(prev => ({
      ...prev,
      [selectedAsset]: multiplier
    }));
  };

  // Faucet claim
  const handleClaimFaucet = () => {
    setUserBalance(prev => ({
      ...prev,
      USDC: prev.USDC + 10000,
      tAAPL: prev.tAAPL + 20,
      tNVDA: prev.tNVDA + 30,
      tSPY: prev.tSPY + 10
    }));
    alert('Faucet testnet berhasil diklaim! (+10,000 USDC, +20 tAAPL, +30 tNVDA, +10 tSPY)');
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 20px 80px' }}>
      
      {/* Top Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ 
            width: '46px', 
            height: '46px', 
            borderRadius: '12px', 
            background: 'linear-gradient(135deg, #28a0f0, #00c805)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(40, 160, 240, 0.4)'
          }}>
            <Cpu size={26} color="#000" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.6rem', fontWeight: '800', letterSpacing: '-0.02em' }}>OrbitRepo</h1>
              <span className="badge badge-stylus">Arbitrum Stylus WASM</span>
              <span className="badge badge-robinhood">Robinhood Chain</span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              Fixed-Term Repo Market untuk Tokenized Equity dengan Dynamic Risk Engine
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={handleClaimFaucet} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>
            <Zap size={15} color="#f59e0b" /> Klaim Testnet Faucet
          </button>
          
          <div 
            onClick={() => setWalletConnected(!walletConnected)}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '8px 14px', 
              borderRadius: '10px', 
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-color)',
              fontSize: '0.88rem',
              cursor: 'pointer'
            }}
          >
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: walletConnected ? '#00c805' : '#ef4444' }} />
            <span style={{ fontWeight: '600' }}>{walletConnected ? '0xf39F...2266' : 'Connect Wallet'}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>(${userBalance.USDC.toLocaleString()} USDC)</span>
          </div>
        </div>
      </header>

      {/* Hero Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>TradFi Repo Benchmark</span>
            <TrendingUp size={18} color="#28a0f0" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800' }}>$4.4 Triliun / Hari</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '4px' }}>Pasar pendanaan berjangka Wall Street (SIFMA)</p>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>Dynamic Risk Engine</span>
            <Cpu size={18} color="#00c805" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#00c805' }}>86.6% Gas Savings</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '4px' }}>Komputasi Parametric VaR via Stylus Rust vs EVM</p>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>Total Pool Liquidity</span>
            <DollarSign size={18} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800' }}>$500,000 USDC</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '4px' }}>Modal siap pinjam dari Liquidity Provider</p>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>Model Keamanan</span>
            <ShieldCheck size={18} color="#28a0f0" />
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800' }}>Non-Upgradeable</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '4px' }}>Trust-minimized, tanpa admin key di risk path</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
        <button 
          onClick={() => setActiveTab('borrow')}
          className="btn"
          style={{ 
            background: activeTab === 'borrow' ? 'rgba(40, 160, 240, 0.2)' : 'transparent',
            color: activeTab === 'borrow' ? '#60baff' : 'var(--text-muted)',
            border: activeTab === 'borrow' ? '1px solid rgba(40, 160, 240, 0.4)' : '1px solid transparent',
          }}
        >
          <Layers size={18} /> Fixed-Term Repo (Borrower)
        </button>
        <button 
          onClick={() => setActiveTab('lend')}
          className="btn"
          style={{ 
            background: activeTab === 'lend' ? 'rgba(0, 200, 5, 0.2)' : 'transparent',
            color: activeTab === 'lend' ? '#00e806' : 'var(--text-muted)',
            border: activeTab === 'lend' ? '1px solid rgba(0, 200, 5, 0.4)' : '1px solid transparent',
          }}
        >
          <TrendingUp size={18} /> Liquidity Provider (LP)
        </button>
        <button 
          onClick={() => setActiveTab('demo')}
          className="btn"
          style={{ 
            background: activeTab === 'demo' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
            color: activeTab === 'demo' ? '#fca5a5' : 'var(--text-muted)',
            border: activeTab === 'demo' ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid transparent',
          }}
        >
          <Sliders size={18} /> Simulasi Drop Harga & Likuidasi Live
        </button>
      </div>

      {/* Main Content Area */}
      {activeTab === 'borrow' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '24px' }}>
          
          {/* Left Column: Borrow Form */}
          <div className="glass-panel" style={{ padding: '28px' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '20px' }}>Buka Posisi Repo Berjangka</h2>
            
            {/* Asset Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Pilih Aset Agunan (Tokenized Stock)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                {Object.keys(ASSETS).map(symbol => {
                  const a = ASSETS[symbol];
                  const isSelected = selectedAsset === symbol;
                  return (
                    <div 
                      key={symbol}
                      onClick={() => setSelectedAsset(symbol)}
                      style={{
                        padding: '12px',
                        borderRadius: '10px',
                        background: isSelected ? 'rgba(40, 160, 240, 0.15)' : 'rgba(255,255,255,0.03)',
                        border: isSelected ? '1px solid #28a0f0' : '1px solid var(--border-color)',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      <div style={{ fontWeight: '700', fontSize: '1.05rem' }}>{a.symbol}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>${(a.price * (simulatedPriceMultipliers[symbol] || 1)).toFixed(2)}</div>
                      <div style={{ fontSize: '0.72rem', color: a.dailyVol > 2.5 ? '#f87171' : '#34d399', marginTop: '4px' }}>
                        σ = {a.dailyVol}% / hr
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Term Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Pilih Jangka Waktu Fixed-Term</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                {[1, 7, 30].map(days => {
                  const isSelected = termDays === days;
                  return (
                    <div 
                      key={days}
                      onClick={() => setTermDays(days)}
                      style={{
                        padding: '12px',
                        borderRadius: '10px',
                        background: isSelected ? 'rgba(0, 200, 5, 0.15)' : 'rgba(255,255,255,0.03)',
                        border: isSelected ? '1px solid #00c805' : '1px solid var(--border-color)',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                    >
                      <div style={{ fontWeight: '700' }}>{repoRates[days].label}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Bunga: {repoRates[days].fixedYield}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Collateral Input */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span>Jumlah Agunan Disetor</span>
                <span>Saldo Anda: {userBalance[selectedAsset as keyof typeof userBalance]} {selectedAsset}</span>
              </div>
              <div style={{ position: 'relative' }}>
                <input 
                  type="number" 
                  value={collateralInput} 
                  onChange={e => setCollateralInput(e.target.value)}
                  className="input-field" 
                  placeholder="0.0"
                />
                <button 
                  onClick={() => setCollateralInput(userBalance[selectedAsset as keyof typeof userBalance].toString())}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#60baff',
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    cursor: 'pointer'
                  }}
                >
                  MAX
                </button>
              </div>
            </div>

            {/* Dynamic Max LTV Banner */}
            <div style={{ 
              background: 'rgba(40, 160, 240, 0.08)', 
              border: '1px solid rgba(40, 160, 240, 0.25)', 
              borderRadius: '12px', 
              padding: '16px', 
              marginBottom: '24px' 
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Cpu size={16} color="#28a0f0" /> Stylus Dynamic Max LTV
                </span>
                <span style={{ fontSize: '1.3rem', fontWeight: '800', color: dynamicMaxLtv > 70 ? '#00c805' : '#f59e0b' }}>
                  {dynamicMaxLtv}%
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Dihitung live via Rust Parametric VaR (Confidence 99%): Haircut {rawHaircut.toFixed(1)}% dikurangi dari nilai agunan. 
                {dynamicMaxLtv < 70 && ' Max LTV diturunkan otomatis untuk memitigasi gap risk volatilitas saham tinggi!'}
              </p>
            </div>

            {/* Summary details */}
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '14px', marginBottom: '24px', fontSize: '0.88rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Nilai Agunan:</span>
                <span style={{ fontWeight: '600' }}>${totalCollateralValueUSDC.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Pinjaman Cair (Pokok):</span>
                <span style={{ fontWeight: '700', color: '#00c805' }}>${maxBorrowUSDC.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Bunga Berjangka ({repoRates[termDays].fixedYield}):</span>
                <span>${fixedInterestUSDC.toFixed(2)} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Pelunasan saat Jatuh Tempo:</span>
                <span style={{ fontWeight: '700' }}>${(maxBorrowUSDC + fixedInterestUSDC).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
              </div>
            </div>

            <button onClick={handleOpenPosition} className="btn btn-primary" style={{ width: '100%', padding: '14px', fontSize: '1rem' }}>
              Kunci Agunan & Pinjam USDC Sekarang
            </button>
          </div>

          {/* Right Column: Comparison & Educational Deck */}
          <div>
            <div className="glass-panel" style={{ padding: '24px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Percent size={18} color="#28a0f0" /> Mengapa OrbitRepo Unggul atas Aave / Morpho?
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
                <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                  <div style={{ fontWeight: '700', color: '#fca5a5', marginBottom: '4px' }}>Protokol Lending Tradisional (Flat LTV)</div>
                  <p style={{ color: 'var(--text-muted)' }}>
                    Memberikan LTV 75% yang sama ke semua saham. Saat rilis laporan keuangan mendadak (earnings drop 20%), agunan langsung defisit bad-debt karena parameter risiko jarang di-update on-chain.
                  </p>
                </div>

                <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(0, 200, 5, 0.1)', border: '1px solid rgba(0, 200, 5, 0.2)' }}>
                  <div style={{ fontWeight: '700', color: '#86efac', marginBottom: '4px' }}>OrbitRepo (Stylus Dynamic VaR)</div>
                  <p style={{ color: 'var(--text-muted)' }}>
                    Menghitung batas aman per aset secara on-chain: Saham volatil seperti <strong>tAAPL 30 hari dibatasi ke 59.2%</strong>, sedangkan ETF stabil seperti <strong>tSPY mendapat 80.0%</strong>. Modal efisien dan protokol terhindar dari bad debt.
                  </p>
                </div>
              </div>
            </div>

            {/* Active Positions Summary */}
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '16px' }}>Posisi Repo Aktif Anda</h3>
              {positions.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem' }}>Belum ada posisi repo aktif.</p>
              ) : (
                positions.map(pos => {
                  const currentCollateralVal = pos.collateralAmt * effectivePrice;
                  const currentLtv = (pos.debt / currentCollateralVal) * 100;
                  const isLiquidatable = currentLtv > (pos.maxLtv + 5);

                  return (
                    <div key={pos.id} style={{ 
                      padding: '16px', 
                      borderRadius: '10px', 
                      background: 'rgba(255,255,255,0.03)', 
                      border: isLiquidatable ? '1px solid #ef4444' : '1px solid var(--border-color)',
                      marginBottom: '12px' 
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontWeight: '700' }}>#{pos.id} — {pos.collateralAmt} {pos.asset}</span>
                        <span className={isLiquidatable ? 'badge badge-danger' : 'badge badge-stylus'}>
                          {isLiquidatable ? 'CRITICAL / LIQUIDATABLE' : 'HEALTHY'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                        Utang: ${pos.debt.toLocaleString()} USDC | Max LTV: {pos.maxLtv}% | Current LTV: <strong>{currentLtv.toFixed(1)}%</strong>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => handleRepay(pos.id)} className="btn btn-secondary" style={{ flex: 1, padding: '8px', fontSize: '0.8rem' }}>
                          Tebus Agunan
                        </button>
                        {isLiquidatable && (
                          <button onClick={() => handleLiquidate(pos.id)} className="btn btn-danger" style={{ flex: 1, padding: '8px', fontSize: '0.8rem' }}>
                            Likuidasi Sekarang
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Liquidity Provider */}
      {activeTab === 'lend' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '24px' }}>
          <div className="glass-panel" style={{ padding: '28px' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '700', marginBottom: '14px' }}>Pasar Likuiditas Repo (LP Pool)</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '24px' }}>
              Setor stablecoin (USDC) untuk mendanai transaksi repo berjangka. Imbal hasil dikunci di muka dan lebih terprediksi (mirip surat utang jangka pendek TradFi) dibanding floating APY di DeFi lending terbuka.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
              <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Overnight Term APY</div>
                <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#00c805' }}>5.4% Est.</div>
              </div>
              <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>7-Day Term APY</div>
                <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#00c805' }}>7.8% Est.</div>
              </div>
              <div style={{ padding: '14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>30-Day Term APY</div>
                <div style={{ fontSize: '1.2rem', fontWeight: '800', color: '#00c805' }}>7.3% Est.</div>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Jumlah USDC Disetor</label>
              <input type="number" defaultValue="5000" className="input-field" placeholder="0.0" />
            </div>

            <button onClick={() => alert('Deposit LP berhasil! Anda mendapatkan 5,000 ORBIT-LP Shares.')} className="btn btn-green" style={{ width: '100%', padding: '14px', fontSize: '1rem' }}>
              Setor USDC ke Liquidity Pool
            </button>
          </div>

          <div className="glass-panel" style={{ padding: '28px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '16px' }}>Status Kepemilikan LP Anda</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.88rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>LP Shares Anda:</span>
                <span style={{ fontWeight: '700' }}>15,000.00 LP Shares</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Nilai Pokok Terkunci:</span>
                <span style={{ fontWeight: '700' }}>$15,000.00 USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '10px', borderBottom: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Akrual Imbal Hasil:</span>
                <span style={{ fontWeight: '700', color: '#00c805' }}>+$185.40 USDC</span>
              </div>
              <button onClick={() => alert('Penarikan sukses! $15,185.40 USDC telah dikirimkan ke wallet Anda.')} className="btn btn-secondary" style={{ marginTop: '10px' }}>
                Tarik Modal Pokok + Imbal Hasil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Live Demo Crisis Simulator */}
      {activeTab === 'demo' && (
        <div className="glass-panel" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ padding: '8px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.2)' }}>
              <AlertTriangle size={24} color="#ef4444" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.35rem', fontWeight: '800' }}>Live Crisis Simulator (Pitch Demo Mode)</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                Fitur khusus demonstrasi di depan juri: Simulasikan flash drop harga saham on-the-fly untuk menguji reaksi Risk Engine dan trigger likuidasi secara live.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '24px', marginTop: '24px' }}>
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: '700', marginBottom: '12px' }}>Pilih Skenario Pasar:</h4>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <button onClick={() => handleSimulateCrash(1.0)} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>
                  Pasar Normal (0%)
                </button>
                <button onClick={() => handleSimulateCrash(0.85)} className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>
                  Koreksi Ringan (-15%)
                </button>
                <button onClick={() => handleSimulateCrash(0.70)} className="btn btn-danger" style={{ fontSize: '0.85rem' }}>
                  Earnings Crash (-30%)
                </button>
                <button onClick={() => handleSimulateCrash(0.55)} className="btn btn-danger" style={{ fontSize: '0.85rem' }}>
                  Black Swan Drop (-45%)
                </button>
              </div>

              <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Aset Demo:</span>
                  <span style={{ fontWeight: '700' }}>{selectedAsset}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Harga Asli (Chainlink Feed):</span>
                  <span>${currentAsset.price.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Harga Simulasi Terkini:</span>
                  <span style={{ fontWeight: '700', color: effectivePrice < currentAsset.price ? '#ef4444' : '#f3f4f6' }}>
                    ${effectivePrice.toFixed(2)} ({((effectivePrice / currentAsset.price - 1) * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Position Impact Inspector */}
            <div>
              <h4 style={{ fontSize: '0.95rem', fontWeight: '700', marginBottom: '12px' }}>Dampak terhadap Posisi Repo:</h4>
              {positions.map(pos => {
                const currentCollateralVal = pos.collateralAmt * effectivePrice;
                const currentLtv = (pos.debt / currentCollateralVal) * 100;
                const isLiquidatable = currentLtv > (pos.maxLtv + 5);

                return (
                  <div key={pos.id} style={{ 
                    padding: '20px', 
                    borderRadius: '12px', 
                    background: isLiquidatable ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                    border: isLiquidatable ? '1px solid #ef4444' : '1px solid var(--border-color)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontWeight: '700' }}>Posisi #{pos.id} ({pos.collateralAmt} {pos.asset})</span>
                      <span className={isLiquidatable ? 'badge badge-danger' : 'badge badge-stylus'}>
                        {isLiquidatable ? 'STATUS: LIQUIDATABLE' : 'STATUS: AMAN'}
                      </span>
                    </div>

                    {/* Progress Health Meter */}
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                        <span>Rasio LTV Saat Ini: <strong>{currentLtv.toFixed(1)}%</strong></span>
                        <span>Batas Likuidasi: {(pos.maxLtv + 5).toFixed(1)}%</span>
                      </div>
                      <div style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', overflow: 'hidden' }}>
                        <div style={{ 
                          width: `${Math.min(100, currentLtv)}%`, 
                          height: '100%', 
                          background: isLiquidatable ? '#ef4444' : '#00c805',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                    </div>

                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                      {isLiquidatable 
                        ? 'Harga agunan anjlok di bawah batas margin pengaman! Posisi sekarang terbuka untuk dilikuidasi oleh siapa saja.' 
                        : 'Nilai agunan masih mencukupi untuk menjamin pokok dan bunga repo.'}
                    </p>

                    {isLiquidatable && (
                      <button onClick={() => handleLiquidate(pos.id)} className="btn btn-danger" style={{ width: '100%', padding: '12px' }}>
                        Eksekusi Likuidasi Permissionless ($217 Est. Keuntungan Keeper)
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ marginTop: '60px', paddingTop: '20px', borderTop: '1px solid var(--border-color)', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
        OrbitRepo — Arbitrum Open House Singapore Online Buildathon 2026. Built with Arbitrum Stylus (Rust WASM) & Solidity.
      </footer>
    </div>
  );
}
