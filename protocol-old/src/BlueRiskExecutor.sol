// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BlueRiskParameters as Risk} from "./generated/BlueRiskParameters.sol";
import {BlueRouter} from "./BlueRouter.sol";
import {BlueManagedCollateral} from "./BlueManagedCollateral.sol";
import {Id, MarketParams, MarketParamsLib} from "./interfaces/IMorpho.sol";

/// @notice Narrow router admin: immediate one-way tightening, delayed governance-approved changes.
///         Evidence hashes identify reviewed records; they are not a claim that the data was authenticated.
///         Oracle haircuts, market identity and LLTV cannot be changed by this executor.
contract BlueRiskExecutor {
    using MarketParamsLib for MarketParams;

    struct Update {
        uint256 chainId;
        MarketParams market;
        bytes32 expectedConfigHash;
        bytes32 evidenceHash;
        uint16 marginBps;
        uint256 totalCap;
        uint256 supplyCap;
        uint256 expectedMultiplier;
        uint256[6] regimeCaps;
        uint64 expiresAt;
        uint256 nonce;
    }

    BlueRouter public immutable ROUTER;
    address public immutable GOVERNANCE;
    uint64 public immutable DELAY;
    uint64 public constant MAX_LIFETIME = Risk.MAX_PROPOSAL_LIFETIME_SECONDS;
    mapping(bytes32 => uint256) public readyAt;
    mapping(uint256 => bool) public nonceUsed;
    mapping(bytes32 => uint256) public adminCallExpiry;
    event Scheduled(bytes32 indexed updateHash, uint256 readyAt, bytes32 evidenceHash);
    event Applied(bytes32 indexed updateHash, bytes32 resultingConfigHash);
    event Cancelled(bytes32 indexed updateHash);
    error Unauthorized();
    error InvalidUpdate();
    error StaleConfiguration();
    error NotReady();
    error NotTightening();

    constructor(BlueRouter router, address governance, address guardian, uint64 delay_) {
        if (
            address(router).code.length == 0 || governance == address(0) || guardian == address(0)
                || governance == guardian || router.guardian() != guardian || delay_ < 1 hours || delay_ >= MAX_LIFETIME
        ) revert InvalidUpdate();
        ROUTER = router;
        GOVERNANCE = governance;
        DELAY = delay_;
    }

    /// Router guardian rotation also revokes this executor's old guardian authority.
    function GUARDIAN() public view returns (address) {
        return ROUTER.guardian();
    }

    function acceptRouterAdmin() external {
        if (msg.sender != GOVERNANCE) revert Unauthorized();
        ROUTER.acceptAdmin();
    }

    function configHash(Id id) public view returns (bytes32) {
        return keccak256(abi.encode(ROUTER.configVersion(id), ROUTER.marketConfig(id)));
    }

    function updateHash(Update calldata u) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), address(ROUTER), u));
    }

    function schedule(Update calldata u) external {
        if (msg.sender != GOVERNANCE) revert Unauthorized();
        _validate(u);
        bytes32 digest = updateHash(u);
        if (readyAt[digest] != 0 || u.expiresAt <= block.timestamp + DELAY) revert InvalidUpdate();
        readyAt[digest] = block.timestamp + DELAY;
        emit Scheduled(digest, readyAt[digest], u.evidenceHash);
    }

    function cancel(bytes32 digest) external {
        if (msg.sender != GOVERNANCE && msg.sender != GUARDIAN()) revert Unauthorized();
        delete readyAt[digest];
        emit Cancelled(digest);
    }

    /// Operational recovery remains possible after this contract becomes router admin. Only the listed
    /// administrative selectors are supported, always through the governance delay and an expiring queue.
    function scheduleAdminCall(bytes calldata data, uint256 nonce) external returns (bytes32 digest) {
        if (msg.sender != GOVERNANCE) revert Unauthorized();
        bytes4 selector = bytes4(data[:4]);
        if (
            selector != BlueRouter.setSigner.selector && selector != BlueRouter.setGuardian.selector
                && selector != BlueRouter.unpause.selector && selector != BlueRouter.transferAdmin.selector
        ) {
            revert InvalidUpdate();
        }
        digest = keccak256(abi.encode("ADMIN", block.chainid, address(this), data, nonce));
        if (readyAt[digest] != 0 || adminCallExpiry[digest] != 0) revert InvalidUpdate();
        readyAt[digest] = block.timestamp + DELAY;
        adminCallExpiry[digest] = block.timestamp + MAX_LIFETIME;
        emit Scheduled(digest, readyAt[digest], bytes32(0));
    }

    function executeAdminCall(bytes calldata data, uint256 nonce) external {
        bytes32 digest = keccak256(abi.encode("ADMIN", block.chainid, address(this), data, nonce));
        if (readyAt[digest] == 0 || block.timestamp < readyAt[digest] || block.timestamp >= adminCallExpiry[digest]) {
            revert NotReady();
        }
        delete readyAt[digest];
        // Keep the expiry as a consumed marker. A cancelled operation needs a new nonce.
        (bool ok, bytes memory result) = address(ROUTER).call(data);
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        emit Applied(digest, bytes32(0));
    }

    function execute(Update calldata u) external {
        bytes32 digest = updateHash(u);
        uint256 ready = readyAt[digest];
        if (ready == 0 || block.timestamp < ready) revert NotReady();
        _validate(u);
        delete readyAt[digest];
        _apply(u, digest);
    }

    function tighten(Update calldata u) external {
        if (msg.sender != GUARDIAN() && msg.sender != GOVERNANCE) revert Unauthorized();
        _validate(u);
        BlueRouter.MarketConfig memory current = ROUTER.marketConfig(u.market.id());
        if (u.marginBps < current.marginBps || u.totalCap > current.totalCap) revert NotTightening();
        if (u.supplyCap > BlueManagedCollateral(u.market.collateralToken).supplyCap()) revert NotTightening();
        for (uint256 i; i < 6; ++i) {
            if (u.regimeCaps[i] > current.regimeCaps[i]) revert NotTightening();
        }
        _apply(u, updateHash(u));
    }

    function _validate(Update calldata u) internal view {
        if (
            u.chainId != block.chainid || u.evidenceHash == bytes32(0) || nonceUsed[u.nonce]
                || u.expiresAt <= block.timestamp || u.expiresAt > block.timestamp + MAX_LIFETIME
                || !ROUTER.marketConfig(u.market.id()).listed || !ROUTER.marketConfig(u.market.id()).managed
        ) revert InvalidUpdate();
        if (
            configHash(u.market.id()) != u.expectedConfigHash
                || BlueManagedCollateral(u.market.collateralToken).uiMultiplier() != u.expectedMultiplier
        ) revert StaleConfiguration();
    }

    function _apply(Update calldata u, bytes32 digest) internal {
        nonceUsed[u.nonce] = true;
        ROUTER.setMargin(u.market, u.marginBps);
        ROUTER.setCaps(u.market.id(), u.totalCap, u.regimeCaps);
        ROUTER.setSupplyCap(u.market, u.supplyCap);
        BlueRouter.MarketConfig memory applied = ROUTER.marketConfig(u.market.id());
        if (
            applied.marginBps != u.marginBps || applied.totalCap != u.totalCap
                || BlueManagedCollateral(u.market.collateralToken).supplyCap() != u.supplyCap
                || keccak256(abi.encode(applied.regimeCaps)) != keccak256(abi.encode(u.regimeCaps))
        ) revert InvalidUpdate();
        emit Applied(digest, configHash(u.market.id()));
    }
}
