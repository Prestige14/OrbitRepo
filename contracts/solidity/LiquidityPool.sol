// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LiquidityPool
 * @notice Fixed-term Repo Liquidity Pool for stablecoins (USDC).
 * @dev Manages LP deposits, withdrawals, share accounting, and lending to RepoVault.
 */
contract LiquidityPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stablecoin;
    address public repoVault;
    address public admin;

    uint256 public totalBorrowed;
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    event Deposit(address indexed lp, uint256 amount, uint256 shares);
    event Withdraw(address indexed lp, uint256 amount, uint256 shares);
    event StablecoinBorrowed(address indexed recipient, uint256 amount);
    event StablecoinReturned(uint256 principal, uint256 interest);
    event BadDebtAdjusted(uint256 badDebtAmount);
    event RepoVaultUpdated(address indexed newVault);

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientLiquidity();
    error InsufficientShares();

    modifier onlyVault() {
        if (msg.sender != repoVault) revert Unauthorized();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address _stablecoin) {
        if (_stablecoin == address(0)) revert ZeroAddress();
        stablecoin = IERC20(_stablecoin);
        admin = msg.sender;
    }

    function setRepoVault(address _repoVault) external onlyAdmin {
        if (_repoVault == address(0)) revert ZeroAddress();
        repoVault = _repoVault;
        emit RepoVaultUpdated(_repoVault);
    }

    /**
     * @notice Total assets managed by the pool (idle cash + active loans).
     */
    function totalAssets() public view returns (uint256) {
        return stablecoin.balanceOf(address(this)) + totalBorrowed;
    }

    /**
     * @notice Available unborrowed stablecoin in the pool.
     */
    function availableLiquidity() public view returns (uint256) {
        return stablecoin.balanceOf(address(this));
    }

    /**
     * @notice Deposit stablecoin into pool and receive proportional LP shares.
     * @param amount Amount of stablecoin to deposit.
     * @return shares Minted LP shares.
     */
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();

        uint256 assetsBefore = totalAssets();
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        if (totalShares == 0 || assetsBefore == 0) {
            shares = amount;
        } else {
            shares = (amount * totalShares) / assetsBefore;
        }

        sharesOf[msg.sender] += shares;
        totalShares += shares;

        emit Deposit(msg.sender, amount, shares);
    }

    /**
     * @notice Withdraw stablecoin by burning LP shares.
     * @param shares Amount of shares to redeem.
     * @return amount Amount of stablecoin returned to LP.
     */
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (sharesOf[msg.sender] < shares) revert InsufficientShares();

        amount = (shares * totalAssets()) / totalShares;
        if (amount > availableLiquidity()) revert InsufficientLiquidity();

        sharesOf[msg.sender] -= shares;
        totalShares -= shares;

        stablecoin.safeTransfer(msg.sender, amount);
        emit Withdraw(msg.sender, amount, shares);
    }

    /**
     * @notice Borrows stablecoin for a repo borrower. Called exclusively by RepoVault.
     */
    function borrowStablecoin(address recipient, uint256 amount) external nonReentrant onlyVault {
        if (amount > availableLiquidity()) revert InsufficientLiquidity();

        totalBorrowed += amount;
        stablecoin.safeTransfer(recipient, amount);

        emit StablecoinBorrowed(recipient, amount);
    }

    /**
     * @notice Returns borrowed stablecoin plus accrued repo yield. Called exclusively by RepoVault.
     * @dev The interest component naturally increases totalAssets(), rewarding all share holders.
     */
    function returnStablecoin(uint256 principal, uint256 interest) external nonReentrant onlyVault {
        if (principal > totalBorrowed) {
            totalBorrowed = 0;
        } else {
            totalBorrowed -= principal;
        }

        // RepoVault transfers principal + interest from borrower or liquidation proceeds
        stablecoin.safeTransferFrom(msg.sender, address(this), principal + interest);
        emit StablecoinReturned(principal, interest);
    }

    /**
     * @notice In extreme liquidation shortfalls, adjusts totalBorrowed.
     */
    function adjustBadDebt(uint256 badDebtAmount) external nonReentrant onlyVault {
        if (badDebtAmount >= totalBorrowed) {
            totalBorrowed = 0;
        } else {
            totalBorrowed -= badDebtAmount;
        }
        emit BadDebtAdjusted(badDebtAmount);
    }
}
