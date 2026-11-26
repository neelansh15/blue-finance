// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BlueOracle} from "../../src/BlueOracle.sol";
import {RegimeRegistry} from "../../src/RegimeRegistry.sol";
import {IRegimeRegistry, RegimeLib} from "../../src/interfaces/IRegimeRegistry.sol";

interface IFeedLike {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IBStockUi {
    function uiMultiplier() external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// Reads the REAL Atlas feeds on BSC through BlueOracle. Skipped (not failed) if the RPC is unreachable.
/// RPC: BSC_RPC_URL, else the public endpoint. Feed/token addresses: docs.bsc.lista.org multi-oracle-bstock
/// (fetched 2026-11-26). Live data, so assertions are bands, not exact values.
contract AtlasRealFeedForkTest is Test {
    struct Asset {
        string name;
        address token;
        address feed;
        uint256 minUsd; // sanity band, whole USD per raw token
        uint256 maxUsd;
    }

    bool forked;
    RegimeRegistry reg;
    Asset[] assets;

    function setUp() public {
        string memory url = vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.binance.org"));
        try vm.createSelectFork(url) {
            forked = true;
        } catch {
            forked = false;
            return;
        }
        reg = new RegimeRegistry(address(this), address(this), 1 days, false);
        assets.push(Asset("TSLAB", 0x5b1910eAaD6450E50f816082Aa078C41F10C292f, 0xf569C3e52e797219eCFDc1659c3250B0BbDC693C, 100, 1500));
        assets.push(Asset("NVDAB", 0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436, 0x2bd759006b423BFF444181A13C96a6b134E557BB, 40, 600));
        assets.push(Asset("AAPLB", 0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A, 0x5AfB6E8B04A63e6075620397520399ca9ffE7C05, 80, 800));
        assets.push(Asset("SPYB", 0x7138b48df7D98D7e3cc221BfE7192D0a178182D8, 0x464b16fDc9d677cFdc6680Fdf687D59ba52B1631, 250, 2000));
        // SNDKB has uiMultiplier == 8: the answer (~$600) is per RAW token, ~8x the ~$75 underlying share.
        assets.push(Asset("SNDKB", 0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb, 0x1C5211723f67A77DAaDb62DDc6D68Ee23e724c0f, 150, 3000));
    }

    function _deploy(Asset memory a, uint32 liveStaleness) internal returns (BlueOracle) {
        BlueOracle.Config memory c;
        c.atlasFeed = a.feed;
        c.registry = address(reg);
        c.asset = a.token;
        c.loanDecimals = 18;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.feedPerUIShare = false; // measured: real Atlas feeds quote per raw token
        c.haircutsBps = [uint16(0), 400, 1000, 1500, 2500, 1000];
        c.stalenessSec = [liveStaleness, liveStaleness, 4 hours, 6 hours, 1 hours, 1 hours];
        c.maxFreeze = 12 hours;
        c.continuityBandBps = 500;
        c.expiredFreezeHaircutBps = 1000;
        return new BlueOracle(c);
    }

    function test_Fork_RealFeedsThroughOracle() public {
        if (!forked) return vm.skip(true);
        for (uint256 i; i < assets.length; ++i) {
            Asset memory a = assets[i];
            // Generous 6h staleness so the test does not depend on when it runs (see test below for age).
            BlueOracle o = _deploy(a, 6 hours);
            (uint80 rid, int256 ans,, uint256 upd, uint80 air) = IFeedLike(a.feed).latestRoundData();
            assertEq(IFeedLike(a.feed).decimals(), 8, a.name);
            assertGt(ans, 0, a.name);
            assertGe(air, rid, a.name);

            // Morpho scale: 18/18 decimals -> price = answer(1e8) * 1e28 ; per raw token, no multiplier.
            assertEq(o.lastGoodPrice(), uint256(ans) * 1e28, string.concat(a.name, " seeded price scaling"));
            assertEq(o.lastGoodAt(), upd, a.name);
            (bool ok, uint256 live,) = o.liveRawPrice();
            assertTrue(ok, string.concat(a.name, " live read"));
            assertEq(live, uint256(ans) * 1e28);
            // Sanity band in USD per raw token.
            assertGt(live, a.minUsd * 1e36, a.name);
            assertLt(live, a.maxUsd * 1e36, a.name);
            // price() under whatever regime the registry reports at fork time never reverts and is <= raw.
            uint256 p = o.price();
            assertGt(p, 0);
            assertLe(p, live);
            emit log_named_uint(string.concat(a.name, " price e36 (USD*1e0)"), p / 1e36);
        }
    }

    function test_Fork_PerRawTokenUnits_Sndk() public {
        if (!forked) return vm.skip(true);
        Asset memory a = assets[4];
        uint256 m = IBStockUi(a.token).uiMultiplier();
        (, int256 ans,,,) = IFeedLike(a.feed).latestRoundData();
        emit log_named_uint("SNDKB uiMultiplier", m);
        emit log_named_int("SNDKB answer (8dp)", ans);
        // Underlying SNDK trades near $75 (Yahoo, 2026-11-26), i.e. raw-token price ~= multiplier x share price.
        // If the feed were per UI share the answer would be ~$75, not ~$600. Skip if the multiplier changed.
        if (m != 8e18) return vm.skip(true);
        assertGt(uint256(ans), 300e8, "answer is per raw token (~8 shares), not per share");
    }

    /// Records the staleness the real feeds show at fork time and checks the documented regime rules:
    /// with the placeholder 1h live staleness a ~1h heartbeat feed can read stale; with 2h it must be live.
    function test_Fork_Staleness() public {
        if (!forked) return vm.skip(true);
        for (uint256 i; i < assets.length; ++i) {
            Asset memory a = assets[i];
            (,,, uint256 upd,) = IFeedLike(a.feed).latestRoundData();
            uint256 age = block.timestamp - upd;
            emit log_named_uint(string.concat(a.name, " age seconds"), age);
            BlueOracle o2h = _deploy(a, 2 hours);
            IRegimeRegistry.Regime r = reg.regime(a.token);
            (bool ok2,,) = o2h.liveRawPrice();
            if (!RegimeLib.isFreezeRegime(r)) assertEq(ok2, age <= o2h.stalenessSec(r), a.name);
            assertLt(age, 6 hours, string.concat(a.name, " feed older than 6h at fork time"));
        }
    }
}

import {BlueDeploy} from "../../script/BlueDeploy.sol";

/// The deploy path with a real Atlas feed + real bStock (BlueDeploy.realAtlasFeed / realBStock).
contract AtlasRealDeployForkTest is Test, BlueDeploy {
    function test_Fork_DeployWithRealFeed() public {
        string memory url = vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.binance.org"));
        try vm.createSelectFork(url) {}
        catch {
            return vm.skip(true);
        }
        realAtlasFeed = 0xf569C3e52e797219eCFDc1659c3250B0BbDC693C; // TSLAB/USD
        realBStock = 0x5b1910eAaD6450E50f816082Aa078C41F10C292f; // TSLAB
        Deployment memory d = _deployBlue(
            DeployParams({
                deployer: address(this),
                keeper: address(this),
                signer: address(this),
                guardian: address(0),
                seedSupply: 0,
                initialPrice: 0
            })
        );
        assertEq(address(d.feed), address(0), "no mock feed");
        assertEq(address(d.oracle.ATLAS_FEED()), realAtlasFeed);
        assertFalse(d.oracle.FEED_PER_UI_SHARE());
        (, int256 ans,,,) = IFeedLike(realAtlasFeed).latestRoundData();
        assertEq(d.oracle.lastGoodPrice(), uint256(ans) * 1e28);
        assertGt(d.oracle.price(), 0);
    }
}
