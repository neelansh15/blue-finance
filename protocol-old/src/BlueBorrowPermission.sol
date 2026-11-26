// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IRegimeRegistry, RegimeLib} from "./interfaces/IRegimeRegistry.sol";

/// @notice Expiring permission for NEW exposure, independent of expiring regime overrides.
///         A keeper reports the conjunction of source health and continuity; it cannot clear an admin hold.
contract BlueBorrowPermission {
    using RegimeLib for IRegimeRegistry.Regime;

    struct Evidence {
        uint64 healthySince;
        uint64 lastProof;
        uint64 validUntil;
        bool held;
    }

    IRegimeRegistry public immutable REGISTRY;
    uint64 public immutable TTL;
    uint64 public immutable RECOVERY;
    uint64 public immutable MAX_PROOF_GAP;
    mapping(address => Evidence) public evidence;
    event ProofRecorded(address indexed asset, bool healthy, uint64 healthySince, uint64 validUntil);
    event HoldSet(address indexed asset, bool held);
    error Unauthorized();
    error InvalidConfig();

    constructor(IRegimeRegistry registry, uint64 ttl, uint64 recovery, uint64 maxProofGap) {
        if (
            address(registry).code.length == 0 || ttl == 0 || ttl > 1 hours || recovery < 5 minutes || recovery > 7 days
                || maxProofGap == 0 || maxProofGap > ttl
        ) revert InvalidConfig();
        REGISTRY = registry;
        TTL = ttl;
        RECOVERY = recovery;
        MAX_PROOF_GAP = maxProofGap;
    }

    function record(address asset, bool healthy) external {
        if (!REGISTRY.isKeeper(msg.sender) && msg.sender != REGISTRY.admin()) revert Unauthorized();
        Evidence storage e = evidence[asset];
        uint64 now_ = uint64(block.timestamp);
        healthy = healthy && !e.held && !REGISTRY.regime(asset).isFreezeRegime();
        if (!healthy) {
            e.healthySince = 0;
            e.validUntil = 0;
        } else {
            if (e.healthySince == 0 || block.timestamp > uint256(e.lastProof) + MAX_PROOF_GAP) {
                e.healthySince = now_;
                e.validUntil = 0;
            }
            if (block.timestamp >= uint256(e.healthySince) + RECOVERY) e.validUntil = now_ + TTL;
        }
        e.lastProof = now_;
        emit ProofRecorded(asset, healthy, e.healthySince, e.validUntil);
    }

    function setHold(address asset, bool held) external {
        if (msg.sender != REGISTRY.admin()) revert Unauthorized();
        evidence[asset] = Evidence(0, 0, 0, held); // releasing a hold always starts a new recovery window
        emit HoldSet(asset, held);
    }

    function allowed(address asset) external view returns (bool) {
        Evidence memory e = evidence[asset];
        return !e.held && e.validUntil > block.timestamp && e.healthySince != 0
            && block.timestamp <= uint256(e.lastProof) + MAX_PROOF_GAP && !REGISTRY.regime(asset).isFreezeRegime();
    }
}
