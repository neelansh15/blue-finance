// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {IMarketCalendar} from "./interfaces/IMarketCalendar.sol";
import {IPoolAddressesProvider} from "aave/interfaces/IPoolAddressesProvider.sol";
import {StockPriceSource} from "./StockPriceSource.sol";

contract StockBorrowControls is EIP712 {
    bytes32 public constant ELIGIBILITY_TYPEHASH =
        keccak256("Eligibility(address account,address pool,address stock,uint256 nonce,uint256 expiry)");
    uint256 private constant BPS = 10_000;

    struct Policy {
        StockPriceSource source;
        uint16 baseLtv;
        uint16[4] discounts;
        uint128[4] caps;
        uint64 healthySince;
        uint64 lastReport;
        bool held;
    }

    address public immutable admin;
    address public immutable keeper;
    address public immutable guardian;
    address public immutable signer;
    IPoolAddressesProvider public immutable provider;
    IMarketCalendar public immutable calendar;
    StockPriceSource public immutable debtPrice;
    uint32 public immutable heartbeat;
    uint32 public immutable recovery;
    uint32 public immutable maxEligibility;

    mapping(address stock => Policy) private _policies;
    mapping(address account => uint256) public nonces;
    mapping(address account => mapping(address stock => uint256)) public eligibleUntil;

    error Unauthorized();
    error InvalidPolicy();
    error UnknownStock();
    error NewRiskBlocked(address stock);
    error Ineligible(address account, address stock);
    error InvalidEligibility();

    event StockConfigured(address indexed stock);
    event HealthReported(address indexed stock, bool healthy, uint64 lastReport);
    event HoldSet(address indexed stock, bool held);
    event CapsSet(address indexed stock, uint128[4] caps);
    event EligibilityRegistered(address indexed account, address indexed stock, uint256 expiry);

    constructor(
        address admin_,
        address keeper_,
        address guardian_,
        address signer_,
        IPoolAddressesProvider provider_,
        IMarketCalendar calendar_,
        StockPriceSource debtPrice_,
        uint32 heartbeat_,
        uint32 recovery_,
        uint32 maxEligibility_
    ) EIP712("Blue Stock Borrow Controls", "1") {
        if (
            admin_ == address(0) || keeper_ == address(0) || guardian_ == address(0) || signer_ == address(0)
                || address(provider_) == address(0) || address(calendar_) == address(0)
                || address(debtPrice_) == address(0) || heartbeat_ == 0 || maxEligibility_ == 0
        ) revert InvalidPolicy();
        admin = admin_;
        keeper = keeper_;
        guardian = guardian_;
        signer = signer_;
        provider = provider_;
        calendar = calendar_;
        debtPrice = debtPrice_;
        heartbeat = heartbeat_;
        recovery = recovery_;
        maxEligibility = maxEligibility_;
    }

    function configureStock(
        address stock,
        StockPriceSource source,
        uint16 baseLtv,
        uint16[4] calldata discounts,
        uint128[4] calldata caps
    ) external {
        if (msg.sender != admin) revert Unauthorized();
        if (
            stock == address(0) || address(source.stock()) != stock || address(_policies[stock].source) != address(0)
                || baseLtv == 0 || baseLtv >= BPS
        ) revert InvalidPolicy();

        Policy storage policy = _policies[stock];
        policy.source = source;
        policy.baseLtv = baseLtv;
        for (uint256 i; i < 4; ++i) {
            if (discounts[i] > BPS || (i != 0 && discounts[i] < discounts[i - 1])) revert InvalidPolicy();
        }
        policy.discounts = discounts;
        policy.caps = caps;
        emit StockConfigured(stock);
        emit CapsSet(stock, caps);
    }

    function setCaps(address stock, uint128[4] calldata caps) external {
        if (msg.sender != admin && msg.sender != guardian) revert Unauthorized();
        Policy storage policy = _policy(stock);
        if (msg.sender == guardian) {
            for (uint256 i; i < 4; ++i) {
                if (caps[i] > policy.caps[i]) revert InvalidPolicy();
            }
        }
        policy.caps = caps;
        emit CapsSet(stock, caps);
    }

    function setHold(address stock, bool held) external {
        if (msg.sender != admin && (msg.sender != guardian || !held)) revert Unauthorized();
        Policy storage policy = _policy(stock);
        policy.held = held;
        policy.healthySince = 0;
        policy.lastReport = 0;
        emit HoldSet(stock, held);
    }

    /// @notice A gap longer than the heartbeat starts the recovery window again.
    function report(address stock, bool healthy) external {
        if (msg.sender != keeper) revert Unauthorized();
        Policy storage policy = _policy(stock);
        if (!healthy) {
            policy.healthySince = 0;
            policy.lastReport = 0;
        } else {
            if (policy.held || !_fresh(stock, policy)) revert NewRiskBlocked(stock);
            if (
                policy.lastReport == 0 || block.timestamp - policy.lastReport >= heartbeat
                    || policy.lastReport < _lastRestrictionEnd(stock)
            ) {
                policy.healthySince = uint64(block.timestamp);
            }
            policy.lastReport = uint64(block.timestamp);
        }
        emit HealthReported(stock, healthy, policy.lastReport);
    }

    function registerEligibility(address stock, uint256 expiry, bytes calldata signature) external {
        _policy(stock);
        if (expiry <= block.timestamp || expiry - block.timestamp > maxEligibility) revert InvalidEligibility();
        uint256 nonce = nonces[msg.sender]++;
        if (ECDSA.recover(eligibilityDigest(msg.sender, stock, nonce, expiry), signature) != signer) {
            revert InvalidEligibility();
        }
        eligibleUntil[msg.sender][stock] = expiry;
        emit EligibilityRegistered(msg.sender, stock, expiry);
    }

    function eligibilityDigest(address account, address stock, uint256 nonce, uint256 expiry)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(ELIGIBILITY_TYPEHASH, account, provider.getPool(), stock, nonce, expiry))
        );
    }

    function checkBorrow(address account, address stock) external view returns (uint256 ltv, uint256 cap) {
        if (eligibleUntil[account][stock] <= block.timestamp) revert Ineligible(account, stock);
        return riskLimits(stock);
    }

    function riskLimits(address stock) public view returns (uint256 ltv, uint256 cap) {
        Policy storage policy = _policy(stock);
        if (
            policy.held || policy.lastReport == 0 || block.timestamp - policy.lastReport >= heartbeat
                || block.timestamp - policy.healthySince < recovery || !_fresh(stock, policy)
                || policy.lastReport < _lastRestrictionEnd(stock)
        ) revert NewRiskBlocked(stock);
        uint256 marketStatus = uint256(calendar.status(stock));
        return (uint256(policy.baseLtv) * (BPS - policy.discounts[marketStatus]) / BPS, policy.caps[marketStatus]);
    }

    /// @notice LTV that a withdrawal or aToken transfer must respect while the account has debt.
    /// @dev Following Zona, a lapse in monitoring or a borrow-stale price does not block withdrawals. The pool's
    ///      oracle still requires a valid valuation price. A guardian hold, halt or corporate action blocks them.
    function withdrawLimit(address stock) external view returns (uint256 ltv) {
        Policy storage policy = _policy(stock);
        uint256 marketStatus = uint256(calendar.status(stock));
        if (policy.held || marketStatus >= 4) revert NewRiskBlocked(stock);
        return uint256(policy.baseLtv) * (BPS - policy.discounts[marketStatus]) / BPS;
    }

    function _fresh(address stock, Policy storage policy) private view returns (bool) {
        return uint256(calendar.status(stock)) < 4 && policy.source.usableForBorrow() && debtPrice.usableForBorrow();
    }

    function _lastRestrictionEnd(address stock) private view returns (uint64) {
        (IMarketCalendar.MarketStatus state, uint64 expiry) = calendar.overrideOf(stock);
        (IMarketCalendar.MarketStatus globalState, uint64 globalExpiry) = calendar.overrideOf(address(0));
        if (uint256(state) < 4) expiry = 0;
        if (uint256(globalState) < 4) globalExpiry = 0;
        return expiry > globalExpiry ? expiry : globalExpiry;
    }

    function _policy(address stock) private view returns (Policy storage policy) {
        policy = _policies[stock];
        if (address(policy.source) == address(0)) revert UnknownStock();
    }
}
