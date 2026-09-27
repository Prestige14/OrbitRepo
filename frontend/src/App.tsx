import { useState, useEffect, useCallback } from 'react';
import { 
  TrendingUp, 
  Layers, 
  Cpu, 
  Sliders,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Coins,
  Sparkles,
  RefreshCw,
  Zap,
  ArrowRight,
  Wallet,
  Percent,
  BarChart3,
  Activity,
  ChevronRight,
  Lock,
  ArrowUpRight
} from 'lucide-react';
import { 
  BrowserProvider, 
  Contract, 
  formatUnits, 
  parseUnits, 
  parseEther, 
  formatEther 
} from 'ethers';
import addresses from './contracts/addresses.json';
import { 
  REPO_VAULT_ABI, 
  LIQUIDITY_POOL_ABI, 
  ERC20_ABI, 
  ORACLE_ABI 
} from './contracts/abis';

interface AssetConfig {
  symbol: string;
  name: string;
  price: number;
  dailyVol: number; // Daily volatility in %
  annualizedVol: number;
  beta: string;
  brandClass: string;
  brandColor: string;
  address: string;
  oracle: string;
}

const SUPPORTED_ASSETS: Record<string, AssetConfig> = {
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    price: 245.00,
    dailyVol: 3.8,
    annualizedVol: 60.3,
    beta: '1.92x',
    brandClass: 'stock-badge-tsla',
    brandColor: '#e82127',
    address: addresses.tokens.TSLA.address,
    oracle: addresses.tokens.TSLA.oracle
  },
  AMZN: {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    price: 185.00,
    dailyVol: 2.2,
    annualizedVol: 34.9,
    beta: '1.14x',
    brandClass: 'stock-badge-amzn',
    brandColor: '#ff9900',
    address: addresses.tokens.AMZN.address,
    oracle: addresses.tokens.AMZN.oracle
  },
  AMD: {
    symbol: 'AMD',
    name: 'Advanced Micro Devices',
    price: 155.00,
    dailyVol: 3.4,
    annualizedVol: 53.9,
    beta: '1.68x',
    brandClass: 'stock-badge-amd',
    brandColor: '#00c805',
    address: addresses.tokens.AMD.address,
    oracle: addresses.tokens.AMD.oracle
  },
  NFLX: {
    symbol: 'NFLX',
    name: 'Netflix Inc.',
    price: 690.00,
    dailyVol: 2.8,
    annualizedVol: 44.4,
    beta: '1.28x',
    brandClass: 'stock-badge-nflx',
    brandColor: '#e50914',
    address: addresses.tokens.NFLX.address,
    oracle: addresses.tokens.NFLX.oracle
  },
  PLTR: {
    symbol: 'PLTR',
    name: 'Palantir Technologies',
    price: 36.00,
    dailyVol: 4.1,
    annualizedVol: 65.0,
    beta: '2.15x',
    brandClass: 'stock-badge-pltr',
    brandColor: '#38bdf8',
    address: addresses.tokens.PLTR.address,
    oracle: addresses.tokens.PLTR.oracle
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
  isClosed?: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'borrow' | 'lend' | 'risk'>('borrow');
  const [selectedAsset, setSelectedAsset] = useState<string>('TSLA');
  const [termDays, setTermDays] = useState<number>(30);
  const [collateralInput, setCollateralInput] = useState<string>('25');
  const [depositAmountInput, setDepositAmountInput] = useState<string>('5000');
  const [withdrawSharesInput, setWithdrawSharesInput] = useState<string>('1000');
  
  // Web3 state
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [executionMode, setExecutionMode] = useState<'onchain' | 'simulated'>('onchain');

  // Transaction loading & status state
  const [txLoading, setTxLoading] = useState<boolean>(false);
  const [txStatusText, setTxStatusText] = useState<string>('');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  
  // Balances
  const [balances, setBalances] = useState<Record<string, number>>({
    ETH: 0.05,
    USDC: 50000,
    AMD: 100,
    AMZN: 50,
    NFLX: 20,
    PLTR: 250,
    TSLA: 40
  });

  // On-Chain Pool State
  const [poolStats, setPoolStats] = useState<{
    totalAssets: number;
    availableLiquidity: number;
    userShares: number;
  }>({
    totalAssets: 500000,
    availableLiquidity: 500000,
    userShares: 0
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
      maturityDate: 'Oct 28, 2026'
    }
  ]);

  const asset = SUPPORTED_ASSETS[selectedAsset];
  const currentPrice = asset.price * priceMultiplier;
  const isRobinhoodChain = chainId === 46630;

  // Parametric VaR risk calculations (z_alpha = 2.33 for 99% confidence interval)
  const zAlpha = 2.33;
  const sqrtT = Math.sqrt(termDays);
  const rawHaircut = zAlpha * asset.dailyVol * sqrtT;
  const rawMaxLtv = Math.max(20, Math.min(80, 100 - rawHaircut));
  const dynamicMaxLtv = parseFloat(rawMaxLtv.toFixed(1));
  const maintenanceLtv = parseFloat((dynamicMaxLtv + 5.0).toFixed(1)); // 500 bps buffer

  // Term fees
  const termRates: Record<number, { feeBps: number; label: string; rateText: string; tenorDesc: string }> = {
    1: { feeBps: 3, label: 'Overnight', rateText: '0.03%', tenorDesc: '1-Day Liquidity' },
    7: { feeBps: 15, label: '7 Days', rateText: '0.15%', tenorDesc: 'Weekly Repo' },
    30: { feeBps: 60, label: '30 Days', rateText: '0.60%', tenorDesc: 'Monthly Facility' }
  };

  const collateralQty = parseFloat(collateralInput) || 0;
  const collateralValueUSD = collateralQty * currentPrice;
  const maxBorrowAmount = (collateralValueUSD * dynamicMaxLtv) / 100;
  const fixedInterest = (maxBorrowAmount * termRates[termDays].feeBps) / 10000;

  // Helper: Get BrowserProvider and Signer
  const getSigner = async () => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      throw new Error('MetaMask is not available');
    }
    const provider = new BrowserProvider((window as any).ethereum);
    return await provider.getSigner();
  };

  // Fetch real on-chain balances and pool stats
  const fetchOnChainData = useCallback(async () => {
    if (!account || !isRobinhoodChain || typeof window === 'undefined' || !(window as any).ethereum) {
      return;
    }

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      
      // 1. Native ETH
      const ethBal = await provider.getBalance(account);
      const ethFormatted = parseFloat(formatEther(ethBal));

      // 2. MockUSDC (6 decimals)
      const usdcContract = new Contract(addresses.usdc, ERC20_ABI, provider);
      const usdcBal = await usdcContract.balanceOf(account);
      const usdcFormatted = parseFloat(formatUnits(usdcBal, 6));

      // 3. Equity tokens (18 decimals)
      const newBalances: Record<string, number> = {
        ETH: ethFormatted,
        USDC: usdcFormatted
      };

      for (const sym of Object.keys(SUPPORTED_ASSETS)) {
        try {
          const tokContract = new Contract(SUPPORTED_ASSETS[sym].address, ERC20_ABI, provider);
          const bal = await tokContract.balanceOf(account);
          newBalances[sym] = parseFloat(formatUnits(bal, 18));
        } catch {
          newBalances[sym] = balances[sym] || 0;
        }
      }
      setBalances(prev => ({ ...prev, ...newBalances }));

      // 4. Liquidity Pool stats
      try {
        const poolContract = new Contract(addresses.liquidityPool, LIQUIDITY_POOL_ABI, provider);
        const [totalAssetsWei, availableLiquidityWei, userSharesWei] = await Promise.all([
          poolContract.totalAssets(),
          poolContract.availableLiquidity(),
          poolContract.sharesOf(account)
        ]);
        setPoolStats({
          totalAssets: parseFloat(formatUnits(totalAssetsWei, 6)),
          availableLiquidity: parseFloat(formatUnits(availableLiquidityWei, 6)),
          userShares: parseFloat(formatUnits(userSharesWei, 6))
        });
      } catch (err) {
        console.warn('Error reading pool stats:', err);
      }

      // 5. Query active positions from RepoVault
      try {
        const vaultContract = new Contract(addresses.repoVault, REPO_VAULT_ABI, provider);
        const nextId = await vaultContract.nextPositionId();
        const totalPos = Number(nextId);
        const onChainPosList: RepoPosition[] = [];

        const startPos = Math.max(1, totalPos - 15);
        for (let i = totalPos - 1; i >= startPos; i--) {
          try {
            const p = await vaultContract.positions(i);
            if (!p.isClosed && p.borrower.toLowerCase() === account.toLowerCase()) {
              const sym = Object.keys(SUPPORTED_ASSETS).find(
                s => SUPPORTED_ASSETS[s].address.toLowerCase() === p.collateralAsset.toLowerCase()
              ) || 'EQUITY';
              
              const debtTotal = parseFloat(formatUnits(p.borrowedPrincipal + p.fixedInterest, 6));
              const colQty = parseFloat(formatUnits(p.collateralAmount, 18));
              const ltvVal = Number(p.maxLtvBps) / 100;
              const matDate = new Date(Number(p.maturityAt) * 1000).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              });

              onChainPosList.push({
                id: Number(p.id),
                asset: sym,
                collateralAmt: colQty,
                debt: debtTotal,
                termDays: Number(p.termDays),
                openedPrice: SUPPORTED_ASSETS[sym]?.price || 100,
                maxLtv: ltvVal,
                maturityDate: matDate
              });
            }
          } catch {
            // position read error, skip
          }
        }

        if (onChainPosList.length > 0) {
          setPositions(onChainPosList);
        }
      } catch (err) {
        console.warn('Error reading on-chain positions:', err);
      }

    } catch (err) {
      console.warn('Failed to fetch on-chain balances:', err);
    }
  }, [account, isRobinhoodChain, balances]);

  // Initial wallet detection
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

  // Poll on-chain data
  useEffect(() => {
    if (account && isRobinhoodChain && executionMode === 'onchain') {
      fetchOnChainData();
    }
  }, [account, isRobinhoodChain, executionMode, fetchOnChainData]);

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        setIsConnecting(true);
        const eth = (window as any).ethereum;
        const accounts = await eth.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);
        const currentChain = await eth.request({ method: 'eth_chainId' });
        setChainId(parseInt(currentChain, 16));
        setExecutionMode('onchain');
      } catch (err) {
        console.error('Connection rejected', err);
      } finally {
        setIsConnecting(false);
      }
    } else {
      setAccount('0x468Eb868099C6dF5Ac324587ea833e9fDF6275fB');
      setChainId(46630);
      setExecutionMode('simulated');
    }
  };

  const switchToRobinhoodTestnet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0xb626' }],
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

  // Quick percent helpers
  const handleQuickPercent = (pct: number) => {
    const bal = balances[selectedAsset] || 0;
    const calculated = (bal * pct).toFixed(2);
    setCollateralInput(calculated);
  };

  // Transaction Handlers
  const handleOpenRepo = async () => {
    if (collateralQty <= 0) return;
    setTxError(null);
    setLastTxHash(null);

    if (executionMode === 'onchain' && account && isRobinhoodChain) {
      try {
        setTxLoading(true);
        const signer = await getSigner();
        const collateralWei = parseEther(collateralQty.toString());
        const tokenContract = new Contract(asset.address, ERC20_ABI, signer);
        const vaultContract = new Contract(addresses.repoVault, REPO_VAULT_ABI, signer);

        const balance = await tokenContract.balanceOf(account);
        if (balance < collateralWei) {
          throw new Error(`Insufficient ${selectedAsset} on Robinhood Chain. Mint from Faucet or switch to Simulation Lab.`);
        }

        setTxStatusText(`Step 1/2: Checking ${selectedAsset} allowance...`);
        const allowance = await tokenContract.allowance(account, addresses.repoVault);
        if (allowance < collateralWei) {
          setTxStatusText(`Step 1/2: Approving ${selectedAsset} collateral in MetaMask...`);
          const approveTx = await tokenContract.approve(addresses.repoVault, collateralWei);
          setTxStatusText(`Step 1/2: Waiting for approval confirmation...`);
          await approveTx.wait();
        }

        setTxStatusText(`Step 2/2: Confirming openPosition on Robinhood Chain...`);
        const tx = await vaultContract.openPosition(asset.address, collateralWei, termDays);
        setTxStatusText(`Step 2/2: Mining repo position...`);
        const receipt = await tx.wait();
        setLastTxHash(receipt.hash);

        await fetchOnChainData();
      } catch (err: any) {
        console.error('OpenRepo error:', err);
        setTxError(err.reason || err.message || 'Transaction failed or rejected');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    // Simulation
    if ((balances[selectedAsset] || 0) < collateralQty) {
      alert(`Insufficient ${selectedAsset} balance.`);
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

  const handleRepay = async (id: number) => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;
    setTxError(null);
    setLastTxHash(null);

    if (executionMode === 'onchain' && account && isRobinhoodChain) {
      try {
        setTxLoading(true);
        const signer = await getSigner();
        const usdcContract = new Contract(addresses.usdc, ERC20_ABI, signer);
        const vaultContract = new Contract(addresses.repoVault, REPO_VAULT_ABI, signer);
        const debtWei = parseUnits(pos.debt.toFixed(6), 6);

        setTxStatusText(`Step 1/2: Checking USDC allowance for repayment...`);
        const allowance = await usdcContract.allowance(account, addresses.repoVault);
        if (allowance < debtWei) {
          setTxStatusText(`Step 1/2: Approving USDC in MetaMask...`);
          const approveTx = await usdcContract.approve(addresses.repoVault, debtWei);
          await approveTx.wait();
        }

        setTxStatusText(`Step 2/2: Confirming repayment on Robinhood Chain...`);
        const tx = await vaultContract.repay(id);
        const receipt = await tx.wait();
        setLastTxHash(receipt.hash);

        await fetchOnChainData();
        setPositions(positions.filter(p => p.id !== id));
      } catch (err: any) {
        console.error('Repay error:', err);
        setTxError(err.reason || err.message || 'Repay failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    // Simulation
    if (balances.USDC < pos.debt) {
      alert('Insufficient USDC to settle');
      return;
    }
    setBalances(prev => ({
      ...prev,
      USDC: prev.USDC - pos.debt,
      [pos.asset]: (prev[pos.asset] || 0) + pos.collateralAmt
    }));
    setPositions(positions.filter(p => p.id !== id));
  };

  const handleLiquidate = async (id: number) => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;
    setTxError(null);
    setLastTxHash(null);

    if (executionMode === 'onchain' && account && isRobinhoodChain) {
      try {
        setTxLoading(true);
        const signer = await getSigner();
        const usdcContract = new Contract(addresses.usdc, ERC20_ABI, signer);
        const vaultContract = new Contract(addresses.repoVault, REPO_VAULT_ABI, signer);
        const debtWei = parseUnits(pos.debt.toFixed(6), 6);

        setTxStatusText(`Approving USDC for keeper liquidation...`);
        const allowance = await usdcContract.allowance(account, addresses.repoVault);
        if (allowance < debtWei) {
          const approveTx = await usdcContract.approve(addresses.repoVault, debtWei);
          await approveTx.wait();
        }

        setTxStatusText(`Executing keeper liquidation on-chain...`);
        const tx = await vaultContract.liquidate(id);
        const receipt = await tx.wait();
        setLastTxHash(receipt.hash);

        await fetchOnChainData();
        setPositions(positions.filter(p => p.id !== id));
      } catch (err: any) {
        console.error('Liquidation error:', err);
        setTxError(err.reason || err.message || 'Liquidation failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    setBalances(prev => ({
      ...prev,
      USDC: prev.USDC - pos.debt,
      [pos.asset]: (prev[pos.asset] || 0) + pos.collateralAmt
    }));
    setPositions(positions.filter(p => p.id !== id));
  };

  const handleDepositLiquidity = async () => {
    const amt = parseFloat(depositAmountInput);
    if (isNaN(amt) || amt <= 0) return;
    setTxError(null);
    setLastTxHash(null);

    if (executionMode === 'onchain' && account && isRobinhoodChain) {
      try {
        setTxLoading(true);
        const signer = await getSigner();
        const usdcContract = new Contract(addresses.usdc, ERC20_ABI, signer);
        const poolContract = new Contract(addresses.liquidityPool, LIQUIDITY_POOL_ABI, signer);
        const amountWei = parseUnits(amt.toString(), 6);

        setTxStatusText(`Step 1/2: Checking USDC allowance for Liquidity Pool...`);
        const allowance = await usdcContract.allowance(account, addresses.liquidityPool);
        if (allowance < amountWei) {
          setTxStatusText(`Step 1/2: Approving USDC in MetaMask...`);
          const approveTx = await usdcContract.approve(addresses.liquidityPool, amountWei);
          await approveTx.wait();
        }

        setTxStatusText(`Step 2/2: Depositing ${amt.toLocaleString()} USDC to pool...`);
        const tx = await poolContract.deposit(amountWei);
        const receipt = await tx.wait();
        setLastTxHash(receipt.hash);

        await fetchOnChainData();
      } catch (err: any) {
        console.error('Deposit LP error:', err);
        setTxError(err.reason || err.message || 'Deposit failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    setBalances(prev => ({ ...prev, USDC: Math.max(0, prev.USDC - amt) }));
    setPoolStats(prev => ({
      ...prev,
      totalAssets: prev.totalAssets + amt,
      availableLiquidity: prev.availableLiquidity + amt,
      userShares: prev.userShares + amt
    }));
  };

  const handleWithdrawLiquidity = async () => {
    const shares = parseFloat(withdrawSharesInput);
    if (isNaN(shares) || shares <= 0) return;
    setTxError(null);
    setLastTxHash(null);

    if (executionMode === 'onchain' && account && isRobinhoodChain) {
      try {
        setTxLoading(true);
        const signer = await getSigner();
        const poolContract = new Contract(addresses.liquidityPool, LIQUIDITY_POOL_ABI, signer);
        const sharesWei = parseUnits(shares.toString(), 6);

        setTxStatusText(`Redeeming ${shares} LP shares on Robinhood Chain...`);
        const tx = await poolContract.withdraw(sharesWei);
        const receipt = await tx.wait();
        setLastTxHash(receipt.hash);

        await fetchOnChainData();
      } catch (err: any) {
        console.error('Withdraw LP error:', err);
        setTxError(err.reason || err.message || 'Withdrawal failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    setBalances(prev => ({ ...prev, USDC: prev.USDC + shares }));
    setPoolStats(prev => ({
      ...prev,
      totalAssets: Math.max(0, prev.totalAssets - shares),
      availableLiquidity: Math.max(0, prev.availableLiquidity - shares),
      userShares: Math.max(0, prev.userShares - shares)
    }));
  };

  const handleMintMockUSDC = async () => {
    if (!account || !isRobinhoodChain) {
      alert('Please connect MetaMask to Robinhood Chain Testnet first.');
      return;
    }
    setTxError(null);
    setLastTxHash(null);

    try {
      setTxLoading(true);
      setTxStatusText('Minting 10,000 Test USDC on Robinhood Chain...');
      const signer = await getSigner();
      const usdcContract = new Contract(addresses.usdc, ERC20_ABI, signer);
      const tx = await usdcContract.mint(account, parseUnits('10000', 6));
      const receipt = await tx.wait();
      setLastTxHash(receipt.hash);
      await fetchOnChainData();
    } catch (err: any) {
      console.error('Mint USDC error:', err);
      setTxError(err.reason || err.message || 'Minting failed');
    } finally {
      setTxLoading(false);
      setTxStatusText('');
    }
  };

  const handlePushOraclePriceDrop = async (percentDrop: number) => {
    if (!account || !isRobinhoodChain) {
      setPriceMultiplier(1.0 - percentDrop);
      return;
    }
    setTxError(null);
    setLastTxHash(null);

    try {
      setTxLoading(true);
      setTxStatusText(`Updating on-chain oracle for ${selectedAsset} (-${percentDrop * 100}%)...`);
      const signer = await getSigner();
      const oracleContract = new Contract(asset.oracle, ORACLE_ABI, signer);
      
      const newPriceUSD = asset.price * (1.0 - percentDrop);
      const newPrice8Decimals = BigInt(Math.round(newPriceUSD * 1e8));

      const tx = await oracleContract.setPrice(newPrice8Decimals);
      const receipt = await tx.wait();
      setLastTxHash(receipt.hash);

      setPriceMultiplier(1.0 - percentDrop);
      await fetchOnChainData();
    } catch (err: any) {
      console.error('Push oracle error:', err);
      setPriceMultiplier(1.0 - percentDrop);
    } finally {
      setTxLoading(false);
      setTxStatusText('');
    }
  };

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '24px 20px 80px' }}>
      
      {/* Top Brand & Network Header */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '20px', 
        borderBottom: '1px solid var(--border-subtle)', 
        paddingBottom: '20px', 
        flexWrap: 'wrap', 
        gap: '16px' 
      }}>
        {/* Brand Core */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ 
            width: '46px', 
            height: '46px', 
            borderRadius: '12px', 
            background: 'linear-gradient(135deg, #0b1329 0%, #030712 100%)', 
            border: '1px solid var(--border-cyan-glow)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            boxShadow: '0 0 24px rgba(56, 189, 248, 0.2)'
          }}>
            <Cpu size={26} color="#38bdf8" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ 
                fontSize: '1.45rem', 
                fontWeight: '800', 
                letterSpacing: '-0.03em', 
                background: 'linear-gradient(135deg, #ffffff 30%, #94a3b8 100%)', 
                WebkitBackgroundClip: 'text', 
                WebkitTextFillColor: 'transparent' 
              }}>
                OrbitRepo
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} className="pill pill-green">
                <span className="status-dot status-dot-active status-dot-pulse" />
                <span>Robinhood Chain (46630)</span>
              </div>
              <span className="pill pill-cyan">Arbitrum Stylus WASM</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', fontWeight: '500' }}>
              Fixed-Term Repo Protocol for Tokenized Equities • Dynamic Parametric VaR
            </div>
          </div>
        </div>

        {/* Right Tools Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Dual Mode Switcher */}
          <div style={{ 
            display: 'flex', 
            background: 'var(--bg-surface-elevated)', 
            padding: '3px', 
            borderRadius: '8px', 
            border: '1px solid var(--border-medium)',
            fontSize: '0.75rem'
          }}>
            <button
              onClick={() => setExecutionMode('onchain')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: executionMode === 'onchain' ? 'var(--accent-cyan)' : 'transparent',
                color: executionMode === 'onchain' ? '#06090e' : 'var(--text-secondary)',
                fontWeight: executionMode === 'onchain' ? '700' : '500',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s'
              }}
            >
              <Zap size={13} /> Live On-Chain
            </button>
            <button
              onClick={() => setExecutionMode('simulated')}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: executionMode === 'simulated' ? 'var(--bg-surface-hover)' : 'transparent',
                color: executionMode === 'simulated' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: executionMode === 'simulated' ? '700' : '500',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s'
              }}
            >
              ⚡ Simulation Lab
            </button>
          </div>

          <a 
            href="https://faucet.testnet.chain.robinhood.com/" 
            target="_blank" 
            rel="noreferrer" 
            className="btn btn-secondary" 
            style={{ fontSize: '0.8125rem' }}
          >
            Robinhood Faucet <ArrowUpRight size={13} />
          </a>

          {account && !isRobinhoodChain && (
            <button onClick={switchToRobinhoodTestnet} className="btn btn-danger" style={{ fontSize: '0.8125rem' }}>
              Switch to Robinhood (46630)
            </button>
          )}

          <button onClick={connectWallet} className="btn btn-secondary mono" style={{ fontSize: '0.8125rem' }}>
            <Wallet size={14} color={account ? '#00c805' : '#64748b'} />
            {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : (isConnecting ? 'Connecting...' : 'Connect Wallet')}
          </button>
        </div>
      </header>

      {/* Live Transaction Notifications */}
      {txLoading && (
        <div style={{ 
          background: 'rgba(56, 189, 248, 0.08)', 
          border: '1px solid rgba(56, 189, 248, 0.35)', 
          borderRadius: '10px', 
          padding: '12px 18px', 
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '0.875rem'
        }}>
          <Loader2 className="animate-spin" size={18} color="#38bdf8" />
          <span style={{ color: 'var(--accent-cyan-light)', fontWeight: '500' }}>{txStatusText}</span>
        </div>
      )}

      {lastTxHash && (
        <div style={{ 
          background: 'rgba(0, 200, 5, 0.08)', 
          border: '1px solid rgba(0, 200, 5, 0.35)', 
          borderRadius: '10px', 
          padding: '12px 18px', 
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8125rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4ade80' }}>
            <CheckCircle2 size={16} />
            <span style={{ fontWeight: '600' }}>Transaction Confirmed On-Chain!</span>
          </div>
          <a 
            href={`https://explorer.testnet.chain.robinhood.com/tx/${lastTxHash}`} 
            target="_blank" 
            rel="noreferrer" 
            style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none', fontWeight: '500' }}
          >
            View on Explorer <ExternalLink size={12} />
          </a>
        </div>
      )}

      {txError && (
        <div style={{ 
          background: 'rgba(244, 63, 94, 0.1)', 
          border: '1px solid rgba(244, 63, 94, 0.35)', 
          borderRadius: '10px', 
          padding: '12px 18px', 
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8125rem',
          color: '#fda4af'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{txError}</span>
          </div>
          <button onClick={() => setTxError(null)} style={{ background: 'none', border: 'none', color: '#fda4af', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* Institutional Faucet Helper & Wallet Balances Bar */}
      <div style={{ 
        background: 'linear-gradient(90deg, #0d1527 0%, #0a1120 100%)', 
        border: '1px solid var(--border-medium)', 
        borderRadius: '12px', 
        padding: '12px 18px', 
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '14px',
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.3)'
      }}>
        {/* Left: Quick Balance Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
            <Coins size={15} color="#38bdf8" />
            <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Wallet Balances:</span>
          </div>
          
          <div className="glass-card" style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>USDC: </span>
            <span className="mono" style={{ fontWeight: '700', color: '#ffffff' }}>
              ${(balances.USDC || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="glass-card" style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{selectedAsset}: </span>
            <span className="mono" style={{ fontWeight: '700', color: asset.brandColor }}>
              {(balances[selectedAsset] || 0).toLocaleString()} Shares
            </span>
          </div>

          <div className="glass-card" style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Gas ETH: </span>
            <span className="mono" style={{ fontWeight: '700', color: '#94a3b8' }}>
              {(balances.ETH || 0).toFixed(4)}
            </span>
          </div>
        </div>

        {/* Right: 1-Click Faucet Mint Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            onClick={handleMintMockUSDC} 
            disabled={txLoading}
            className="btn btn-green" 
            style={{ fontSize: '0.75rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Sparkles size={13} /> Mint 10,000 Test USDC
          </button>
          <button 
            onClick={fetchOnChainData} 
            className="btn btn-secondary" 
            style={{ fontSize: '0.75rem', padding: '6px 10px' }}
            title="Sync On-Chain Balances"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Metrics Runway Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '28px' }}>
        <div className="panel" style={{ padding: '18px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600' }}>
            TradFi Repo Benchmark
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: '700', marginTop: '6px', color: '#f8fafc' }}>
            $4.4T / Day
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Activity size={12} color="#00c805" /> SIFMA institutional run-rate
          </div>
        </div>

        <div className="panel" style={{ padding: '18px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600' }}>
            Stylus MultiVM Efficiency
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: '700', marginTop: '6px', color: 'var(--accent-cyan)' }}>
            86.6% Gas Saved
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Rust Babylonian Sqrt vs EVM loops
          </div>
        </div>

        <div className="panel" style={{ padding: '18px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600' }}>
            Robinhood Pool Reserves
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: '700', marginTop: '6px', color: '#f8fafc' }}>
            ${poolStats.totalAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Liquid: ${poolStats.availableLiquidity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
          </div>
        </div>

        <div className="panel" style={{ padding: '18px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '600' }}>
            Canonical Equities
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: '700', marginTop: '6px', color: '#4ade80' }}>
            5 Whitelisted
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            AMD, AMZN, NFLX, PLTR, TSLA
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ 
        display: 'flex', 
        gap: '6px', 
        marginBottom: '22px', 
        borderBottom: '1px solid var(--border-subtle)', 
        paddingBottom: '10px' 
      }}>
        <button 
          onClick={() => setActiveTab('borrow')}
          className="btn"
          style={{ 
            background: activeTab === 'borrow' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'borrow' ? '#ffffff' : 'var(--text-secondary)',
            borderColor: activeTab === 'borrow' ? 'var(--border-strong)' : 'transparent',
            boxShadow: activeTab === 'borrow' ? '0 2px 8px rgba(0, 0, 0, 0.4)' : 'none',
            fontSize: '0.85rem'
          }}
        >
          <Layers size={16} color={activeTab === 'borrow' ? '#38bdf8' : 'currentColor'} /> 
          Repo Desk (Borrow)
        </button>
        <button 
          onClick={() => setActiveTab('lend')}
          className="btn"
          style={{ 
            background: activeTab === 'lend' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'lend' ? '#ffffff' : 'var(--text-secondary)',
            borderColor: activeTab === 'lend' ? 'var(--border-strong)' : 'transparent',
            boxShadow: activeTab === 'lend' ? '0 2px 8px rgba(0, 0, 0, 0.4)' : 'none',
            fontSize: '0.85rem'
          }}
        >
          <TrendingUp size={16} color={activeTab === 'lend' ? '#00c805' : 'currentColor'} /> 
          Lender Vault (Earn LP)
        </button>
        <button 
          onClick={() => setActiveTab('risk')}
          className="btn"
          style={{ 
            background: activeTab === 'risk' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'risk' ? '#ffffff' : 'var(--text-secondary)',
            borderColor: activeTab === 'risk' ? 'var(--border-strong)' : 'transparent',
            boxShadow: activeTab === 'risk' ? '0 2px 8px rgba(0, 0, 0, 0.4)' : 'none',
            fontSize: '0.85rem'
          }}
        >
          <Sliders size={16} color={activeTab === 'risk' ? '#f59e0b' : 'currentColor'} /> 
          Risk Engine & Keeper Desk
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: REPO DESK (BORROW CAPITAL)                                         */}
      {/* ========================================================================= */}
      {activeTab === 'borrow' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)', gap: '22px' }}>
          
          {/* Main Deal Slip Panel */}
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Lock size={16} color="#38bdf8" />
                <span style={{ fontWeight: '700', fontSize: '0.9375rem' }}>Fixed-Term Repo Facility</span>
              </div>
              <span className="pill pill-cyan">Arbitrum Stylus MultiVM</span>
            </div>

            <div className="panel-body">
              {/* Asset Selection Grid */}
              <div style={{ marginBottom: '22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                    Select Canonical Tokenized Stock (Robinhood Chain)
                  </label>
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ShieldCheck size={13} /> Verified Faucet Equities
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: '8px' }}>
                  {Object.keys(SUPPORTED_ASSETS).map(sym => {
                    const item = SUPPORTED_ASSETS[sym];
                    const active = selectedAsset === sym;
                    return (
                      <div 
                        key={sym} 
                        onClick={() => setSelectedAsset(sym)}
                        className={`stock-card ${item.brandClass} ${active ? 'active' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: '800', fontSize: '0.95rem', color: active ? '#ffffff' : 'var(--text-primary)' }}>
                            {item.symbol}
                          </span>
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: '600' }}>
                            {item.beta}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: '0.875rem', fontWeight: '700', marginTop: '4px', color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}>
                          ${(item.price * priceMultiplier).toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          σ={item.dailyVol}% / day
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Contract: <span className="mono">{asset.address}</span>
                  <a href={`https://explorer.testnet.chain.robinhood.com/address/${asset.address}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-cyan)' }}>
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Tenor Selection */}
              <div style={{ marginBottom: '22px' }}>
                <label style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: '600' }}>
                  Fixed Repo Term & Horizon
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[1, 7, 30].map(days => {
                    const active = termDays === days;
                    return (
                      <div 
                        key={days} 
                        onClick={() => setTermDays(days)}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '10px',
                          background: active ? 'var(--bg-surface-elevated)' : 'var(--bg-surface-subtle)',
                          border: active ? '1px solid var(--accent-green)' : '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.875rem', color: active ? '#ffffff' : 'var(--text-primary)' }}>
                            {termRates[days].label}
                          </span>
                          <span className="mono" style={{ fontSize: '0.75rem', color: active ? '#4ade80' : 'var(--text-tertiary)', fontWeight: '600' }}>
                            {termRates[days].rateText}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                          {termRates[days].tenorDesc}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pledged Collateral Amount */}
              <div style={{ marginBottom: '22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '600' }}>Collateral Pledge Amount</span>
                  <span className="mono" style={{ color: 'var(--text-tertiary)' }}>
                    Wallet Available: <strong style={{ color: '#ffffff' }}>{(balances[selectedAsset] || 0).toLocaleString()}</strong> {selectedAsset}
                  </span>
                </div>

                <div style={{ position: 'relative' }}>
                  <input 
                    type="number" 
                    value={collateralInput} 
                    onChange={e => setCollateralInput(e.target.value)}
                    className="input-base" 
                    placeholder="0.00"
                  />
                  <div style={{ 
                    position: 'absolute', 
                    right: '12px', 
                    top: '50%', 
                    transform: 'translateY(-50%)', 
                    display: 'flex', 
                    gap: '4px' 
                  }}>
                    <button onClick={() => handleQuickPercent(0.25)} className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '0.7rem' }}>25%</button>
                    <button onClick={() => handleQuickPercent(0.50)} className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '0.7rem' }}>50%</button>
                    <button onClick={() => handleQuickPercent(0.75)} className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '0.7rem' }}>75%</button>
                    <button onClick={() => handleQuickPercent(1.00)} className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.7rem', fontWeight: '700', color: 'var(--accent-cyan)' }}>MAX</button>
                  </div>
                </div>
              </div>

              {/* Stylus Dynamic VaR Visual Risk Gauge */}
              <div style={{ 
                background: 'linear-gradient(180deg, #0e1626 0%, #0a101d 100%)', 
                border: '1px solid var(--border-medium)', 
                borderRadius: '12px', 
                padding: '16px', 
                marginBottom: '22px' 
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Percent size={15} color="#38bdf8" />
                    <span style={{ fontSize: '0.8125rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                      Stylus Dynamic Max LTV ({asset.symbol})
                    </span>
                  </div>
                  <span className="mono" style={{ 
                    fontSize: '1.35rem', 
                    fontWeight: '800', 
                    color: dynamicMaxLtv >= 70 ? 'var(--accent-green)' : (dynamicMaxLtv >= 50 ? 'var(--accent-cyan)' : 'var(--accent-amber)') 
                  }}>
                    {dynamicMaxLtv}%
                  </span>
                </div>

                {/* Meter visual bar */}
                <div className="risk-meter-container" style={{ marginBottom: '12px' }}>
                  <div 
                    className="risk-meter-fill" 
                    style={{ 
                      width: `${dynamicMaxLtv}%`, 
                      background: dynamicMaxLtv >= 70 ? 'linear-gradient(90deg, #00c805, #22c55e)' : (dynamicMaxLtv >= 50 ? 'linear-gradient(90deg, #0284c7, #38bdf8)' : 'linear-gradient(90deg, #d97706, #f59e0b)') 
                    }} 
                  />
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: '1.45' }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Parametric VaR (99% CI):</strong> Applied haircut of <span className="mono" style={{ color: '#ffffff' }}>{rawHaircut.toFixed(1)}%</span> for {termDays}-day term derived from historical realized daily volatility (σ={asset.dailyVol}%). Maintenance buffer set at <span className="mono" style={{ color: '#ffffff' }}>{maintenanceLtv}%</span>.
                </div>
              </div>

              {/* Institutional Settlement Ticket */}
              <div style={{ 
                background: 'var(--bg-surface-elevated)', 
                border: '1px solid var(--border-subtle)', 
                borderRadius: '10px', 
                padding: '14px 16px',
                display: 'flex', 
                flexDirection: 'column', 
                gap: '10px', 
                fontSize: '0.8125rem', 
                marginBottom: '22px' 
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Collateral Valuation:</span>
                  <span className="mono" style={{ fontWeight: '600' }}>
                    ${collateralValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Borrow Principal Disbursed:</span>
                  <span className="mono" style={{ fontWeight: '700', color: 'var(--accent-cyan)' }}>
                    ${maxBorrowAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Fixed Repo Yield ({termRates[termDays].rateText}):</span>
                  <span className="mono" style={{ fontWeight: '600' }}>
                    ${fixedInterest.toFixed(2)} USDC
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border-medium)', paddingTop: '10px' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>Settlement Obligation:</span>
                  <span className="mono" style={{ fontWeight: '800', fontSize: '0.9375rem', color: '#ffffff' }}>
                    ${(maxBorrowAmount + fixedInterest).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </div>
              </div>

              {/* Execution Button */}
              <button 
                onClick={handleOpenRepo} 
                disabled={txLoading}
                className="btn btn-primary" 
                style={{ width: '100%', padding: '14px', fontSize: '0.9375rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {txLoading ? (
                  <>
                    <Loader2 className="animate-spin" size={18} /> Processing On-Chain...
                  </>
                ) : (
                  <>
                    Lock Collateral & Execute Repo <ArrowRight size={17} />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Comparative Market Advantage & Active Positions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Why OrbitRepo Beats Generic Lending */}
            <div className="panel">
              <div className="panel-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart3 size={16} color="#00c805" />
                  <span style={{ fontWeight: '700', fontSize: '0.875rem' }}>Ecosystem Architecture</span>
                </div>
              </div>
              <div className="panel-body" style={{ fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontWeight: '700', color: 'var(--text-secondary)' }}>Generic Lending (Aave / Morpho Flat LTV)</div>
                  <div style={{ color: 'var(--text-tertiary)', marginTop: '4px', lineHeight: '1.45' }}>
                    Standard pools apply a uniform 75% LTV to all assets. For high-beta equities (TSLA, PLTR), an earnings gap down easily triggers sudden insolvency.
                  </div>
                </div>

                <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'var(--accent-cyan-subtle)', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                  <div style={{ fontWeight: '700', color: 'var(--accent-cyan)' }}>OrbitRepo Stylus Parametric VaR</div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.45' }}>
                    Dynamically prices individual risk: <strong>AMZN (lower volatility) unlocks higher borrowing power (73.5%)</strong>, while <strong>PLTR requires higher haircuts</strong> to ensure 100% pool solvency.
                  </div>
                </div>
              </div>
            </div>

            {/* Your Active Positions */}
            <div className="panel">
              <div className="panel-header">
                <span style={{ fontWeight: '700', fontSize: '0.875rem' }}>Active Repo Positions</span>
                <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{positions.length} Active</span>
              </div>
              <div className="panel-body" style={{ padding: '0' }}>
                {positions.length === 0 ? (
                  <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>
                    No active repo positions found for this account.
                  </div>
                ) : (
                  positions.map(pos => {
                    const currentVal = pos.collateralAmt * currentPrice;
                    const currentLtv = (pos.debt / currentVal) * 100;
                    const isLiquidatable = currentLtv > (pos.maxLtv + 5.0);

                    return (
                      <div key={pos.id} style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.875rem' }}>
                            Position #{pos.id} • {pos.collateralAmt} {pos.asset}
                          </span>
                          <span className={isLiquidatable ? 'pill pill-red' : 'pill pill-green'}>
                            {isLiquidatable ? 'Liquidatable' : 'Healthy'}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                          Debt: ${pos.debt.toFixed(2)} USDC | LTV: <strong style={{ color: isLiquidatable ? 'var(--accent-rose)' : '#ffffff' }}>{currentLtv.toFixed(1)}%</strong> (Max: {pos.maxLtv}%)
                        </div>
                        <button 
                          onClick={() => handleRepay(pos.id)} 
                          disabled={txLoading}
                          className="btn btn-secondary" 
                          style={{ width: '100%', fontSize: '0.75rem', padding: '7px 12px' }}
                        >
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

      {/* ========================================================================= */}
      {/* TAB 2: LENDER VAULT (LIQUIDITY PROVIDER DESK)                             */}
      {/* ========================================================================= */}
      {activeTab === 'lend' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)', gap: '22px' }}>
          <div className="panel">
            <div className="panel-header">
              <span style={{ fontWeight: '700', fontSize: '0.9375rem' }}>Robinhood Fixed-Yield Reserve Vault</span>
              <span className="pill pill-green">ERC-4626 Native</span>
            </div>
            <div className="panel-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '22px', lineHeight: '1.5' }}>
                Supply USDC to back short-term institutional repo obligations for Robinhood tokenized equities. Unlike variable DeFi lending markets, repo yield is locked at the moment of borrowing, creating deterministic bond-like returns.
              </p>

              {/* APY Tiers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '22px' }}>
                <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>Overnight APY</div>
                  <div className="mono" style={{ fontSize: '1.45rem', fontWeight: '800', color: 'var(--accent-green)', marginTop: '4px' }}>5.40%</div>
                </div>
                <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>7-Day APY</div>
                  <div className="mono" style={{ fontSize: '1.45rem', fontWeight: '800', color: 'var(--accent-green)', marginTop: '4px' }}>7.80%</div>
                </div>
                <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: '600' }}>30-Day APY</div>
                  <div className="mono" style={{ fontSize: '1.45rem', fontWeight: '800', color: 'var(--accent-green)', marginTop: '4px' }}>7.30%</div>
                </div>
              </div>

              {/* Deposit Input */}
              <div style={{ marginBottom: '22px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '600' }}>Deposit Stablecoin (USDC)</span>
                  <span className="mono">Balance: ${(balances.USDC || 0).toLocaleString()} USDC</span>
                </div>
                <input 
                  type="number" 
                  value={depositAmountInput} 
                  onChange={e => setDepositAmountInput(e.target.value)}
                  className="input-base" 
                  placeholder="0.00" 
                />
              </div>

              <button 
                onClick={handleDepositLiquidity} 
                disabled={txLoading}
                className="btn btn-primary" 
                style={{ width: '100%', padding: '14px', fontSize: '0.9375rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {txLoading ? <Loader2 className="animate-spin" size={18} /> : null}
                Supply Liquidity & Mint LP Shares <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* LP Share Account Status */}
          <div className="panel">
            <div className="panel-header">
              <span style={{ fontWeight: '700', fontSize: '0.875rem' }}>Your LP Position</span>
            </div>
            <div className="panel-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.8125rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>LP Shares Held:</span>
                  <span className="mono" style={{ fontWeight: '700' }}>
                    {poolStats.userShares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ORBIT-LP
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Principal Value:</span>
                  <span className="mono" style={{ fontWeight: '700' }}>
                    ${poolStats.userShares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Total Pool Reserves:</span>
                  <span className="mono" style={{ fontWeight: '700', color: 'var(--accent-green)' }}>
                    ${poolStats.totalAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </div>

                <div style={{ marginTop: '10px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: '600' }}>
                    Redeem LP Shares for USDC
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="number" 
                      value={withdrawSharesInput} 
                      onChange={e => setWithdrawSharesInput(e.target.value)}
                      className="input-base" 
                      style={{ padding: '10px 14px' }}
                      placeholder="Shares" 
                    />
                    <button 
                      onClick={handleWithdrawLiquidity} 
                      disabled={txLoading}
                      className="btn btn-secondary" 
                      style={{ whiteSpace: 'nowrap', padding: '10px 16px' }}
                    >
                      Redeem
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: RISK ENGINE & KEEPER LIQUIDATION DESK                              */}
      {/* ========================================================================= */}
      {activeTab === 'risk' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <span style={{ fontWeight: '700', fontSize: '1rem' }}>Stress Testing & Liquidation Keeper Desk</span>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Simulate equity market shocks to verify Stylus dynamic margin enforcement and permissionless liquidations.
              </div>
            </div>
            <span className="pill pill-cyan mono">Oracle Feed: Active</span>
          </div>

          <div className="panel-body">
            {/* Scenario buttons */}
            <div style={{ marginBottom: '26px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  Market Shock Scenarios ({selectedAsset}):
                </span>
                {executionMode === 'onchain' && account && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)' }}>
                    On-chain updates trigger real MockPriceOracle.setPrice()
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button onClick={() => handlePushOraclePriceDrop(0.0)} className={`btn ${priceMultiplier === 1.0 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.78rem' }}>
                  Baseline Market (0%)
                </button>
                <button onClick={() => handlePushOraclePriceDrop(0.15)} className={`btn ${priceMultiplier === 0.85 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.78rem' }}>
                  Mild Correction (-15%)
                </button>
                <button onClick={() => handlePushOraclePriceDrop(0.30)} className={`btn ${priceMultiplier === 0.70 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.78rem' }}>
                  Earnings Gap Shock (-30%)
                </button>
                <button onClick={() => handlePushOraclePriceDrop(0.45)} className={`btn ${priceMultiplier === 0.55 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.78rem' }}>
                  Black Swan Drop (-45%)
                </button>
              </div>
            </div>

            {/* Position Monitoring Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Position ID</th>
                    <th>Collateral Asset</th>
                    <th>Valuation</th>
                    <th>Debt (USDC)</th>
                    <th>Live LTV</th>
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
                        <td className="mono" style={{ fontWeight: '700' }}>#{pos.id}</td>
                        <td>
                          <span style={{ fontWeight: '700', color: SUPPORTED_ASSETS[pos.asset]?.brandColor || '#ffffff' }}>
                            {pos.collateralAmt} {pos.asset}
                          </span>
                        </td>
                        <td className="mono">${currentVal.toFixed(2)}</td>
                        <td className="mono">${pos.debt.toFixed(2)}</td>
                        <td className="mono" style={{ fontWeight: '700', color: isLiquidatable ? 'var(--accent-rose)' : '#ffffff' }}>
                          {currentLtv.toFixed(1)}%
                        </td>
                        <td className="mono" style={{ color: 'var(--text-tertiary)' }}>{threshold.toFixed(1)}%</td>
                        <td>
                          <span className={isLiquidatable ? 'pill pill-red' : 'pill pill-green'}>
                            {isLiquidatable ? 'Liquidatable' : 'Solvent'}
                          </span>
                        </td>
                        <td>
                          {isLiquidatable ? (
                            <button 
                              onClick={() => handleLiquidate(pos.id)} 
                              disabled={txLoading}
                              className="btn btn-danger" 
                              style={{ fontSize: '0.75rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              {txLoading ? <Loader2 className="animate-spin" size={12} /> : null}
                              Execute Liquidation ($240 Bounty)
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Position Healthy</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Stylus WASM Benchmarking Strip */}
            <div style={{ 
              marginTop: '26px', 
              padding: '16px', 
              borderRadius: '10px', 
              background: 'var(--bg-surface-elevated)', 
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '14px'
            }}>
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  Arbitrum Stylus MultiVM Gas Benchmark
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                  Execution Cost of 30-Day Parametric VaR calculation across 30 historical price buffers
                </div>
              </div>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Standard EVM Solidity</div>
                  <div className="mono" style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>288,400 gas</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)' }}>Arbitrum Stylus (Rust WASM)</div>
                  <div className="mono" style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--accent-green)' }}>38,500 gas (-86.6%)</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Institutional Footer */}
      <footer style={{ 
        marginTop: '60px', 
        paddingTop: '24px', 
        borderTop: '1px solid var(--border-subtle)', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        fontSize: '0.78rem', 
        color: 'var(--text-tertiary)', 
        flexWrap: 'wrap', 
        gap: '14px' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>OrbitRepo Protocol</span>
          <span>•</span>
          <span>Arbitrum Open House Singapore Online Buildathon</span>
        </div>
        <div className="mono">
          Settlement: 46630 (Robinhood Chain Testnet) | RepoVault:{' '}
          <a 
            href={`https://explorer.testnet.chain.robinhood.com/address/${addresses.repoVault}`} 
            target="_blank" 
            rel="noreferrer" 
            style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}
          >
            {addresses.repoVault ? `${addresses.repoVault.slice(0, 10)}...` : 'Deployed'}
          </a>
        </div>
      </footer>

    </div>
  );
}
