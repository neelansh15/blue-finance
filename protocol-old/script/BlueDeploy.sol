// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IMorpho, Id, MarketParams, MarketParamsLib} from "../src/interfaces/IMorpho.sol";
import {BlueRiskParameters as Risk} from "../src/generated/BlueRiskParameters.sol";
import {BlueManagedCollateral} from "../src/BlueManagedCollateral.sol";
import {BlueBorrowPermission} from "../src/BlueBorrowPermission.sol";
import {BlueOracle} from "../src/BlueOracle.sol";
import {BlueRouter} from "../src/BlueRouter.sol";
import {RegimeRegistry} from "../src/RegimeRegistry.sol";
import {MockAtlasFeed} from "../src/mocks/MockAtlasFeed.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";

interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

/// @title BlueDeploy
/// @notice Shared deployment logic for script/Deploy.s.sol and the fork scenario tests (test/scenarios).
///         Uses no cheatcodes, so the same code runs under vm.startBroadcast and inside a test. Every call is made
///         from this contract's execution context: under broadcast that is the deployer EOA, in a test it is the
///         test contract. `p.deployer` must be that address (it becomes admin and mock owner).
///
///         ALL RISK PARAMETERS BELOW ARE PLACEHOLDERS, identical to the labelled placeholders in
///         frontend/src/lib/blue/params.ts. They are not calibrated (see architecture-v1.md §13).
abstract contract BlueDeploy {
    using MarketParamsLib for MarketParams;

    // BNB Chain (chain id 56). Verified on a fork by test/fork/MorphoBnbFork.t.sol.
    address internal constant MORPHO = 0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a;
    address internal constant IRM = 0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979; // AdaptiveCurveIrm
    address internal constant USDT = 0x55d398326f99059fF775485246999027B3197955; // BSC-USD, 18 decimals
    uint256 internal constant LLTV = Risk.LLTV;

    // PLACEHOLDER haircuts (bps), index = Regime: OPEN, EXTENDED, CLOSED, WEEKEND, HALTED, CORP_ACTION.
    // Same values as frontend params.ts: 0, 4%, 10%, 15%, 25%, 10%.
    uint16 internal constant H_OPEN = Risk.H_OPEN;
    uint16 internal constant H_EXTENDED = Risk.H_EXTENDED;
    uint16 internal constant H_CLOSED = Risk.H_CLOSED;
    uint16 internal constant H_WEEKEND = Risk.H_WEEKEND;
    uint16 internal constant H_HALTED = Risk.H_HALTED;
    uint16 internal constant H_CORP_ACTION = Risk.H_CORP_ACTION;
    uint16 internal constant MARGIN_BPS = Risk.MARGIN_BPS; // PLACEHOLDER 2%, frontend params.ts
    uint16 internal constant CONTINUITY_BAND_BPS = Risk.CONTINUITY_BAND_BPS; // PLACEHOLDER 5%, frontend params.ts
    // PLACEHOLDERS not in the frontend: staleness, freeze bounds, jump band.
    uint32 internal constant JUMP_BAND_BPS = Risk.JUMP_BAND_BPS; // upward jumps above +30% are held
    uint64 internal constant MAX_FREEZE = Risk.MAX_FREEZE;
    uint16 internal constant EXPIRED_FREEZE_HAIRCUT_BPS = Risk.EXPIRED_FREEZE_HAIRCUT_BPS;
    uint64 internal constant MAX_OVERRIDE = Risk.MAX_OVERRIDE;
    uint256 internal constant MAX_ATTESTATION_TTL = Risk.MAX_ATTESTATION_TTL;

    /// Public demo signer key. NOT A SECRET: anyone can sign eligibility attestations with it. Demo only.
    uint256 internal constant DEMO_SIGNER_KEY = uint256(keccak256("blue.demo.eligibility.signer"));

    /// Optional REAL Atlas feed (and real bStock). Default address(0) keeps the MockAtlasFeed / MockBStock path,
    /// which every test and the demo use. Set by script/Deploy.s.sol from env ATLAS_FEED / BSTOCK.
    /// With a real feed the oracle is configured per RAW token (feedPerUIShare = false, measured 2026-11-26) and the
    /// live-regime staleness is 2 hours, because real feeds heartbeat roughly hourly (see README).
    /// Deployment.feed is then address(0); the bStock stays a mock unless BSTOCK is also set.
    address internal realAtlasFeed;
    address internal realBStock;

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
        BlueOracle oracle;
        BlueRouter router;
        BlueManagedCollateral managedCollateral;
        BlueBorrowPermission permission;
        MarketParams marketParams;
        Id marketId;
    }

    function _deployBlue(DeployParams memory p) internal returns (Deployment memory d) {
        d.registry = new RegimeRegistry(p.deployer, p.keeper, MAX_OVERRIDE, false);
        d.registry.setHolidays(_nyseHolidays(), true);
        d.registry.setEarlyCloses(_nyseEarlyCloses(), true);

        address feedAddr = realAtlasFeed;
        if (realBStock != address(0)) {
            d.bStock = MockBStock(realBStock); // real token: only used through its address / uiMultiplier()
        } else {
            d.bStock = new MockBStock("Mock bStock AAPL", "bAAPL");
        }
        if (feedAddr == address(0)) {
            d.feed = new MockAtlasFeed(8, p.initialPrice);
            feedAddr = address(d.feed);
        }
        d.router = new BlueRouter(MORPHO, address(d.registry), p.deployer, p.signer, MAX_ATTESTATION_TTL);
        address collateral = address(d.bStock);
        if (_managedMarket()) {
            d.managedCollateral = new BlueManagedCollateral(collateral, address(d.router), MORPHO, Risk.SUPPLY_CAP);
            collateral = address(d.managedCollateral);
            d.permission = new BlueBorrowPermission(
                d.registry, Risk.PERMISSION_TTL_SECONDS, Risk.RECOVERY_SECONDS, Risk.MAX_PROOF_GAP_SECONDS
            );
        }
        BlueOracle.Config memory c = _oracleConfig(feedAddr, address(d.registry), collateral);
        if (realAtlasFeed != address(0)) {
            c.feedPerUIShare = false;
            c.stalenessSec = Risk.atlasStaleness();
        }
        d.oracle = new BlueOracle(c);

        d.marketParams = MarketParams({
            loanToken: USDT, collateralToken: collateral, oracle: address(d.oracle), irm: IRM, lltv: LLTV
        });
        d.marketId = d.marketParams.id();
        IMorpho(MORPHO).createMarket(d.marketParams);

        if (_managedMarket()) {
            d.router.listManagedMarket(d.marketParams, MARGIN_BPS, _totalCap(), _regimeCaps(), d.permission);
        } else {
            d.router.listMarket(d.marketParams, MARGIN_BPS, _totalCap(), _regimeCaps());
        }
        if (p.guardian != address(0)) d.router.setGuardian(p.guardian);

        if (p.seedSupply != 0) {
            IERC20Approve(USDT).approve(MORPHO, p.seedSupply);
            IMorpho(MORPHO).supply(d.marketParams, p.seedSupply, 0, p.deployer, "");
        }
    }

    function _oracleConfig(address feed, address registry, address asset)
        internal
        pure
        returns (BlueOracle.Config memory c)
    {
        c.atlasFeed = feed;
        c.registry = registry;
        c.asset = asset;
        c.loanDecimals = 18;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.feedPerUIShare = true; // mock default is per UI share; real Atlas feeds are per raw token (see _deployBlue)
        c.haircutsBps = Risk.haircuts();
        c.stalenessSec = Risk.mockStaleness(); // PLACEHOLDER
        c.maxFreeze = MAX_FREEZE;
        c.continuityBandBps = CONTINUITY_BAND_BPS;
        c.expiredFreezeHaircutBps = EXPIRED_FREEZE_HAIRCUT_BPS;
        c.jumpBandBps = JUMP_BAND_BPS;
    }

    function _managedMarket() internal pure virtual returns (bool) {
        return false;
    }

    /// PLACEHOLDER caps on market totalBorrowAssets (USDT, 18 decimals). HALTED/CORP_ACTION are blocked anyway.
    function _totalCap() internal pure virtual returns (uint256) {
        return Risk.TOTAL_CAP;
    }

    function _regimeCaps() internal pure virtual returns (uint256[6] memory) {
        return Risk.regimeCaps();
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
