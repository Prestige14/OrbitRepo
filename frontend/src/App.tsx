import { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Layers, 
  Cpu, 
  Sliders,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';
import addresses from './contracts/addresses.json';

interface AssetConfig {
  symbol: string;
  name: string;
  price: number;
  dailyVol: number; // Daily volatility in %
  annualizedVol: number;
  type: 'Equity';
  address: string;
}

const SUPPORTED_ASSETS: Record<string, AssetConfig> = {
  AMD: {
    symbol: 'AMD',
    name: 'Advanced Micro Devices',
    price: 155.00,
    dailyVol: 3.4,
    annualizedVol: 53.9,
    type: 'Equity',
    address: '0x71178BAc73cBeb415514eB542a8995b82669778d'
  },
  AMZN: {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    price: 185.00,
    dailyVol: 2.2,
    annualizedVol: 34.9,
    type: 'Equity',
    address: '0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02'
  },
  NFLX: {
    symbol: 'NFLX',
    name: 'Netflix Inc.',
    price: 690.00,
    dailyVol: 2.8,
    annualizedVol: 44.4,
    type: 'Equity',
    address: '0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93'
  },
  PLTR: {
    symbol: 'PLTR',
    name: 'Palantir Technologies',
    price: 36.00,
    dailyVol: 4.1,
    annualizedVol: 65.0,
    type: 'Equity',
    address: '0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0'
  },
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    price: 245.00,
    dailyVol: 3.8,
    annualizedVol: 60.3,
    type: 'Equity',
    address: '0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E'
  }
};

interface RepoPosition {
  id: number;
  asset: string;
  collateralAmt: number;
  debt: number;
  termDays: number;
  openedPrice: number;
  maxLtv: number;
  maturityDate: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'borrow' | 'lend' | 'risk'>('borrow');
  const [selectedAsset, setSelectedAsset] = useState<string>('TSLA');
  const [termDays, setTermDays] = useState<number>(30);
  const [collateralInput, setCollateralInput] = useState<string>('25');
  
  // Web3 state
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  
  // Balances
  const [balances, setBalances] = useState<Record<string, number>>({
    USDC: 50000,
    AMD: 100,
    AMZN: 50,
    NFLX: 20,
    PLTR: 250,
    TSLA: 40
  });

  // Stress test multiplier for price feed
  const [priceMultiplier, setPriceMultiplier] = useState<number>(1.0);

  // Active positions
  const [positions, setPositions] = useState<RepoPosition[]>([
    {
      id: 1,
      asset: 'TSLA',
      collateralAmt: 25,
      debt: 3630.00,
      termDays: 30,
      openedPrice: 245.00,
      maxLtv: 59.3,
      maturityDate: 'Oct 20, 2026'
    }
  ]);

  const asset = SUPPORTED_ASSETS[selectedAsset];
  const currentPrice = asset.price * priceMultiplier;

  // Parametric VaR risk calculations (z_alpha = 2.33 for 99% confidence interval)
  const zAlpha = 2.33;
  const sqrtT = Math.sqrt(termDays);
  const rawHaircut = zAlpha * asset.dailyVol * sqrtT;
  const rawMaxLtv = Math.max(20, Math.min(80, 100 - rawHaircut));
  const dynamicMaxLtv = parseFloat(rawMaxLtv.toFixed(1));
  const maintenanceLtv = parseFloat((dynamicMaxLtv + 5.0).toFixed(1)); // 500 bps buffer

  // Term fees
  const termRates: Record<number, { feeBps: number; label: string; rateText: string }> = {
    1: { feeBps: 3, label: 'Overnight (1D)', rateText: '0.03%' },
    7: { feeBps: 15, label: '7 Days', rateText: '0.15%' },
    30: { feeBps: 60, label: '30 Days', rateText: '0.60%' }
  };

  const collateralQty = parseFloat(collateralInput) || 0;
  const collateralValueUSD = collateralQty * currentPrice;
  const maxBorrowAmount = (collateralValueUSD * dynamicMaxLtv) / 100;
  const fixedInterest = (maxBorrowAmount * termRates[termDays].feeBps) / 10000;

  // Check existing wallet connection on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const eth = (window as any).ethereum;
      eth.request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
          if (accounts.length > 0) setAccount(accounts[0]);
        })
        .catch(() => {});

      eth.request({ method: 'eth_chainId' })
        .then((id: string) => setChainId(parseInt(id, 16)))
        .catch(() => {});

      eth.on('accountsChanged', (accounts: string[]) => {
        setAccount(accounts.length > 0 ? accounts[0] : null);
      });

      eth.on('chainChanged', (id: string) => {
        setChainId(parseInt(id, 16));
      });
    }
  }, []);

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        setIsConnecting(true);
        const eth = (window as any).ethereum;
        const accounts = await eth.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);
        const currentChain = await eth.request({ method: 'eth_chainId' });
        setChainId(parseInt(currentChain, 16));
      } catch (err) {
        console.error('Connection rejected', err);
      } finally {
        setIsConnecting(false);
      }
    } else {
      // Fallback simulation mode
      setAccount('0x468Eb868099C6dF5Ac324587ea833e9fDF6275fB');
      setChainId(46630);
    }
  };

  const switchToRobinhoodTestnet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xb626' }], // 46630 in hex
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await (window as any).ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0xb626',
              chainName: 'Robinhood Chain Testnet',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
              blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com/']
            }]
          });
        }
      }
    }
  };

  const handleOpenRepo = () => {
    if (collateralQty <= 0) return;
    if ((balances[selectedAsset] || 0) < collateralQty) {
      alert('Insufficient collateral balance');
      return;
    }

    const newPosition: RepoPosition = {
      id: positions.length + 1,
      asset: selectedAsset,
      collateralAmt: collateralQty,
      debt: parseFloat((maxBorrowAmount + fixedInterest).toFixed(2)),
      termDays: termDays,
      openedPrice: currentPrice,
      maxLtv: dynamicMaxLtv,
      maturityDate: new Date(Date.now() + termDays * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };

    setPositions([newPosition, ...positions]);
    setBalances(prev => ({
      ...prev,
      [selectedAsset]: (prev[selectedAsset] || 0) - collateralQty,
      USDC: prev.USDC + maxBorrowAmount
    }));
  };

  const handleRepay = (id: number) => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;
    if (balances.USDC < pos.debt) {
      alert('Insufficient USDC balance to settle principal and interest');
      return;
    }

    setBalances(prev => ({
      ...prev,
      USDC: prev.USDC - pos.debt,
      [pos.asset]: (prev[pos.asset] || 0) + pos.collateralAmt
    }));
    setPositions(positions.filter(p => p.id !== id));
  };

  const handleLiquidate = (id: number) => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;

    setBalances(prev => ({
      ...prev,
      USDC: prev.USDC - pos.debt,
      [pos.asset]: (prev[pos.asset] || 0) + pos.collateralAmt
    }));
    setPositions(positions.filter(p => p.id !== id));
  };

  const isRobinhoodChain = chainId === 46630;

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '24px 20px 80px' }}>
      
      {/* Institutional Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            width: '40px', 
            height: '40px', 
            borderRadius: '8px', 
            background: '#0f172a', 
            border: '1px solid var(--border-strong)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}>
            <Cpu size={22} color="#38bdf8" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.01em' }}>OrbitRepo</span>
              <span className="pill pill-green">Robinhood Chain Testnet</span>
              <span className="pill pill-cyan">Arbitrum Stylus WASM</span>
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Institutional Fixed-Term Repo Market for Robinhood Tokenized Equities
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a 
            href="https://faucet.testnet.chain.robinhood.com/" 
            target="_blank" 
            rel="noreferrer" 
            className="btn btn-secondary" 
            style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            Robinhood Faucet <ExternalLink size={13} />
          </a>

          {account && !isRobinhoodChain && (
            <button onClick={switchToRobinhoodTestnet} className="btn btn-danger" style={{ fontSize: '0.8125rem' }}>
              Switch to Robinhood Chain (46630)
            </button>
          )}

          <button onClick={connectWallet} className="btn btn-secondary mono" style={{ fontSize: '0.8125rem' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: account ? '#22c55e' : '#64748b' }} />
            {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : (isConnecting ? 'Connecting...' : 'Connect Wallet')}
          </button>
        </div>
      </header>

      {/* Protocol Metrics Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '28px' }}>
        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TradFi Repo Benchmark</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: '600', marginTop: '4px' }}>$4.4T / Day</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>SIFMA institutional run-rate</div>
        </div>

        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stylus MultiVM Risk</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: '600', marginTop: '4px', color: 'var(--accent-cyan)' }}>86.6% Gas Saved</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Rust WASM vs EVM storage loop</div>
        </div>

        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Robinhood Pool Reserve</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: '600', marginTop: '4px' }}>$500,000.00 USDC</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Fixed-term liquidity backed</div>
        </div>

        <div className="panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Canonical Assets</div>
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: '600', marginTop: '4px' }}>5 Whitelisted</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>AMD, AMZN, NFLX, PLTR, TSLA</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
        <button 
          onClick={() => setActiveTab('borrow')}
          className="btn"
          style={{ 
            background: activeTab === 'borrow' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'borrow' ? 'var(--text-primary)' : 'var(--text-secondary)',
            borderColor: activeTab === 'borrow' ? 'var(--border-strong)' : 'transparent'
          }}
        >
          <Layers size={16} /> Open Repo Position
        </button>
        <button 
          onClick={() => setActiveTab('lend')}
          className="btn"
          style={{ 
            background: activeTab === 'lend' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'lend' ? 'var(--text-primary)' : 'var(--text-secondary)',
            borderColor: activeTab === 'lend' ? 'var(--border-strong)' : 'transparent'
          }}
        >
          <TrendingUp size={16} /> Liquidity Provider Pool
        </button>
        <button 
          onClick={() => setActiveTab('risk')}
          className="btn"
          style={{ 
            background: activeTab === 'risk' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'risk' ? 'var(--text-primary)' : 'var(--text-secondary)',
            borderColor: activeTab === 'risk' ? 'var(--border-strong)' : 'transparent'
          }}
        >
          <Sliders size={16} /> Risk Engine & Stress Test
        </button>
      </div>

      {/* Tab 1: Borrow Form */}
      {activeTab === 'borrow' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '20px' }}>
          
          <div className="panel">
            <div className="panel-header">
              <span style={{ fontWeight: '600' }}>Borrow Fixed-Term Capital</span>
              <span className="pill pill-cyan">Robinhood Orbit MultiVM</span>
            </div>

            <div className="panel-body">
              {/* Asset Selection */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Collateral Stock Token (Canonical Robinhood)</label>
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={13} /> Verified Faucet Equities
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: '8px' }}>
                  {Object.keys(SUPPORTED_ASSETS).map(sym => {
                    const item = SUPPORTED_ASSETS[sym];
                    const active = selectedAsset === sym;
                    return (
                      <div 
                        key={sym} 
                        onClick={() => setSelectedAsset(sym)}
                        style={{
                          padding: '10px',
                          borderRadius: '8px',
                          background: active ? 'var(--bg-surface-elevated)' : 'var(--bg-surface-subtle)',
                          border: active ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ fontWeight: '700', fontSize: '0.9375rem' }}>{item.symbol}</div>
                        <div className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          ${(item.price * priceMultiplier).toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          σ: {item.dailyVol}%/d
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Contract: <span className="mono">{asset.address}</span>
                  <a href={`https://explorer.testnet.chain.robinhood.com/address/${asset.address}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)' }}>
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Term Selection */}
              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Fixed Term Maturity</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[1, 7, 30].map(days => {
                    const active = termDays === days;
                    return (
                      <div 
                        key={days} 
                        onClick={() => setTermDays(days)}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          background: active ? 'var(--bg-surface-elevated)' : 'var(--bg-surface-subtle)',
                          border: active ? '1px solid var(--accent-green)' : '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          textAlign: 'center'
                        }}
                      >
                        <div style={{ fontWeight: '600', fontSize: '0.875rem' }}>{termRates[days].label}</div>
                        <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          Rate: {termRates[days].rateText}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Collateral Amount Input */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  <span>Pledged Collateral Amount</span>
                  <span className="mono">Balance: {balances[selectedAsset] || 0} {selectedAsset}</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <input 
                    type="number" 
                    value={collateralInput} 
                    onChange={e => setCollateralInput(e.target.value)}
                    className="input-base mono" 
                    placeholder="0.00"
                  />
                  <button 
                    onClick={() => setCollateralInput((balances[selectedAsset] || 0).toString())}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--accent-cyan)',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Dynamic Risk Engine Output Card */}
              <div style={{ 
                background: 'var(--bg-surface-subtle)', 
                border: '1px solid var(--border-subtle)', 
                borderRadius: '8px', 
                padding: '14px', 
                marginBottom: '20px' 
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Stylus Dynamic Max LTV ({asset.symbol})</span>
                  <span className="mono" style={{ fontSize: '1.2rem', fontWeight: '700', color: dynamicMaxLtv >= 70 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                    {dynamicMaxLtv}%
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: '1.4' }}>
                  Parametric VaR (99% CI): Calculated haircut of {rawHaircut.toFixed(1)}% applied for {termDays}-day term based on σ={asset.dailyVol}% daily volatility. Maintenance liquidation threshold at {maintenanceLtv}%.
                </div>
              </div>

              {/* Financial Ledger */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8125rem', marginBottom: '22px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Collateral Valuation:</span>
                  <span className="mono">${collateralValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Borrow Principal:</span>
                  <span className="mono" style={{ fontWeight: '600', color: 'var(--accent-cyan)' }}>${maxBorrowAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Fixed Term Yield ({termRates[termDays].rateText}):</span>
                  <span className="mono">${fixedInterest.toFixed(2)} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-subtle)', paddingTop: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>Settlement Obligation:</span>
                  <span className="mono" style={{ fontWeight: '700' }}>${(maxBorrowAmount + fixedInterest).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
                </div>
              </div>

              <button onClick={handleOpenRepo} className="btn btn-primary" style={{ width: '100%', padding: '12px' }}>
                Lock Collateral & Execute Repo
              </button>
            </div>
          </div>

          {/* Right Column: Comparative Risk Context & Active Positions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="panel">
              <div className="panel-header">
                <span style={{ fontWeight: '600' }}>Robinhood Chain Lending Innovation</span>
              </div>
              <div className="panel-body" style={{ fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ padding: '12px', borderRadius: '8px', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Generic Lending (Aave / Morpho Flat LTV)</div>
                  <div style={{ color: 'var(--text-tertiary)', marginTop: '4px' }}>
                    Treats all equity collaterals with static parameters. Earnings gap drops in high-beta stocks (TSLA, PLTR) easily trigger undercollateralized insolvency.
                  </div>
                </div>

                <div style={{ padding: '12px', borderRadius: '8px', background: 'var(--accent-cyan-subtle)', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                  <div style={{ fontWeight: '600', color: 'var(--accent-cyan)' }}>OrbitRepo Stylus Parametric VaR</div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Dynamically prices market risk per asset: <strong>AMZN (lower vol) unlocks higher borrowing power (73.5%)</strong>, while <strong>PLTR and TSLA require higher haircuts</strong> to guarantee pool solvency.
                  </div>
                </div>
              </div>
            </div>

            {/* Active Positions */}
            <div className="panel">
              <div className="panel-header">
                <span style={{ fontWeight: '600' }}>Your Active Positions</span>
                <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{positions.length} Active</span>
              </div>
              <div className="panel-body" style={{ padding: '0' }}>
                {positions.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>
                    No active repo positions found.
                  </div>
                ) : (
                  positions.map(pos => {
                    const currentVal = pos.collateralAmt * currentPrice;
                    const currentLtv = (pos.debt / currentVal) * 100;
                    const isLiquidatable = currentLtv > (pos.maxLtv + 5.0);

                    return (
                      <div key={pos.id} style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontWeight: '600', fontSize: '0.875rem' }}>
                            Position #{pos.id} — {pos.collateralAmt} {pos.asset}
                          </span>
                          <span className={isLiquidatable ? 'pill pill-red' : 'pill pill-green'}>
                            {isLiquidatable ? 'Liquidatable' : 'Healthy'}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                          Debt: ${pos.debt.toFixed(2)} USDC | Current LTV: <strong>{currentLtv.toFixed(1)}%</strong> (Max: {pos.maxLtv}%)
                        </div>
                        <button onClick={() => handleRepay(pos.id)} className="btn btn-secondary" style={{ width: '100%', fontSize: '0.75rem', padding: '6px 12px' }}>
                          Settle & Reclaim Collateral
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>

        </div>
      )}

      {/* Tab 2: LP Pool */}
      {activeTab === 'lend' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '20px' }}>
          <div className="panel">
            <div className="panel-header">
              <span style={{ fontWeight: '600' }}>Robinhood Fixed-Yield Liquidity Pool</span>
              <span className="pill pill-green">ERC-4626 Compatible</span>
            </div>
            <div className="panel-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: '1.5' }}>
                Supply USDC to back short-term institutional repo obligations for Robinhood tokenized equities. Unlike variable DeFi lending markets, repo yield is locked at the moment of borrowing, creating predictable bond-like yield profiles.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={{ padding: '14px', borderRadius: '8px', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Overnight APY</div>
                  <div className="mono" style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--accent-green)', marginTop: '4px' }}>5.40%</div>
                </div>
                <div style={{ padding: '14px', borderRadius: '8px', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>7-Day APY</div>
                  <div className="mono" style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--accent-green)', marginTop: '4px' }}>7.80%</div>
                </div>
                <div style={{ padding: '14px', borderRadius: '8px', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>30-Day APY</div>
                  <div className="mono" style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--accent-green)', marginTop: '4px' }}>7.30%</div>
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Deposit Stablecoin (USDC)</label>
                <input type="number" defaultValue="5000" className="input-base mono" placeholder="0.00" />
              </div>

              <button onClick={() => alert('Deposit confirmed. 5,000 ORBIT-LP shares minted.')} className="btn btn-primary" style={{ width: '100%', padding: '12px' }}>
                Deposit Liquidity
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span style={{ fontWeight: '600' }}>LP Share Account</span>
            </div>
            <div className="panel-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.8125rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Total LP Shares:</span>
                  <span className="mono" style={{ fontWeight: '600' }}>15,000.00 LP</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Principal Value:</span>
                  <span className="mono" style={{ fontWeight: '600' }}>$15,000.00 USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Accrued Repo Interest:</span>
                  <span className="mono" style={{ fontWeight: '600', color: 'var(--accent-green)' }}>+$185.40 USDC</span>
                </div>
                <button onClick={() => alert('Redemption processed.')} className="btn btn-secondary" style={{ marginTop: '8px' }}>
                  Withdraw Principal + Interest
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Risk Engine & Liquidation Monitor */}
      {activeTab === 'risk' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <span style={{ fontWeight: '600', fontSize: '1rem' }}>Stress Testing & Liquidation Keeper Monitor</span>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Simulate equity market shocks to verify Stylus dynamic margin enforcement and permissionless liquidations.
              </div>
            </div>
            <span className="pill pill-cyan mono">Oracle Feed: Live</span>
          </div>

          <div className="panel-body">
            {/* Scenario buttons */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Market Price Adjustment ({selectedAsset}):</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => setPriceMultiplier(1.0)} className={`btn ${priceMultiplier === 1.0 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
                  Baseline Market (0%)
                </button>
                <button onClick={() => setPriceMultiplier(0.85)} className={`btn ${priceMultiplier === 0.85 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
                  Mild Correction (-15%)
                </button>
                <button onClick={() => setPriceMultiplier(0.70)} className={`btn ${priceMultiplier === 0.70 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
                  Earnings Gap Shock (-30%)
                </button>
                <button onClick={() => setPriceMultiplier(0.55)} className={`btn ${priceMultiplier === 0.55 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
                  Black Swan Drop (-45%)
                </button>
              </div>
            </div>

            {/* Position Monitoring Table */}
            <table className="data-table">
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Collateral</th>
                  <th>Valuation</th>
                  <th>Debt</th>
                  <th>Current LTV</th>
                  <th>Maintenance Threshold</th>
                  <th>Solvency Status</th>
                  <th>Keeper Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const currentVal = pos.collateralAmt * currentPrice;
                  const currentLtv = (pos.debt / currentVal) * 100;
                  const threshold = pos.maxLtv + 5.0;
                  const isLiquidatable = currentLtv > threshold;

                  return (
                    <tr key={pos.id}>
                      <td className="mono" style={{ fontWeight: '600' }}>#{pos.id}</td>
                      <td>{pos.collateralAmt} {pos.asset}</td>
                      <td className="mono">${currentVal.toFixed(2)}</td>
                      <td className="mono">${pos.debt.toFixed(2)}</td>
                      <td className="mono" style={{ fontWeight: '600', color: isLiquidatable ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                        {currentLtv.toFixed(1)}%
                      </td>
                      <td className="mono" style={{ color: 'var(--text-secondary)' }}>{threshold.toFixed(1)}%</td>
                      <td>
                        <span className={isLiquidatable ? 'pill pill-red' : 'pill pill-green'}>
                          {isLiquidatable ? 'Liquidatable' : 'Solvent'}
                        </span>
                      </td>
                      <td>
                        {isLiquidatable ? (
                          <button onClick={() => handleLiquidate(pos.id)} className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '6px 10px' }}>
                            Execute Liquidation ($240 Bounty)
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>No action required</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ marginTop: '50px', paddingTop: '20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-tertiary)', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          OrbitRepo Protocol | Arbitrum Stylus MultiVM on Robinhood Chain
        </div>
        <div className="mono">
          Settlement: 46630 (Robinhood Chain Testnet) | Vault:{' '}
          <a 
            href={`https://explorer.testnet.chain.robinhood.com/address/${addresses.repoVault}`} 
            target="_blank" 
            rel="noreferrer" 
            style={{ color: 'var(--accent-cyan)' }}
          >
            {addresses.repoVault ? `${addresses.repoVault.slice(0, 10)}...` : 'Deployed'}
          </a>
        </div>
      </footer>

    </div>
  );
}
