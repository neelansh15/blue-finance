// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMorpho, Id, MarketParams, MarketParamsLib} from "./interfaces/IMorpho.sol";
import {IBlueOracle} from "./interfaces/IBlueOracle.sol";
import {IRegimeRegistry, RegimeLib} from "./interfaces/IRegimeRegistry.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

/// @title BlueRouter
/// @notice Borrow front door for Blue markets on an unmodified Morpho Blue. Users authorize the router once with
///         MORPHO.setAuthorization(router, true); the router then supplies collateral, borrows and withdraws
///         collateral on their behalf, and only ever for msg.sender.
///
///         Borrow limit: debt <= collateral x oracle.price() x targetLTV, where
///             targetLTV = LLTV x (1 - h_max) - margin,  h_max = max haircut over OPEN, EXTENDED, CLOSED, WEEKEND.
///         oracle.price() already carries the current regime's haircut. A position opened at the limit in any
///         routine regime therefore stays healthy on Morpho when the regime moves to any other routine regime at an
///         unchanged feed price: debt <= C x P x LLTV x (1 - h_max) <= C x P x (1 - h_r) x LLTV for every routine r.
///         NOT covered: HALTED or the expired-freeze haircut if larger than h_max, and real price moves.
///
///         Gates: borrow and withdraw-with-debt are blocked in HALTED and CORP_ACTION, while the oracle is frozen
///         or the feed is stale, and while paused. Borrowing needs a fresh EIP-712 eligibility attestation from
///         the configured signer (short expiry, single-use nonce). Borrowing is capped per market (one listed market
///         per collateral asset, so per asset) and per regime, against Morpho's market-wide totalBorrowAssets.
///         Supplying collateral and repaying are always allowed (they only make positions safer).
///
/// @dev    BYPASSABLE. Morpho Blue is permissionless: anyone can call MORPHO.borrow / withdrawCollateral directly on
///         the same market and ignore every rule here (eligibility, targetLTV, caps, regime blocks). Only the oracle
///         and Morpho's LLTV bind such users. Making the router binding needs a collateral wrapper that only the
///         router can deposit, which is out of scope for the demo. Treat the router as UX and policy for honest
///         users, not as a security boundary for the market.
contract BlueRouter {
    using MarketParamsLib for MarketParams;
    using RegimeLib for IRegimeRegistry.Regime;
    using SafeTransferLib for address;

    struct MarketConfig {
        bool listed;
        uint16 marginBps;
        uint16 hMaxBps; // max oracle haircut over the routine regimes, cached at listing (oracle haircuts are immutable)
        uint256 targetLtvWad; // LLTV x (1 - hMax) - margin, 1e18 scale
        uint256 totalCap; // max market totalBorrowAssets after a router borrow
        uint256[6] regimeCaps; // same, per regime (indexed by Regime); 0 disables router borrowing in that regime
    }

    struct Attestation {
        uint256 nonce;
        uint256 expiry;
        bytes signature; // 65-byte r || s || v
    }

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;
    uint256 internal constant VIRTUAL_SHARES = 1e6; // Morpho SharesMathLib
    uint256 internal constant VIRTUAL_ASSETS = 1;
    uint256 public constant MAX_MARGIN_BPS = 5000;
    uint256 public constant HARD_MAX_ATTESTATION_TTL = 1 hours;
    uint256 internal constant SECP256K1_HALF_N = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 public constant ELIGIBILITY_TYPEHASH =
        keccak256("Eligibility(address account,uint256 nonce,uint256 expiry)");
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("BlueRouter");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    IMorpho public immutable MORPHO;
    IRegimeRegistry public immutable REGISTRY;
    uint256 public immutable MAX_ATTESTATION_TTL;
    uint256 internal immutable INITIAL_CHAIN_ID;
    bytes32 internal immutable INITIAL_DOMAIN_SEPARATOR;

    address public admin;
    address public pendingAdmin;
    address public guardian;
    address public signer;
    bool public paused;

    mapping(Id => MarketConfig) internal _markets;
    mapping(address => Id) public marketOfCollateral;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    uint256 internal _lock = 1;
    address internal _payer; // set only during repay()

    event MarketListed(Id indexed id, address indexed collateral, uint256 targetLtvWad, uint16 hMaxBps, uint16 marginBps);
    event MarginSet(Id indexed id, uint16 marginBps, uint256 targetLtvWad);
    event CapsSet(Id indexed id, uint256 totalCap, uint256[6] regimeCaps);
    event SignerSet(address indexed signer);
    event GuardianSet(address indexed guardian);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed current);
    event AttestationUsed(address indexed account, uint256 nonce);
    event Borrowed(Id indexed id, address indexed account, uint256 collateralIn, uint256 assets, IRegimeRegistry.Regime regime);
    event CollateralWithdrawn(Id indexed id, address indexed account, uint256 assets);
    event Repaid(Id indexed id, address indexed payer, address indexed onBehalf, uint256 assets, uint256 shares);

    error Unauthorized();
    error ZeroAddress();
    error Reentrancy();
    error InvalidConfig();
    error MarketNotListed();
    error MarketAlreadyListed();
    error MarketMismatch();
    error IsPaused();
    error RegimeBlocked(IRegimeRegistry.Regime r);
    error OracleFrozen();
    error FeedUnavailable();
    error AboveTargetLtv(uint256 debt, uint256 limit);
    error CapExceeded(uint256 totalBorrow, uint256 cap);
    error AttestationExpired();
    error AttestationTooLong();
    error NonceUsed();
    error BadSignature();
    error NoSigner();
    error NotRepaying();
    error CapRaise();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address morpho, address registry, address admin_, address signer_, uint256 maxAttestationTtl) {
        if (morpho.code.length == 0 || registry.code.length == 0) revert InvalidConfig();
        if (admin_ == address(0)) revert ZeroAddress();
        if (maxAttestationTtl == 0 || maxAttestationTtl > HARD_MAX_ATTESTATION_TTL) revert InvalidConfig();
        MORPHO = IMorpho(morpho);
        REGISTRY = IRegimeRegistry(registry);
        MAX_ATTESTATION_TTL = maxAttestationTtl;
        admin = admin_;
        signer = signer_;
        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _buildDomainSeparator();
        emit AdminTransferred(address(0), admin_);
        emit SignerSet(signer_);
    }

    // ================================================================ user entry points

    /// @notice Pull `collateralAssets` of the collateral token from msg.sender, supply it to Morpho for msg.sender,
    ///         then borrow `borrowAssets` for msg.sender and send it to `receiver`.
    ///         Supplying collateral alone (borrowAssets == 0) needs no attestation and works in every regime.
    function supplyCollateralAndBorrow(
        MarketParams calldata mp,
        uint256 collateralAssets,
        uint256 borrowAssets,
        address receiver,
        Attestation calldata att
    ) external nonReentrant {
        Id id = mp.id();
        MarketConfig storage cfg = _listed(id, mp);

        if (collateralAssets != 0) {
            mp.collateralToken.safeTransferFrom(msg.sender, address(this), collateralAssets);
            mp.collateralToken.forceApprove(address(MORPHO), collateralAssets);
            MORPHO.supplyCollateral(mp, collateralAssets, msg.sender, "");
        }
        if (borrowAssets == 0) return;

        if (receiver == address(0)) revert ZeroAddress();
        _useAttestation(msg.sender, att);
        IRegimeRegistry.Regime r = _checkRiskIncreasingAllowed(mp);

        // Reverts inside Morpho if msg.sender has not authorized this router.
        MORPHO.borrow(mp, borrowAssets, 0, msg.sender, receiver);

        (uint256 totalBorrowAssets, uint256 totalBorrowShares) = _borrowTotals(id); // post-accrual
        _checkTargetLtv(cfg, mp, id, msg.sender, totalBorrowAssets, totalBorrowShares);
        if (totalBorrowAssets > cfg.totalCap) revert CapExceeded(totalBorrowAssets, cfg.totalCap);
        uint256 rc = cfg.regimeCaps[uint8(r)];
        if (totalBorrowAssets > rc) revert CapExceeded(totalBorrowAssets, rc);

        emit Borrowed(id, msg.sender, collateralAssets, borrowAssets, r);
    }

    /// @notice Withdraw msg.sender's collateral to `receiver`. With outstanding debt the position must stay within
    ///         targetLTV and the regime/oracle gates apply. With zero debt it is always allowed.
    function withdrawCollateral(MarketParams calldata mp, uint256 assets, address receiver) external nonReentrant {
        if (receiver == address(0)) revert ZeroAddress();
        Id id = mp.id();
        MarketConfig storage cfg = _listed(id, mp);

        // Borrow shares never change through interest accrual, so the gate can run before Morpho's own health check
        // (otherwise Morpho's "insufficient collateral" would mask the regime block).
        (, uint128 borrowShares,) = MORPHO.position(id, msg.sender);
        bool hasDebt = borrowShares != 0;
        if (hasDebt) _checkRiskIncreasingAllowed(mp);

        MORPHO.withdrawCollateral(mp, assets, msg.sender, receiver); // accrues interest

        if (hasDebt) {
            (uint256 tba, uint256 tbs) = _borrowTotals(id);
            _checkTargetLtv(cfg, mp, id, msg.sender, tba, tbs);
        }
        emit CollateralWithdrawn(id, msg.sender, assets);
    }

    /// @notice Repay `onBehalf`'s debt with msg.sender's loan tokens. Pass exactly one of assets / shares
    ///         (shares = full position for a complete repay). Allowed for anyone, in every regime, while paused.
    ///         The exact amount is pulled from msg.sender inside Morpho's onMorphoRepay callback.
    function repay(MarketParams calldata mp, uint256 assets, uint256 shares, address onBehalf)
        external
        nonReentrant
        returns (uint256 assetsRepaid, uint256 sharesRepaid)
    {
        Id id = mp.id();
        _listed(id, mp);
        _payer = msg.sender;
        (assetsRepaid, sharesRepaid) = MORPHO.repay(mp, assets, shares, onBehalf, abi.encode(mp.loanToken));
        _payer = address(0);
        emit Repaid(id, msg.sender, onBehalf, assetsRepaid, sharesRepaid);
    }

    /// Morpho repay callback. Only reachable from Morpho during this router's own repay() call.
    function onMorphoRepay(uint256 assets, bytes calldata data) external {
        address payer = _payer;
        if (msg.sender != address(MORPHO) || payer == address(0)) revert NotRepaying();
        address loanToken = abi.decode(data, (address));
        loanToken.safeTransferFrom(payer, address(this), assets);
        loanToken.forceApprove(address(MORPHO), assets);
    }

    // ================================================================ views

    function marketConfig(Id id) external view returns (MarketConfig memory) {
        return _markets[id];
    }

    /// targetLTV (1e18) for regime `r`: 0 where borrowing is blocked (HALTED, CORP_ACTION), else the cached value.
    function targetLtv(Id id, IRegimeRegistry.Regime r) public view returns (uint256) {
        if (r.isFreezeRegime()) return 0;
        return _markets[id].targetLtvWad;
    }

    /// Max debt (loan-token units) the router allows `account` right now: collateral x price() x targetLTV(regime).
    function borrowLimit(Id id, address account) external view returns (uint256) {
        MarketConfig storage cfg = _markets[id];
        if (!cfg.listed) return 0;
        (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) =
            MORPHO.idToMarketParams(id);
        MarketParams memory mp = MarketParams(loanToken, collateralToken, oracle, irm, lltv);
        (,, uint128 collateral) = MORPHO.position(id, account);
        return _limit(collateral, IBlueOracle(mp.oracle).price(), targetLtv(id, _regime(mp)));
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == INITIAL_CHAIN_ID ? INITIAL_DOMAIN_SEPARATOR : _buildDomainSeparator();
    }

    function eligibilityDigest(address account, uint256 nonce, uint256 expiry) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(ELIGIBILITY_TYPEHASH, account, nonce, expiry));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    // ================================================================ admin

    /// @notice List a Blue market. Checks it exists on Morpho with these exact params, that its oracle prices this
    ///         collateral off this router's registry, and caches targetLTV from the oracle's routine haircuts.
    function listMarket(MarketParams calldata mp, uint16 marginBps, uint256 totalCap, uint256[6] calldata regimeCaps)
        external
        onlyAdmin
    {
        Id id = mp.id();
        if (_markets[id].listed) revert MarketAlreadyListed();
        if (Id.unwrap(marketOfCollateral[mp.collateralToken]) != bytes32(0)) revert MarketAlreadyListed();
        _checkParams(id, mp);
        IBlueOracle o = IBlueOracle(mp.oracle);
        if (o.ASSET() != mp.collateralToken || address(o.REGISTRY()) != address(REGISTRY)) revert MarketMismatch();

        uint16 hMax;
        for (uint8 i; i < 4; ++i) {
            uint16 h = o.haircutBps(IRegimeRegistry.Regime(i));
            if (h > hMax) hMax = h;
        }
        MarketConfig storage cfg = _markets[id];
        cfg.listed = true;
        cfg.hMaxBps = hMax;
        marketOfCollateral[mp.collateralToken] = id;
        _setMargin(cfg, id, mp.lltv, marginBps);
        _setCaps(cfg, id, totalCap, regimeCaps);
        emit MarketListed(id, mp.collateralToken, cfg.targetLtvWad, hMax, marginBps);
    }

    function setMargin(MarketParams calldata mp, uint16 marginBps) external onlyAdmin {
        Id id = mp.id();
        _setMargin(_listed(id, mp), id, mp.lltv, marginBps);
    }

    function setCaps(Id id, uint256 totalCap, uint256[6] calldata regimeCaps) external onlyAdmin {
        MarketConfig storage cfg = _markets[id];
        if (!cfg.listed) revert MarketNotListed();
        _setCaps(cfg, id, totalCap, regimeCaps);
    }

    /// Guardian (or admin) may only lower caps.
    function lowerCaps(Id id, uint256 totalCap, uint256[6] calldata regimeCaps) external {
        if (msg.sender != guardian && msg.sender != admin) revert Unauthorized();
        MarketConfig storage cfg = _markets[id];
        if (!cfg.listed) revert MarketNotListed();
        if (totalCap > cfg.totalCap) revert CapRaise();
        for (uint256 i; i < 6; ++i) {
            if (regimeCaps[i] > cfg.regimeCaps[i]) revert CapRaise();
        }
        _setCaps(cfg, id, totalCap, regimeCaps);
    }

    function setSigner(address signer_) external onlyAdmin {
        signer = signer_;
        emit SignerSet(signer_);
    }

    function setGuardian(address guardian_) external onlyAdmin {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != admin) revert Unauthorized();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin; // address(0) cancels
        emit AdminTransferStarted(msg.sender, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin || msg.sender == address(0)) revert Unauthorized();
        emit AdminTransferred(admin, msg.sender);
        admin = msg.sender;
        pendingAdmin = address(0);
    }

    // ================================================================ internals

    function _listed(Id id, MarketParams calldata mp) internal view returns (MarketConfig storage cfg) {
        cfg = _markets[id];
        if (!cfg.listed) revert MarketNotListed();
        // id = keccak(params), so a listed id already pins the params; nothing else to compare.
        mp;
    }

    function _checkParams(Id id, MarketParams calldata mp) internal view {
        (address l, address c, address o, address i, uint256 lltv) = MORPHO.idToMarketParams(id);
        if (l != mp.loanToken || c != mp.collateralToken || o != mp.oracle || i != mp.irm || lltv != mp.lltv) {
            revert MarketMismatch();
        }
        if (lltv == 0 || lltv >= WAD || o.code.length == 0) revert MarketMismatch(); // also "market exists"
    }

    function _setMargin(MarketConfig storage cfg, Id id, uint256 lltv, uint16 marginBps) internal {
        if (marginBps > MAX_MARGIN_BPS) revert InvalidConfig();
        uint256 base = (lltv * (BPS - cfg.hMaxBps)) / BPS;
        uint256 m = uint256(marginBps) * 1e14;
        if (m >= base) revert InvalidConfig();
        cfg.marginBps = marginBps;
        cfg.targetLtvWad = base - m;
        emit MarginSet(id, marginBps, cfg.targetLtvWad);
    }

    function _setCaps(MarketConfig storage cfg, Id id, uint256 totalCap, uint256[6] calldata regimeCaps) internal {
        cfg.totalCap = totalCap;
        for (uint256 i; i < 6; ++i) {
            cfg.regimeCaps[i] = regimeCaps[i];
        }
        emit CapsSet(id, totalCap, regimeCaps);
    }

    function _regime(MarketParams memory mp) internal view returns (IRegimeRegistry.Regime) {
        return REGISTRY.regime(mp.collateralToken);
    }

    /// Gates shared by borrow and withdraw-with-debt. Refreshes the oracle first.
    function _checkRiskIncreasingAllowed(MarketParams calldata mp) internal returns (IRegimeRegistry.Regime r) {
        if (paused) revert IsPaused();
        r = _regime(mp);
        if (r.isFreezeRegime()) revert RegimeBlocked(r);
        IBlueOracle o = IBlueOracle(mp.oracle);
        o.update();
        if (o.isFrozen()) revert OracleFrozen();
        (bool ok,,) = o.liveRawPrice();
        if (!ok) revert FeedUnavailable(); // never extend credit against a stale fallback price
    }

    function _checkTargetLtv(
        MarketConfig storage cfg,
        MarketParams calldata mp,
        Id id,
        address account,
        uint256 totalBorrowAssets,
        uint256 totalBorrowShares
    ) internal view {
        (, uint128 borrowShares, uint128 collateral) = MORPHO.position(id, account);
        // Morpho SharesMathLib.toAssetsUp
        uint256 debt = _mulDivUp(borrowShares, totalBorrowAssets + VIRTUAL_ASSETS, totalBorrowShares + VIRTUAL_SHARES);
        uint256 limit = _limit(collateral, IBlueOracle(mp.oracle).price(), cfg.targetLtvWad);
        if (debt > limit) revert AboveTargetLtv(debt, limit);
    }

    function _limit(uint256 collateral, uint256 price, uint256 tLtv) internal pure returns (uint256) {
        // Same rounding as Morpho's health check: both steps round down.
        return (((collateral * price) / ORACLE_PRICE_SCALE) * tLtv) / WAD;
    }

    function _borrowTotals(Id id) internal view returns (uint256 tba, uint256 tbs) {
        (,, uint128 a, uint128 s,,) = MORPHO.market(id);
        return (a, s);
    }

    function _mulDivUp(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        return (x * y + (d - 1)) / d;
    }

    function _useAttestation(address account, Attestation calldata att) internal {
        address s = signer;
        if (s == address(0)) revert NoSigner();
        if (att.expiry < block.timestamp) revert AttestationExpired();
        if (att.expiry > block.timestamp + MAX_ATTESTATION_TTL) revert AttestationTooLong();
        if (nonceUsed[account][att.nonce]) revert NonceUsed();
        if (_recover(eligibilityDigest(account, att.nonce, att.expiry), att.signature) != s) revert BadSignature();
        nonceUsed[account][att.nonce] = true;
        emit AttestationUsed(account, att.nonce);
    }

    /// ecrecover with malleability checks. EOA signers only (no ERC-1271).
    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address a) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > SECP256K1_HALF_N || (v != 27 && v != 28)) revert BadSignature();
        a = ecrecover(digest, v, r, s);
        if (a == address(0)) revert BadSignature();
    }

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }
}
