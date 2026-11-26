// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMorpho, Id, MarketParams, MarketParamsLib} from "../src/interfaces/IMorpho.sol";
import {DawnOracle} from "../src/DawnOracle.sol";
import {DawnRouter} from "../src/DawnRouter.sol";
import {RegimeRegistry} from "../src/RegimeRegistry.sol";
import {MockAtlasFeed} from "../src/mocks/MockAtlasFeed.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";

interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title DawnDeploy
/// @notice Shared deployment logic for script/Deploy.s.sol and the fork scenario tests (test/scenarios).
///         Uses no cheatcodes, so the same code runs under vm.startBroadcast and inside a test. Every call is made
///         from this contract's execution context: under broadcast that is the deployer EOA, in a test it is the
///         test contract. `p.deployer` must be that address (it becomes admin and mock owner).
///
///         ALL RISK PARAMETERS BELOW ARE PLACEHOLDERS, identical to the labelled placeholders in
///         frontend/src/lib/dawn/params.ts. They are not calibrated (see architecture-v1.md §13).
abstract contract DawnDeploy {
    using MarketParamsLib for MarketParams;

    // BNB Chain (chain id 56). Verified on a fork by test/fork/MorphoBnbFork.t.sol.
    address internal constant MORPHO = 0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a;
    address internal constant IRM = 0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979; // AdaptiveCurveIrm
    address internal constant USDT = 0x55d398326f99059fF775485246999027B3197955; // BSC-USD, 18 decimals
    uint256 internal constant LLTV = 0.625e18;

    // PLACEHOLDER haircuts (bps), index = Regime: OPEN, EXTENDED, CLOSED, WEEKEND, HALTED, CORP_ACTION.
    // Same values as frontend params.ts: 0, 4%, 10%, 15%, 25%, 10%.
    uint16 internal constant H_OPEN = 0;
    uint16 internal constant H_EXTENDED = 400;
    uint16 internal constant H_CLOSED = 1000;
    uint16 internal constant H_WEEKEND = 1500;
    uint16 internal constant H_HALTED = 2500;
    uint16 internal constant H_CORP_ACTION = 1000;
    uint16 internal constant MARGIN_BPS = 200; // PLACEHOLDER 2%, frontend params.ts
    uint16 internal constant CONTINUITY_BAND_BPS = 500; // PLACEHOLDER 5%, frontend params.ts
    // PLACEHOLDERS not in the frontend: staleness, freeze bounds, jump band.
    uint32 internal constant JUMP_BAND_BPS = 3000; // upward jumps above +30% are held
    uint64 internal constant MAX_FREEZE = 12 hours;
    uint16 internal constant EXPIRED_FREEZE_HAIRCUT_BPS = 1000;
    uint64 internal constant MAX_OVERRIDE = 3 days;
    uint256 internal constant MAX_ATTESTATION_TTL = 15 minutes;

    /// Public demo signer key. NOT A SECRET: anyone can sign eligibility attestations with it. Demo only.
    uint256 internal constant DEMO_SIGNER_KEY = uint256(keccak256("dawn.demo.eligibility.signer"));

    struct DeployParams {
        address deployer; // admin of registry and router, owner of the mocks, supplies the seed liquidity
        address keeper; // registry keeper (overrides)
        address signer; // eligibility attestation signer
        address guardian; // router guardian (pause, lower caps)
        uint256 seedSupply; // USDT supplied to the market by the deployer; 0 skips
        int256 initialPrice; // mock feed answer, 8 decimals, per UI share
    }

    struct Deployment {
        RegimeRegistry registry;
        MockAtlasFeed feed;
        MockBStock bStock;
        DawnOracle oracle;
        DawnRouter router;
        MarketParams marketParams;
        Id marketId;
    }

    function _deployDawn(DeployParams memory p) internal returns (Deployment memory d) {
        d.registry = new RegimeRegistry(p.deployer, p.keeper, MAX_OVERRIDE, false);
        d.registry.setHolidays(_nyseHolidays(), true);
        d.registry.setEarlyCloses(_nyseEarlyCloses(), true);

        d.bStock = new MockBStock("Mock bStock AAPL", "bAAPL");
        d.feed = new MockAtlasFeed(8, p.initialPrice);
        d.oracle = new DawnOracle(_oracleConfig(address(d.feed), address(d.registry), address(d.bStock)));

        d.marketParams = MarketParams({
            loanToken: USDT, collateralToken: address(d.bStock), oracle: address(d.oracle), irm: IRM, lltv: LLTV
        });
        d.marketId = d.marketParams.id();
        IMorpho(MORPHO).createMarket(d.marketParams);

        d.router = new DawnRouter(MORPHO, address(d.registry), p.deployer, p.signer, MAX_ATTESTATION_TTL);
        d.router.listMarket(d.marketParams, MARGIN_BPS, _totalCap(), _regimeCaps());
        if (p.guardian != address(0)) d.router.setGuardian(p.guardian);

        if (p.seedSupply != 0) {
            IERC20Approve(USDT).approve(MORPHO, p.seedSupply);
            IMorpho(MORPHO).supply(d.marketParams, p.seedSupply, 0, p.deployer, "");
        }
    }

    function _oracleConfig(address feed, address registry, address asset)
        internal
        pure
        returns (DawnOracle.Config memory c)
    {
        c.atlasFeed = feed;
        c.registry = registry;
        c.asset = asset;
        c.loanDecimals = 18;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.feedPerUIShare = true; // [U] Atlas units unverified; the mock is per UI share
        c.haircutsBps = [H_OPEN, H_EXTENDED, H_CLOSED, H_WEEKEND, H_HALTED, H_CORP_ACTION];
        c.stalenessSec = [uint32(1 hours), 1 hours, 4 hours, 6 hours, 1 hours, 1 hours]; // PLACEHOLDER
        c.maxFreeze = MAX_FREEZE;
        c.continuityBandBps = CONTINUITY_BAND_BPS;
        c.expiredFreezeHaircutBps = EXPIRED_FREEZE_HAIRCUT_BPS;
        c.jumpBandBps = JUMP_BAND_BPS;
    }

    /// PLACEHOLDER caps on market totalBorrowAssets (USDT, 18 decimals). HALTED/CORP_ACTION are blocked anyway.
    function _totalCap() internal pure returns (uint256) {
        return 1_000_000e18;
    }

    function _regimeCaps() internal pure returns (uint256[6] memory) {
        return [uint256(1_000_000e18), 500_000e18, 250_000e18, 250_000e18, 0, 0];
    }

    /// NYSE full-day closures 2026-2027, from https://www.nyse.com/markets/hours-calendars (fetched 2026-11-26).
    function _nyseHolidays() internal pure returns (uint32[] memory h) {
        h = new uint32[](20);
        (h[0], h[1], h[2], h[3], h[4]) = (20260101, 20260119, 20260216, 20260403, 20260525);
        (h[5], h[6], h[7], h[8], h[9]) = (20260619, 20260703, 20260907, 20261126, 20261225);
        (h[10], h[11], h[12], h[13], h[14]) = (20270101, 20270118, 20270215, 20270326, 20270531);
        (h[15], h[16], h[17], h[18], h[19]) = (20270618, 20270705, 20270906, 20271125, 20271224);
    }

    /// NYSE 1:00 pm early closes 2026-2027 (same source and date).
    function _nyseEarlyCloses() internal pure returns (uint32[] memory e) {
        e = new uint32[](3);
        (e[0], e[1], e[2]) = (20261127, 20261224, 20271126);
    }
}
