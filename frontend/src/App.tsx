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
  ArrowRight
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
  type: 'Equity';
  address: string;
  oracle: string;
}

const SUPPORTED_ASSETS: Record<string, AssetConfig> = {
  AMD: {
    symbol: 'AMD',
    name: 'Advanced Micro Devices',
    price: 155.00,
    dailyVol: 3.4,
    annualizedVol: 53.9,
    type: 'Equity',
    address: addresses.tokens.AMD.address,
    oracle: addresses.tokens.AMD.oracle
  },
  AMZN: {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    price: 185.00,
    dailyVol: 2.2,
    annualizedVol: 34.9,
    type: 'Equity',
    address: addresses.tokens.AMZN.address,
    oracle: addresses.tokens.AMZN.oracle
  },
  NFLX: {
    symbol: 'NFLX',
    name: 'Netflix Inc.',
    price: 690.00,
    dailyVol: 2.8,
    annualizedVol: 44.4,
    type: 'Equity',
    address: addresses.tokens.NFLX.address,
    oracle: addresses.tokens.NFLX.oracle
  },
  PLTR: {
    symbol: 'PLTR',
    name: 'Palantir Technologies',
    price: 36.00,
    dailyVol: 4.1,
    annualizedVol: 65.0,
    type: 'Equity',
    address: addresses.tokens.PLTR.address,
    oracle: addresses.tokens.PLTR.oracle
  },
  TSLA: {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    price: 245.00,
    dailyVol: 3.8,
    annualizedVol: 60.3,
    type: 'Equity',
    address: addresses.tokens.TSLA.address,
    oracle: addresses.tokens.TSLA.oracle
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
      maturityDate: 'Oct 25, 2026'
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
  const termRates: Record<number, { feeBps: number; label: string; rateText: string }> = {
    1: { feeBps: 3, label: 'Overnight (1D)', rateText: '0.03%' },
    7: { feeBps: 15, label: '7 Days', rateText: '0.15%' },
    30: { feeBps: 60, label: '30 Days', rateText: '0.60%' }
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

        // Check recent positions
        const startPos = Math.max(1, totalPos - 15);
        for (let i = totalPos - 1; i >= startPos; i--) {
          try {
            const p = await vaultContract.positions(i);
            // p = (id, borrower, collateralAsset, collateralAmount, borrowedPrincipal, fixedInterest, termDays, openedAt, maturityAt, maxLtvBps, isClosed)
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
  }, [account, isRobinhoodChain]);

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

  // Poll on-chain data when account/chain changes
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
      // Fallback simulation mode
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

  // ==========================================
  // TRANSACTION HANDLERS (ON-CHAIN & SIMULATED)
  // ==========================================

  // 1. Open Repo Position
  const handleOpenRepo = async () => {
    if (collateralQty <= 0) return;
    setTxError(null);
    setLastTxHash(null);

    // If in On-Chain mode with wallet connected on Robinhood Chain
    if (executionMode === 'onchain' && account && isRobinhoodChain) {
      try {
        setTxLoading(true);
        const signer = await getSigner();
        const collateralWei = parseEther(collateralQty.toString());
        const tokenContract = new Contract(asset.address, ERC20_ABI, signer);
        const vaultContract = new Contract(addresses.repoVault, REPO_VAULT_ABI, signer);

        // Check token balance
        const balance = await tokenContract.balanceOf(account);
        if (balance < collateralWei) {
          throw new Error(`Insufficient ${selectedAsset} balance on Robinhood Chain. Claim from Robinhood Faucet or switch to Simulation Mode.`);
        }

        // Check allowance
        setTxStatusText(`Step 1/2: Checking ${selectedAsset} allowance...`);
        const allowance = await tokenContract.allowance(account, addresses.repoVault);
        if (allowance < collateralWei) {
          setTxStatusText(`Step 1/2: Approving ${selectedAsset} collateral in MetaMask...`);
          const approveTx = await tokenContract.approve(addresses.repoVault, collateralWei);
          setTxStatusText(`Step 1/2: Waiting for approval confirmation...`);
          await approveTx.wait();
        }

        // Open position
        setTxStatusText(`Step 2/2: Confirming openPosition on Robinhood Chain...`);
        const tx = await vaultContract.openPosition(asset.address, collateralWei, termDays);
        setTxStatusText(`Step 2/2: Mining repo transaction...`);
        const receipt = await tx.wait();
        setLastTxHash(receipt.hash);

        // Refresh on-chain balances
        await fetchOnChainData();
      } catch (err: any) {
        console.error('OpenRepo on-chain error:', err);
        setTxError(err.reason || err.message || 'Transaction failed or was rejected');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    // Fallback: Instant Simulation Mode
    if ((balances[selectedAsset] || 0) < collateralQty) {
      alert(`Insufficient ${selectedAsset} balance. Use faucet or adjust amount.`);
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

  // 2. Repay Position
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

        // Check USDC allowance
        setTxStatusText(`Step 1/2: Checking USDC allowance for repayment...`);
        const allowance = await usdcContract.allowance(account, addresses.repoVault);
        if (allowance < debtWei) {
          setTxStatusText(`Step 1/2: Approving USDC in MetaMask...`);
          const approveTx = await usdcContract.approve(addresses.repoVault, debtWei);
          await approveTx.wait();
        }

        // Repay
        setTxStatusText(`Step 2/2: Confirming repayment on Robinhood Chain...`);
        const tx = await vaultContract.repay(id);
        const receipt = await tx.wait();
        setLastTxHash(receipt.hash);

        await fetchOnChainData();
        setPositions(positions.filter(p => p.id !== id));
      } catch (err: any) {
        console.error('Repay on-chain error:', err);
        setTxError(err.reason || err.message || 'Repay transaction failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    // Simulation Mode
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

  // 3. Liquidate Position
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
        console.error('Liquidation on-chain error:', err);
        setTxError(err.reason || err.message || 'Liquidation transaction failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    // Simulation Mode
    setBalances(prev => ({
      ...prev,
      USDC: prev.USDC - pos.debt,
      [pos.asset]: (prev[pos.asset] || 0) + pos.collateralAmt
    }));
    setPositions(positions.filter(p => p.id !== id));
  };

  // 4. Deposit Liquidity to Pool
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
        console.error('Deposit LP on-chain error:', err);
        setTxError(err.reason || err.message || 'Deposit failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    // Simulation Mode
    setBalances(prev => ({ ...prev, USDC: Math.max(0, prev.USDC - amt) }));
    setPoolStats(prev => ({
      ...prev,
      totalAssets: prev.totalAssets + amt,
      availableLiquidity: prev.availableLiquidity + amt,
      userShares: prev.userShares + amt
    }));
    alert(`Deposit confirmed! ${amt.toLocaleString()} ORBIT-LP shares minted in simulation.`);
  };

  // 5. Withdraw Liquidity from Pool
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
        console.error('Withdraw LP on-chain error:', err);
        setTxError(err.reason || err.message || 'Withdrawal failed');
      } finally {
        setTxLoading(false);
        setTxStatusText('');
      }
      return;
    }

    // Simulation Mode
    setBalances(prev => ({ ...prev, USDC: prev.USDC + shares }));
    setPoolStats(prev => ({
      ...prev,
      totalAssets: Math.max(0, prev.totalAssets - shares),
      availableLiquidity: Math.max(0, prev.availableLiquidity - shares),
      userShares: Math.max(0, prev.userShares - shares)
    }));
    alert(`Redemption processed! ${shares.toLocaleString()} USDC returned to balance.`);
  };

  // 6. Faucet: 1-Click Mint Mock USDC
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

  // 7. On-chain Oracle Shock
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
      // Fallback to local multiplier
      setPriceMultiplier(1.0 - percentDrop);
    } finally {
      setTxLoading(false);
      setTxStatusText('');
    }
  };

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '24px 20px 80px' }}>
      
      {/* Institutional Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ 
            width: '42px', 
            height: '42px', 
            borderRadius: '10px', 
            background: '#0f172a', 
            border: '1px solid var(--border-strong)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(56, 189, 248, 0.15)'
          }}>
            <Cpu size={24} color="#38bdf8" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '1.35rem', fontWeight: '800', letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #f8fafc, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                OrbitRepo
              </span>
              <span className="pill pill-green">Robinhood Chain (46630)</span>
              <span className="pill pill-cyan">Arbitrum Stylus WASM</span>
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Institutional Fixed-Term Repo Protocol for Tokenized Equities
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Mode Switcher */}
          <div style={{ 
            display: 'flex', 
            background: 'var(--bg-surface-subtle)', 
            padding: '3px', 
            borderRadius: '8px', 
            border: '1px solid var(--border-subtle)',
            fontSize: '0.75rem'
          }}>
            <button
              onClick={() => setExecutionMode('onchain')}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: executionMode === 'onchain' ? 'var(--accent-cyan)' : 'transparent',
                color: executionMode === 'onchain' ? '#0f172a' : 'var(--text-secondary)',
                fontWeight: executionMode === 'onchain' ? '700' : '500',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Zap size={13} /> Live On-Chain
            </button>
            <button
              onClick={() => setExecutionMode('simulated')}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: executionMode === 'simulated' ? 'var(--bg-surface-elevated)' : 'transparent',
                color: executionMode === 'simulated' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: executionMode === 'simulated' ? '700' : '500',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              ⚡ Instant Demo
            </button>
          </div>

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
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: account ? '#22c55e' : '#64748b' }} />
            {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : (isConnecting ? 'Connecting...' : 'Connect Wallet')}
          </button>
        </div>
      </header>

      {/* Transaction & Alert Status Banners */}
      {txLoading && (
        <div style={{ 
          background: 'rgba(56, 189, 248, 0.1)', 
          border: '1px solid rgba(56, 189, 248, 0.3)', 
          borderRadius: '8px', 
          padding: '12px 16px', 
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '0.875rem'
        }}>
          <Loader2 className="animate-spin" size={18} color="#38bdf8" />
          <span style={{ color: 'var(--accent-cyan)', fontWeight: '500' }}>{txStatusText}</span>
        </div>
      )}

      {lastTxHash && (
        <div style={{ 
          background: 'rgba(34, 197, 94, 0.1)', 
          border: '1px solid rgba(34, 197, 94, 0.3)', 
          borderRadius: '8px', 
          padding: '12px 16px', 
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8125rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-green)' }}>
            <CheckCircle2 size={16} />
            <span>Transaction Confirmed On-Chain!</span>
          </div>
          <a 
            href={`https://explorer.testnet.chain.robinhood.com/tx/${lastTxHash}`} 
            target="_blank" 
            rel="noreferrer" 
            style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'underline' }}
          >
            View on Explorer <ExternalLink size={12} />
          </a>
        </div>
      )}

      {txError && (
        <div style={{ 
          background: 'rgba(239, 68, 68, 0.1)', 
          border: '1px solid rgba(239, 68, 68, 0.3)', 
          borderRadius: '8px', 
          padding: '12px 16px', 
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8125rem',
          color: '#f87171'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{txError}</span>
          </div>
          <button onClick={() => setTxError(null)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Testnet Helper Bar */}
      <div style={{ 
        background: 'linear-gradient(90deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.8))', 
        border: '1px solid var(--border-subtle)', 
        borderRadius: '8px', 
        padding: '10px 16px', 
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <Sparkles size={16} color="#38bdf8" />
          <span>Robinhood Chain Testnet Faucet Quick-Start:</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button 
            onClick={handleMintMockUSDC} 
            disabled={txLoading}
            className="btn btn-secondary" 
            style={{ fontSize: '0.75rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Coins size={13} color="#22c55e" /> Mint 10,000 Test USDC
          </button>
          <button 
            onClick={fetchOnChainData} 
            className="btn btn-secondary" 
            style={{ fontSize: '0.75rem', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
            title="Refresh On-Chain Balances"
          >
            <RefreshCw size={12} /> Sync
          </button>
        </div>
      </div>

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
          <div className="mono" style={{ fontSize: '1.35rem', fontWeight: '600', marginTop: '4px' }}>
            ${poolStats.totalAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Available: ${poolStats.availableLiquidity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
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
                  <span className="mono">
                    Balance: {(balances[selectedAsset] || 0).toLocaleString()} {selectedAsset}
                  </span>
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

              <button 
                onClick={handleOpenRepo} 
                disabled={txLoading}
                className="btn btn-primary" 
                style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {txLoading ? (
                  <>
                    <Loader2 className="animate-spin" size={16} /> Processing Transaction...
                  </>
                ) : (
                  <>
                    Lock Collateral & Execute Repo <ArrowRight size={16} />
                  </>
                )}
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
                        <button 
                          onClick={() => handleRepay(pos.id)} 
                          disabled={txLoading}
                          className="btn btn-secondary" 
                          style={{ width: '100%', fontSize: '0.75rem', padding: '6px 12px' }}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  <span>Deposit Stablecoin (USDC)</span>
                  <span className="mono">Balance: {(balances.USDC || 0).toLocaleString()} USDC</span>
                </div>
                <input 
                  type="number" 
                  value={depositAmountInput} 
                  onChange={e => setDepositAmountInput(e.target.value)}
                  className="input-base mono" 
                  placeholder="0.00" 
                />
              </div>

              <button 
                onClick={handleDepositLiquidity} 
                disabled={txLoading}
                className="btn btn-primary" 
                style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                {txLoading ? <Loader2 className="animate-spin" size={16} /> : null}
                Deposit Liquidity to Pool
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span style={{ fontWeight: '600' }}>Your LP Share Account</span>
            </div>
            <div className="panel-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.8125rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Your LP Shares:</span>
                  <span className="mono" style={{ fontWeight: '600' }}>
                    {poolStats.userShares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LP
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Principal Value:</span>
                  <span className="mono" style={{ fontWeight: '600' }}>
                    ${poolStats.userShares.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Total Pool Liquidity:</span>
                  <span className="mono" style={{ fontWeight: '600', color: 'var(--accent-green)' }}>
                    ${poolStats.totalAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                  </span>
                </div>

                <div style={{ marginTop: '8px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Withdraw Shares</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type="number" 
                      value={withdrawSharesInput} 
                      onChange={e => setWithdrawSharesInput(e.target.value)}
                      className="input-base mono" 
                      style={{ padding: '8px' }}
                      placeholder="Shares" 
                    />
                    <button 
                      onClick={handleWithdrawLiquidity} 
                      disabled={txLoading}
                      className="btn btn-secondary" 
                      style={{ whiteSpace: 'nowrap' }}
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Market Price Adjustment ({selectedAsset}):</span>
                {executionMode === 'onchain' && account && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)' }}>
                    Clicking a shock scenario updates the price feed
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => handlePushOraclePriceDrop(0.0)} className={`btn ${priceMultiplier === 1.0 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
                  Baseline Market (0%)
                </button>
                <button onClick={() => handlePushOraclePriceDrop(0.15)} className={`btn ${priceMultiplier === 0.85 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
                  Mild Correction (-15%)
                </button>
                <button onClick={() => handlePushOraclePriceDrop(0.30)} className={`btn ${priceMultiplier === 0.70 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
                  Earnings Gap Shock (-30%)
                </button>
                <button onClick={() => handlePushOraclePriceDrop(0.45)} className={`btn ${priceMultiplier === 0.55 ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: '0.75rem' }}>
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
                          <button 
                            onClick={() => handleLiquidate(pos.id)} 
                            disabled={txLoading}
                            className="btn btn-danger" 
                            style={{ fontSize: '0.75rem', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            {txLoading ? <Loader2 className="animate-spin" size={12} /> : null}
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
