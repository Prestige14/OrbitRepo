export const REPO_VAULT_ABI = [
  "function openPosition(address asset, uint256 collateralAmount, uint8 termDays) external returns (uint256)",
  "function repay(uint256 positionId) external",
  "function liquidate(uint256 positionId) external",
  "function getPositionHealth(uint256 positionId) external view returns (uint256 currentLtvBps, uint256 liquidationThresholdBps, bool isLiquidatable)",
  "function getAssetPriceUSD(address asset) external view returns (uint256)",
  "function getCollateralValueUSDC(address asset, uint256 amount) external view returns (uint256)",
  "function calculateFixedInterest(uint256 principal, uint8 termDays) external pure returns (uint256)",
  "function nextPositionId() external view returns (uint256)",
  "function positions(uint256) external view returns (uint256 id, address borrower, address collateralAsset, uint256 collateralAmount, uint256 borrowedPrincipal, uint256 fixedInterest, uint8 termDays, uint256 openedAt, uint256 maturityAt, uint256 maxLtvBps, bool isClosed)",
  "function assetConfigs(address) external view returns (bool isWhitelisted, address oracleAddress, uint256 stalenessThreshold)"
];

export const LIQUIDITY_POOL_ABI = [
  "function deposit(uint256 amount) external returns (uint256)",
  "function withdraw(uint256 shares) external returns (uint256)",
  "function sharesOf(address) external view returns (uint256)",
  "function totalShares() external view returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function availableLiquidity() external view returns (uint256)",
  "function totalBorrowed() external view returns (uint256)",
  "function stablecoin() external view returns (address)"
];

export const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address recipient, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function mint(address to, uint256 amount) external"
];

export const ORACLE_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function setPrice(int256 newPrice) external",
  "function decimals() external view returns (uint8)"
];
