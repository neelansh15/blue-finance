// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ScenarioBase, IERC20T} from "./scenarios/ScenarioBase.sol";
import {Id, MarketParams, MarketParamsLib} from "../src/interfaces/IMorpho.sol";
import {IRegimeRegistry} from "../src/interfaces/IRegimeRegistry.sol";
import {BlueRouter} from "../src/BlueRouter.sol";
import {BlueOracle} from "../src/BlueOracle.sol";
import {RegimeRegistry} from "../src/RegimeRegistry.sol";

/// Collateral token that re-enters the router from transferFrom and records the revert selector it got.
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    BlueRouter public router;
    MarketParams public mp;
    bytes4 public caught;
    bool public armed;

    function setTarget(BlueRouter r, MarketParams memory m) external {
        router = r;
        mp = m;
    }

    function arm(bool on) external {
        armed = on;
    }

    function uiMultiplier() external pure returns (uint256) {
        return 1e18;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        if (armed) {
            armed = false;
            BlueRouter.Attestation memory none;
            try router.supplyCollateralAndBorrow(mp, 0, 0, f, none) {}
            catch (bytes memory err) {
                caught = bytes4(err);
            }
        }
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// BlueRouter unit tests. They run on the BNB fork against the real Morpho Blue (router behaviour depends on Morpho's
/// exact semantics), using the shared BlueDeploy setup. Skipped if no fork.
contract BlueRouterTest is ScenarioBase {
    using MarketParamsLib for MarketParams;

    uint256 constant COLL = 10e18;

    function _setOverride(IRegimeRegistry.Regime r) internal {
        vm.prank(keeper);
        d.registry.setOverride(address(d.bStock), r, 1 days);
    }

    function _caps(uint256 total, uint256[6] memory rc) internal {
        d.router.setCaps(d.marketId, total, rc);
    }

    // ------------------------------------------------------------ targetLTV

    function test_TargetLtv_WeekendVsOpen() public onlyFork {
        // targetLTV itself is regime-independent for routine regimes; the limit tightens through the haircut price.
        assertEq(d.router.targetLtv(d.marketId, IRegimeRegistry.Regime.OPEN), 0.51125e18);
        assertEq(d.router.targetLtv(d.marketId, IRegimeRegistry.Regime.WEEKEND), 0.51125e18);
        assertEq(d.router.targetLtv(d.marketId, IRegimeRegistry.Regime.HALTED), 0);
        assertEq(d.router.targetLtv(d.marketId, IRegimeRegistry.Regime.CORP_ACTION), 0);
        BlueRouter.MarketConfig memory c = d.router.marketConfig(d.marketId);
        assertEq(c.hMaxBps, 1500);
        assertEq(c.marginBps, 200);

        _prepare(borrower, COLL);
        vm.prank(borrower);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 0, borrower, _noAttestation());
        uint256 openLimit = d.router.borrowLimit(d.marketId, borrower);
        _setOverride(IRegimeRegistry.Regime.WEEKEND);
        _refresh(PRICE0);
        uint256 weekendLimit = d.router.borrowLimit(d.marketId, borrower);
        assertEq(openLimit, 1022.5e18);
        assertEq(weekendLimit, (openLimit * 85) / 100);

        _setOverride(IRegimeRegistry.Regime.HALTED);
        assertEq(d.router.borrowLimit(d.marketId, borrower), 0);
    }

    function test_SetMargin() public onlyFork {
        d.router.setMargin(d.marketParams, 500);
        assertEq(d.router.targetLtv(d.marketId, IRegimeRegistry.Regime.OPEN), 0.48125e18);
        vm.expectRevert(BlueRouter.InvalidConfig.selector);
        d.router.setMargin(d.marketParams, 5001);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.setMargin(d.marketParams, 100);
    }

    // ------------------------------------------------------------ attestation

    function test_Attestation_Required() public onlyFork {
        _prepare(borrower, COLL);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.BadSignature.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, _bare(block.timestamp + 60));
    }

    function test_Attestation_Expired() public onlyFork {
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.warp(a.expiry + 1);
        _refresh(PRICE0);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.AttestationExpired.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Attestation_TooLong() public onlyFork {
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _bare(block.timestamp + 15 minutes + 1);
        a.signature = _sign(signerKey, borrower, a.nonce, a.expiry);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.AttestationTooLong.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Attestation_Replay() public onlyFork {
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
        assertTrue(d.router.nonceUsed(borrower, a.nonce));
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.NonceUsed.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, 0, 100e18, borrower, a);
    }

    function test_Attestation_BoundToAccount() public onlyFork {
        BlueRouter.Attestation memory a = _attest(borrower);
        address other = makeAddr("other");
        _prepare(other, COLL);
        vm.prank(other);
        vm.expectRevert(BlueRouter.BadSignature.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, other, a);
    }

    function test_Attestation_WrongSigner() public onlyFork {
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _bare(block.timestamp + 60);
        a.signature = _sign(uint256(keccak256("not the signer")), borrower, a.nonce, a.expiry);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.BadSignature.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Attestation_HighSRejected() public onlyFork {
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _bare(block.timestamp + 60);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, d.router.eligibilityDigest(borrower, a.nonce, a.expiry));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        a.signature = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27)); // same signer
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.BadSignature.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Attestation_OtherChainRejected() public onlyFork {
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.chainId(97);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.BadSignature.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Attestation_SignerUnset() public onlyFork {
        d.router.setSigner(address(0));
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.NoSigner.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_CollateralOnlyNeedsNoAttestation() public onlyFork {
        _prepare(borrower, COLL);
        _setOverride(IRegimeRegistry.Regime.HALTED); // even when blocked for borrowing
        vm.prank(borrower);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 0, borrower, _noAttestation());
        (,, uint128 coll) = M.position(d.marketId, borrower);
        assertEq(coll, COLL);
    }

    // ------------------------------------------------------------ caps

    function test_Caps_Total() public onlyFork {
        _caps(500e18, [uint256(1e30), 1e30, 1e30, 1e30, 0, 0]);
        _prepare(borrower, COLL);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(BlueRouter.CapExceeded.selector, 600e18, 500e18));
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 600e18, borrower, a);
        a = _attest(borrower);
        vm.prank(borrower);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 500e18, borrower, a);
    }

    function test_Caps_PerRegime() public onlyFork {
        _caps(1e30, [uint256(1e30), 1e30, 1e30, 300e18, 0, 0]);
        _prepare(borrower, COLL);
        _setOverride(IRegimeRegistry.Regime.WEEKEND);
        _refresh(PRICE0);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(BlueRouter.CapExceeded.selector, 301e18, 300e18));
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 301e18, borrower, a);
        a = _attest(borrower);
        vm.prank(borrower);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 300e18, borrower, a);
    }

    function test_Caps_GuardianCanOnlyLower() public onlyFork {
        uint256[6] memory rc = [uint256(1_000_000e18), 500_000e18, 250_000e18, 250_000e18, 0, 0];
        rc[0] = 2_000_000e18;
        vm.prank(guardian);
        vm.expectRevert(BlueRouter.CapRaise.selector);
        d.router.lowerCaps(d.marketId, 1_000_000e18, rc);
        rc[0] = 10e18;
        vm.prank(guardian);
        d.router.lowerCaps(d.marketId, 10e18, rc);
        assertEq(d.router.marketConfig(d.marketId).totalCap, 10e18);
        vm.prank(guardian);
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.setCaps(d.marketId, 1e30, rc);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.lowerCaps(d.marketId, 0, rc);
    }

    // ------------------------------------------------------------ blocked regimes and oracle states

    function test_Blocked_HaltedAndCorpAction() public onlyFork {
        _openAtLimit(borrower, COLL);
        IRegimeRegistry.Regime[2] memory rs = [IRegimeRegistry.Regime.CORP_ACTION, IRegimeRegistry.Regime.HALTED];
        for (uint256 i; i < 2; ++i) {
            _setOverride(rs[i]);
            BlueRouter.Attestation memory a = _attest(borrower);
            vm.prank(borrower);
            vm.expectRevert(abi.encodeWithSelector(BlueRouter.RegimeBlocked.selector, rs[i]));
            d.router.supplyCollateralAndBorrow(d.marketParams, 0, 1, borrower, a);
            vm.prank(borrower);
            vm.expectRevert(abi.encodeWithSelector(BlueRouter.RegimeBlocked.selector, rs[i]));
            d.router.withdrawCollateral(d.marketParams, 1, borrower);
        }
        // Repay is always allowed; after a full repay, withdrawal works even in HALTED.
        (, uint128 shares,) = M.position(d.marketId, borrower);
        deal(USDT, borrower, 2_000e18);
        vm.startPrank(borrower);
        IERC20T(USDT).approve(address(d.router), type(uint256).max);
        d.router.repay(d.marketParams, 0, shares, borrower);
        d.router.withdrawCollateral(d.marketParams, COLL, borrower);
        vm.stopPrank();
        assertEq(d.bStock.balanceOf(borrower), COLL);
    }

    function test_Blocked_OracleFrozen() public onlyFork {
        _prepare(borrower, COLL);
        d.bStock.setUIMultiplierNow(2e18); // feed not updated: $200 x 2 = $400 fails continuity => frozen
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.OracleFrozen.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Blocked_PendingUpwardJump() public onlyFork {
        _prepare(borrower, COLL);
        d.feed.setAnswer(300e8); // +50% > 30% jump band
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.OracleFrozen.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Blocked_StaleFeed() public onlyFork {
        _prepare(borrower, COLL);
        vm.warp(block.timestamp + 2 hours); // OPEN staleness is 1h; regime may change, feed is stale in any case
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert();
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    function test_Paused() public onlyFork {
        _openAtLimit(borrower, 2 * COLL);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.pause();
        vm.prank(guardian);
        d.router.pause();
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.IsPaused.selector);
        d.router.supplyCollateralAndBorrow(d.marketParams, 0, 1, borrower, a);
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.IsPaused.selector);
        d.router.withdrawCollateral(d.marketParams, 1, borrower);
        vm.prank(guardian);
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.unpause();
        d.router.unpause();
        assertFalse(d.router.paused());
    }

    // ------------------------------------------------------------ authorization and ownership of positions

    function test_Authorization_RequiredOnMorpho() public onlyFork {
        d.bStock.mint(borrower, COLL);
        vm.prank(borrower);
        d.bStock.approve(address(d.router), COLL);
        BlueRouter.Attestation memory a = _attest(borrower);
        vm.prank(borrower);
        vm.expectRevert(bytes("unauthorized"));
        d.router.supplyCollateralAndBorrow(d.marketParams, COLL, 100e18, borrower, a);
    }

    /// The router acts only for msg.sender: an eligible attacker cannot borrow against or withdraw a victim's
    /// collateral even though the victim authorized the router.
    function test_Authorization_OnlyForSelf() public onlyFork {
        _openAtLimit(borrower, 2 * COLL);
        address attacker = makeAddr("attacker");
        BlueRouter.Attestation memory a = _attest(attacker);
        vm.prank(attacker);
        vm.expectRevert(bytes("unauthorized")); // Morpho: attacker never authorized the router
        d.router.supplyCollateralAndBorrow(d.marketParams, 0, 100e18, attacker, a);
        vm.prank(attacker);
        vm.expectRevert(); // attacker has no collateral: Morpho underflow
        d.router.withdrawCollateral(d.marketParams, 1, attacker);
        (,, uint128 coll) = M.position(d.marketId, borrower);
        assertEq(coll, 2 * COLL);
    }

    function test_Withdraw_TargetLtvEnforced() public onlyFork {
        _openAtLimit(borrower, COLL);
        vm.prank(borrower);
        vm.expectRevert();
        d.router.withdrawCollateral(d.marketParams, 1e18, borrower);

        deal(USDT, borrower, 2_000e18);
        vm.startPrank(borrower);
        IERC20T(USDT).approve(address(d.router), type(uint256).max);
        d.router.repay(d.marketParams, 511.25e18, 0, borrower); // half the debt
        d.router.withdrawCollateral(d.marketParams, 4e18, borrower); // 6 x 200 x 0.51125 = 613.5 >= 511.25
        vm.expectRevert();
        d.router.withdrawCollateral(d.marketParams, 2e18, borrower); // 4 x 200 x 0.51125 = 409 < 511.25
        vm.stopPrank();
    }

    function test_Repay_FullBySharesAndThirdParty() public onlyFork {
        _openAtLimit(borrower, COLL);
        address friend = makeAddr("friend");
        deal(USDT, friend, 2_000e18);
        (, uint128 shares,) = M.position(d.marketId, borrower);
        vm.startPrank(friend);
        IERC20T(USDT).approve(address(d.router), type(uint256).max);
        (uint256 assets,) = d.router.repay(d.marketParams, 0, shares, borrower);
        vm.stopPrank();
        (, uint128 after_,) = M.position(d.marketId, borrower);
        assertEq(after_, 0);
        assertEq(IERC20T(USDT).balanceOf(friend), 2_000e18 - assets);
        assertEq(IERC20T(USDT).balanceOf(address(d.router)), 0, "router holds nothing");
    }

    function test_Repay_CallbackOnlyDuringRepay() public onlyFork {
        vm.expectRevert(BlueRouter.NotRepaying.selector);
        d.router.onMorphoRepay(1, abi.encode(USDT));
        vm.prank(MORPHO);
        vm.expectRevert(BlueRouter.NotRepaying.selector);
        d.router.onMorphoRepay(1, abi.encode(USDT));
    }

    function test_Reentrancy() public onlyFork {
        ReentrantToken t = new ReentrantToken();
        BlueOracle o = new BlueOracle(_oracleConfig(address(d.feed), address(d.registry), address(t)));
        MarketParams memory mp =
            MarketParams({loanToken: USDT, collateralToken: address(t), oracle: address(o), irm: IRM, lltv: LLTV});
        M.createMarket(mp);
        d.router.listMarket(mp, 200, 1e30, [uint256(1e30), 1e30, 1e30, 1e30, 0, 0]);
        t.setTarget(d.router, mp);
        t.mint(borrower, COLL);
        vm.prank(borrower);
        t.approve(address(d.router), COLL);
        t.arm(true);
        vm.prank(borrower);
        d.router.supplyCollateralAndBorrow(mp, COLL, 0, borrower, _noAttestation());
        assertEq(t.caught(), BlueRouter.Reentrancy.selector);
    }

    // ------------------------------------------------------------ admin

    function test_AdminTwoStep() public onlyFork {
        address next = makeAddr("nextAdmin");
        vm.prank(next);
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.setSigner(next);
        d.router.transferAdmin(next);
        assertEq(d.router.admin(), address(this), "not transferred until accepted");
        vm.prank(borrower);
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.acceptAdmin();
        vm.prank(next);
        d.router.acceptAdmin();
        assertEq(d.router.admin(), next);
        assertEq(d.router.pendingAdmin(), address(0));
        vm.expectRevert(BlueRouter.Unauthorized.selector);
        d.router.setSigner(address(1));
    }

    function test_ListMarket_Validation() public onlyFork {
        vm.expectRevert(BlueRouter.MarketAlreadyListed.selector);
        d.router.listMarket(d.marketParams, 200, 1, [uint256(1), 1, 1, 1, 0, 0]);

        // Oracle on a different registry: rejected.
        RegimeRegistry other = new RegimeRegistry(address(this), keeper, 1 days, false);
        ReentrantToken t = new ReentrantToken();
        BlueOracle o = new BlueOracle(_oracleConfig(address(d.feed), address(other), address(t)));
        MarketParams memory mp =
            MarketParams({loanToken: USDT, collateralToken: address(t), oracle: address(o), irm: IRM, lltv: LLTV});
        vm.expectRevert(BlueRouter.MarketMismatch.selector); // not created on Morpho yet
        d.router.listMarket(mp, 200, 1, [uint256(1), 1, 1, 1, 0, 0]);
        M.createMarket(mp);
        vm.expectRevert(BlueRouter.MarketMismatch.selector); // wrong registry
        d.router.listMarket(mp, 200, 1, [uint256(1), 1, 1, 1, 0, 0]);

        // Unlisted market: user calls revert.
        vm.expectRevert(BlueRouter.MarketNotListed.selector);
        d.router.withdrawCollateral(mp, 1, address(this));
    }

    function _bare(uint256 expiry) internal returns (BlueRouter.Attestation memory a) {
        a.nonce = nextNonce++;
        a.expiry = expiry;
        a.signature = new bytes(65);
        a.signature[64] = bytes1(uint8(27));
    }
}
