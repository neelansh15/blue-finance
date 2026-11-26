// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IMorpho, Id, MarketParams, MarketParamsLib} from "../../src/interfaces/IMorpho.sol";
import {IRegimeRegistry} from "../../src/interfaces/IRegimeRegistry.sol";
import {DawnRouter} from "../../src/DawnRouter.sol";
import {DawnDeploy} from "../../script/DawnDeploy.sol";

interface IERC20R {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

interface IFeedR {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// Real TSLAB (bStock) + real Atlas TSLAB/USD feed against the real Morpho Blue on BSC, through DawnOracle.
/// Real token transfers are attempted for: supplyCollateral, borrow, repay, withdrawCollateral, directly on Morpho
/// and through DawnRouter. Assertions are NOT weakened: if the real token blocks Morpho or the router, the
/// corresponding test fails with the token's revert and that is the finding (see README "Real bStock compatibility").
/// RPC: BSC_RPC_URL (archive-capable), else the public blastapi endpoint. Skipped if the fork cannot be created.
/// The holder's balance is set with deal() (storage write); the token's compliance state is the real, live one.
contract RealBStockForkTest is Test, DawnDeploy {
    using MarketParamsLib for MarketParams;

    IMorpho internal constant M = IMorpho(MORPHO);
    address internal constant TSLAB = 0x5b1910eAaD6450E50f816082Aa078C41F10C292f;
    address internal constant TSLAB_FEED = 0xf569C3e52e797219eCFDc1659c3250B0BbDC693C;
    uint256 internal constant COLL = 10e18; // 10 TSLAB

    bool internal forked;
    Deployment internal d;
    address internal holder = makeAddr("bstockHolder");
    uint256 internal signerKey = DEMO_SIGNER_KEY;

    function setUp() public {
        string memory url = vm.envOr("BSC_RPC_URL", string("https://bsc-mainnet.public.blastapi.io"));
        try vm.createSelectFork(url) {
            forked = true;
        } catch {
            forked = false;
            return;
        }
        realAtlasFeed = TSLAB_FEED;
        realBStock = TSLAB;
        deal(USDT, address(this), 100_000e18);
        // Real feed through DawnOracle (per raw token, 2h live staleness). Creates the market on real Morpho,
        // lists it on the router (placeholder caps) and seeds 100k USDT.
        d = _deployDawn(
            DeployParams({
                deployer: address(this),
                keeper: address(this),
                signer: vm.addr(signerKey),
                guardian: address(0),
                seedSupply: 100_000e18,
                initialPrice: 0
            })
        );
        deal(TSLAB, holder, COLL); // balance via storage; compliance checks on transfer stay live
    }

    modifier onlyFork() {
        vm.skip(!forked);
        _;
    }

    /// Moves to the next OPEN session and re-stamps the real feed answer as fresh (mockCall on timestamp only), so
    /// the router's regime / live-price gates can pass. The answer itself is the real one.
    function _openAndFresh() internal {
        uint256 t = block.timestamp;
        for (uint256 i; i < 7 * 96 && d.registry.calendarRegimeAt(t) != IRegimeRegistry.Regime.OPEN; ++i) {
            t += 15 minutes;
        }
        vm.warp(t + 1 minutes);
        (uint80 rid, int256 ans,,, uint80 air) = IFeedR(TSLAB_FEED).latestRoundData();
        vm.mockCall(
            TSLAB_FEED,
            abi.encodeWithSelector(IFeedR.latestRoundData.selector),
            abi.encode(rid, ans, block.timestamp, block.timestamp, air)
        );
        d.oracle.update();
    }

    function _attest(address account) internal view returns (DawnRouter.Attestation memory a) {
        a.nonce = 1;
        a.expiry = block.timestamp + 10 minutes;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, d.router.eligibilityDigest(account, a.nonce, a.expiry));
        a.signature = abi.encodePacked(r, s, v);
    }

    function test_Setup_OracleReadsRealFeed() public onlyFork {
        assertGt(d.oracle.price(), 0);
        assertEq(IERC20R(TSLAB).balanceOf(holder), COLL);
        (uint256 s,,) = M.position(d.marketId, holder);
        assertEq(s, 0);
    }

    // ------------------------------------------------------------ direct on Morpho

    function test_Direct_SupplyCollateral() public onlyFork {
        vm.startPrank(holder);
        IERC20R(TSLAB).approve(MORPHO, COLL);
        M.supplyCollateral(d.marketParams, COLL, holder, "");
        vm.stopPrank();
        (,, uint128 c) = M.position(d.marketId, holder);
        assertEq(c, COLL);
    }

    function test_Direct_FullCycle() public onlyFork {
        vm.startPrank(holder);
        IERC20R(TSLAB).approve(MORPHO, COLL);
        M.supplyCollateral(d.marketParams, COLL, holder, "");
        uint256 borrowAmt = 500e18;
        M.borrow(d.marketParams, borrowAmt, 0, holder, holder);
        assertEq(IERC20R(USDT).balanceOf(holder), borrowAmt);
        deal(USDT, holder, borrowAmt + 10e18); // cover interest
        IERC20R(USDT).approve(MORPHO, type(uint256).max);
        (, uint128 shares,) = M.position(d.marketId, holder);
        M.repay(d.marketParams, 0, shares, holder, "");
        M.withdrawCollateral(d.marketParams, COLL, holder, holder);
        vm.stopPrank();
        assertEq(IERC20R(TSLAB).balanceOf(holder), COLL);
    }

    // ------------------------------------------------------------ through DawnRouter

    function test_Router_FullCycle() public onlyFork {
        _openAndFresh();
        vm.startPrank(holder);
        IERC20R(TSLAB).approve(address(d.router), COLL);
        M.setAuthorization(address(d.router), true);
        uint256 borrowAmt = 500e18;
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, borrowAmt, holder, _attest(holder));
        assertEq(IERC20R(USDT).balanceOf(holder), borrowAmt);
        deal(USDT, holder, borrowAmt + 10e18);
        IERC20R(USDT).approve(address(d.router), type(uint256).max);
        (, uint128 shares,) = M.position(d.marketId, holder);
        d.router.repay(d.marketParams, 0, shares, holder);
        d.router.withdrawCollateral(d.marketParams, COLL, holder);
        vm.stopPrank();
        assertEq(IERC20R(TSLAB).balanceOf(holder), COLL);
    }
}
