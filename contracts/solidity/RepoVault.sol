// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IRiskEngine.sol";
import "./interfaces/IPriceOracle.sol";
import "./LiquidityPool.sol";

/**
 * @title RepoVault
 * @notice Fixed-Term Repo Market for Tokenized Equity powered by Arbitrum Stylus Dynamic Risk Engine.
 * @dev Enforces dynamic Max LTV calculated by Risk Engine, maintenance margin buffer, and permissionless liquidation.
 */
contract RepoVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Position {
        uint256 id;
        address borrower;
        address collateralAsset;
        uint256 collateralAmount;
        uint256 borrowedPrincipal;
        uint256 fixedInterest;
        uint8 termDays;
        uint256 openedAt;
        uint256 maturityAt;
        uint256 maxLtvBps;
        bool isClosed;
    }

    struct AssetConfig {
        bool isWhitelisted;
        address oracleAddress;
        uint256 stalenessThreshold; // In seconds, e.g., 3600 (1 hour)
    }

    uint256 public constant BPS_DIVISOR = 10_000;
    uint256 public constant HARD_CAP_MAX_LTV = 8_000; // 80.00% initial margin hard cap
    uint256 public constant HARD_FLOOR_MIN_LTV = 2_000; // 20.00% initial margin hard floor
    uint256 public constant MAINTENANCE_BUFFER_BPS = 500; // 5.00% maintenance buffer before liquidation

    address public immutable admin;
    IRiskEngine public riskEngine;
    LiquidityPool public immutable liquidityPool;
    IERC20 public immutable stablecoin;

    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) public positions;
    mapping(address => AssetConfig) public assetConfigs;

    event PositionOpened(
        uint256 indexed positionId,
        address indexed borrower,
        address indexed asset,
        uint256 collateralAmount,
        uint256 borrowedPrincipal,
        uint256 fixedInterest,
        uint8 termDays,
        uint256 maxLtvBps,
        uint256 maturityAt
    );

    event PositionRepaid(uint256 indexed positionId, address indexed borrower, uint256 totalRepaid);
    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed liquidator,
        address indexed borrower,
        uint256 debtPaid,
        uint256 collateralSeized
    );
    event AssetWhitelisted(address indexed asset, address indexed oracle, uint256 stalenessThreshold);
    event RiskEngineUpdated(address indexed newRiskEngine);

    error AssetNotWhitelisted();
    error OraclePriceStale();
    error OraclePriceInvalid();
    error InvalidTerm();
    error ZeroAmount();
    error PositionClosed();
    error PositionNotLiquidatable();
    error Unauthorized();
    error ZeroAddress();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address _liquidityPool, address _riskEngine) {
        if (_liquidityPool == address(0)) revert ZeroAddress();
        admin = msg.sender;
        liquidityPool = LiquidityPool(_liquidityPool);
        stablecoin = liquidityPool.stablecoin();
        riskEngine = IRiskEngine(_riskEngine);
    }

    function setRiskEngine(address _riskEngine) external onlyAdmin {
        if (_riskEngine == address(0)) revert ZeroAddress();
        riskEngine = IRiskEngine(_riskEngine);
        emit RiskEngineUpdated(_riskEngine);
    }

    /**
     * @notice Configure or whitelist an equity collateral token with its Chainlink oracle.
     */
    function whitelistAsset(
        address asset,
        address oracle,
        uint256 stalenessThreshold
    ) external onlyAdmin {
        if (asset == address(0) || oracle == address(0)) revert ZeroAddress();
        assetConfigs[asset] = AssetConfig({
            isWhitelisted: true,
            oracleAddress: oracle,
            stalenessThreshold: stalenessThreshold
        });
        emit AssetWhitelisted(asset, oracle, stalenessThreshold);
    }

    /**
     * @notice Get live price and validate freshness from oracle feed.
     */
    function getAssetPriceUSD(address asset) public view returns (uint256) {
        AssetConfig memory config = assetConfigs[asset];
        if (!config.isWhitelisted) revert AssetNotWhitelisted();

        IPriceOracle oracle = IPriceOracle(config.oracleAddress);
        (, int256 price,, uint256 updatedAt,) = oracle.latestRoundData();

        if (price <= 0) revert OraclePriceInvalid();
        if (block.timestamp > updatedAt + config.stalenessThreshold) revert OraclePriceStale();

        // casting to uint256 is safe because price > 0 was verified above
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(price);
    }

    /**
     * @notice Convert collateral amount (18 decimals) to USDC value (6 decimals) based on 8-decimal oracle price.
     */
    function getCollateralValueUSDC(address asset, uint256 amount) public view returns (uint256) {
        uint256 price8 = getAssetPriceUSD(asset);
        // (amount (18 decimals) * price8 (8 decimals)) / 10**20 => value in 6 decimals (USDC)
        return (amount * price8) / 1e20;
    }

    /**
     * @notice Calculate fixed interest based on term (in basis points of principal).
     * @dev Overnight (1 day): 3 bps; 7 days: 15 bps; 30 days: 60 bps.
     */
    function calculateFixedInterest(uint256 principal, uint8 termDays) public pure returns (uint256) {
        if (termDays == 1) {
            return (principal * 3) / BPS_DIVISOR;
        } else if (termDays == 7) {
            return (principal * 15) / BPS_DIVISOR;
        } else if (termDays == 30) {
            return (principal * 60) / BPS_DIVISOR;
        } else {
            revert InvalidTerm();
        }
    }

    /**
     * @notice Opens a fixed-term repo position.
     * @param asset The tokenized equity asset address (must be whitelisted).
     * @param collateralAmount Amount of equity collateral to deposit (18 decimals).
     * @param termDays Fixed duration (1, 7, or 30 days).
     * @return positionId The identifier of the created position.
     */
    function openPosition(
        address asset,
        uint256 collateralAmount,
        uint8 termDays
    ) external nonReentrant returns (uint256 positionId) {
        if (collateralAmount == 0) revert ZeroAmount();
        if (termDays != 1 && termDays != 7 && termDays != 30) revert InvalidTerm();
        if (!assetConfigs[asset].isWhitelisted) revert AssetNotWhitelisted();

        // 1. Fetch Dynamic Max LTV from Stylus Risk Engine
        uint256 dynamicMaxLtv = riskEngine.getMaxLTV(asset, termDays);

        // Clamp to protocol initial margin limits (20% to 80%)
        if (dynamicMaxLtv > HARD_CAP_MAX_LTV) {
            dynamicMaxLtv = HARD_CAP_MAX_LTV;
        } else if (dynamicMaxLtv < HARD_FLOOR_MIN_LTV) {
            dynamicMaxLtv = HARD_FLOOR_MIN_LTV;
        }

        // 2. Compute collateral value and max borrow amount in USDC
        uint256 collateralValUSDC = getCollateralValueUSDC(asset, collateralAmount);
        uint256 borrowPrincipal = (collateralValUSDC * dynamicMaxLtv) / BPS_DIVISOR;
        if (borrowPrincipal == 0) revert ZeroAmount();

        uint256 fixedInterest = calculateFixedInterest(borrowPrincipal, termDays);
        uint256 maturityAt = block.timestamp + (uint256(termDays) * 1 days);

        positionId = nextPositionId++;
        positions[positionId] = Position({
            id: positionId,
            borrower: msg.sender,
            collateralAsset: asset,
            collateralAmount: collateralAmount,
            borrowedPrincipal: borrowPrincipal,
            fixedInterest: fixedInterest,
            termDays: termDays,
            openedAt: block.timestamp,
            maturityAt: maturityAt,
            maxLtvBps: dynamicMaxLtv,
            isClosed: false
        });

        emit PositionOpened(
            positionId,
            msg.sender,
            asset,
            collateralAmount,
            borrowPrincipal,
            fixedInterest,
            termDays,
            dynamicMaxLtv,
            maturityAt
        );

        // 3. Custody Collateral from Borrower
        IERC20(asset).safeTransferFrom(msg.sender, address(this), collateralAmount);

        // 4. Disburse Stablecoin from LiquidityPool to Borrower
        liquidityPool.borrowStablecoin(msg.sender, borrowPrincipal);
    }

    /**
     * @notice Repay loan principal + interest and reclaim collateral.
     * @param positionId The position to settle.
     */
    function repay(uint256 positionId) external nonReentrant {
        Position storage pos = positions[positionId];
        if (pos.isClosed) revert PositionClosed();
        if (msg.sender != pos.borrower) revert Unauthorized();

        pos.isClosed = true;
        uint256 totalDebt = pos.borrowedPrincipal + pos.fixedInterest;

        emit PositionRepaid(positionId, pos.borrower, totalDebt);

        // Transfer stablecoin from borrower to LiquidityPool via RepoVault
        stablecoin.safeTransferFrom(msg.sender, address(this), totalDebt);
        stablecoin.forceApprove(address(liquidityPool), totalDebt);
        liquidityPool.returnStablecoin(pos.borrowedPrincipal, pos.fixedInterest);

        // Return collateral to borrower
        IERC20(pos.collateralAsset).safeTransfer(pos.borrower, pos.collateralAmount);
    }

    /**
     * @notice Inspect health of an active position.
     * @return currentLtvBps Live LTV in basis points (e.g. 7200 = 72.00%).
     * @return liquidationThresholdBps Maintenance threshold before liquidation (Max LTV + 5.00% buffer).
     * @return isLiquidatable True if position can be liquidated.
     */
    function getPositionHealth(uint256 positionId)
        public
        view
        returns (
            uint256 currentLtvBps,
            uint256 liquidationThresholdBps,
            bool isLiquidatable
        )
    {
        Position memory pos = positions[positionId];
        if (pos.isClosed) {
            return (0, 0, false);
        }

        liquidationThresholdBps = pos.maxLtvBps + MAINTENANCE_BUFFER_BPS;
        uint256 collateralValUSDC = getCollateralValueUSDC(pos.collateralAsset, pos.collateralAmount);
        uint256 totalDebt = pos.borrowedPrincipal + pos.fixedInterest;

        if (collateralValUSDC == 0) {
            currentLtvBps = type(uint256).max;
            isLiquidatable = true;
        } else {
            currentLtvBps = (totalDebt * BPS_DIVISOR) / collateralValUSDC;
            isLiquidatable = (currentLtvBps > liquidationThresholdBps) || (block.timestamp > pos.maturityAt);
        }
    }

    /**
     * @notice Permissionless liquidation of undercollateralized or expired repo positions.
     * @param positionId The position to liquidate.
     */
    function liquidate(uint256 positionId) external nonReentrant {
        Position storage pos = positions[positionId];
        if (pos.isClosed) revert PositionClosed();

        (,, bool isLiquidatable) = getPositionHealth(positionId);
        if (!isLiquidatable) revert PositionNotLiquidatable();

        pos.isClosed = true;
        uint256 totalDebt = pos.borrowedPrincipal + pos.fixedInterest;

        emit PositionLiquidated(
            positionId,
            msg.sender,
            pos.borrower,
            totalDebt,
            pos.collateralAmount
        );

        // Liquidator pays full debt (principal + interest)
        stablecoin.safeTransferFrom(msg.sender, address(this), totalDebt);
        stablecoin.forceApprove(address(liquidityPool), totalDebt);
        liquidityPool.returnStablecoin(pos.borrowedPrincipal, pos.fixedInterest);

        // Liquidator seizes 100% of the collateral position as bounty
        IERC20(pos.collateralAsset).safeTransfer(msg.sender, pos.collateralAmount);
    }
}
