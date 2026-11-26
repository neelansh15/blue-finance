// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMorpho, Id, MarketParams, MarketParamsLib} from "../src/interfaces/IMorpho.sol";
import {BlueRouter} from "../src/BlueRouter.sol";
import {BlueOracle} from "../src/BlueOracle.sol";
import {BlueManagedCollateral} from "../src/BlueManagedCollateral.sol";
import {BlueBorrowPermission} from "../src/BlueBorrowPermission.sol";
import {BlueRiskExecutor} from "../src/BlueRiskExecutor.sol";
import {RegimeRegistry} from "../src/RegimeRegistry.sol";
import {IRegimeRegistry} from "../src/interfaces/IRegimeRegistry.sol";
import {MockBStock} from "../src/mocks/MockBStock.sol";
import {MockAtlasFeed} from "../src/mocks/MockAtlasFeed.sol";
import {BlueRiskParameters as Risk} from "../src/generated/BlueRiskParameters.sol";

interface IMorphoAdmin {
    function enableIrm(address irm) external;
    function enableLltv(uint256 lltv) external;
}

struct ReplayMarket {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

contract FixedRate {
    function borrowRate(MarketParams memory, ReplayMarket memory) external pure returns (uint256) {
        return 1e9;
    }
}

contract ReplayPrice {
    uint256 public price = 200e36;

    function set(uint256 p) external {
        price = p;
    }
}

/// Runs offline against unchanged official Morpho source compiled with its pinned compiler.
/// scripts/bootstrap_protocol.sh builds that artifact. No RPC availability or skipped assertions.
contract ManagedRiskTest is Test {
    using MarketParamsLib for MarketParams;
    IMorpho internal morpho;
    BlueRouter internal router;
    RegimeRegistry internal registry;
    BlueBorrowPermission internal permission;
    BlueManagedCollateral internal receipt;
    BlueOracle internal oracle;
    MockBStock internal stock;
    MockBStock internal loan;
    MockAtlasFeed internal feed;
    MarketParams internal mp;
    Id internal id;
    address internal alice = makeAddr("alice");
    address internal delegate = makeAddr("delegate");
    address internal guardian = makeAddr("guardian");
    uint256 internal nonce;
    uint256 internal signerKey = 0xBEEF;

    function setUp() public {
        vm.warp(1795190400); // 2026-11-20 11:00 ET
        morpho = IMorpho(deployCode("test/fixtures/generated/Morpho.json", abi.encode(address(this))));
        IMorphoAdmin(address(morpho)).enableIrm(address(0));
        IMorphoAdmin(address(morpho)).enableLltv(Risk.LLTV);
        registry = new RegimeRegistry(address(this), address(this), 3 days, false);
        router = new BlueRouter(address(morpho), address(registry), address(this), vm.addr(signerKey), 15 minutes);
        router.setGuardian(guardian);
        stock = new MockBStock("Stock", "STOCK");
        loan = new MockBStock("Loan", "LOAN");
        receipt = new BlueManagedCollateral(address(stock), address(router), address(morpho), Risk.SUPPLY_CAP);
        permission = new BlueBorrowPermission(registry, 5 minutes, 30 minutes, 90 seconds);
        feed = new MockAtlasFeed(8, 200e8);
        BlueOracle.Config memory c;
        c.atlasFeed = address(feed);
        c.registry = address(registry);
        c.asset = address(receipt);
        c.loanDecimals = 18;
        c.collateralDecimals = 18;
        c.feedDecimals = 8;
        c.feedPerUIShare = true;
        c.haircutsBps = Risk.haircuts();
        c.stalenessSec = Risk.mockStaleness();
        c.maxFreeze = Risk.MAX_FREEZE;
        c.continuityBandBps = Risk.CONTINUITY_BAND_BPS;
        c.expiredFreezeHaircutBps = Risk.EXPIRED_FREEZE_HAIRCUT_BPS;
        c.jumpBandBps = Risk.JUMP_BAND_BPS;
        oracle = new BlueOracle(c);
        mp = MarketParams(address(loan), address(receipt), address(oracle), address(0), Risk.LLTV);
        id = mp.id();
        morpho.createMarket(mp);
        router.listManagedMarket(mp, Risk.MARGIN_BPS, Risk.TOTAL_CAP, Risk.regimeCaps(), permission);
        loan.mint(address(this), 100_000e18);
        loan.approve(address(morpho), type(uint256).max);
        morpho.supply(mp, 100_000e18, 0, address(this), "");
        stock.mint(alice, 100e18);
        vm.prank(alice);
        stock.approve(address(router), type(uint256).max);
        _recover();
    }

    function _recover() internal {
        for (uint256 i; i <= 30; ++i) {
            permission.record(address(receipt), true);
            if (i < 30) vm.warp(block.timestamp + 60);
        }
        feed.setAnswer(200e8);
        oracle.update();
        assertTrue(permission.allowed(address(receipt)));
    }

    function _attest() internal returns (BlueRouter.Attestation memory a) {
        a.nonce = nonce++;
        a.expiry = block.timestamp + 10 minutes;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, router.eligibilityDigest(alice, a.nonce, a.expiry));
        a.signature = abi.encodePacked(r, s, v);
    }

    function _open(uint256 debt) internal {
        BlueRouter.Attestation memory a = _attest();
        vm.prank(alice);
        router.supplyCollateralAndBorrow(mp, 10e18, debt, alice, a);
    }

    function test_DirectAndDelegatedBorrowCannotControlManagedPosition() public {
        _open(900e18);
        address account = router.positionOf(id, alice);
        assertTrue(account != alice);
        assertTrue(morpho.isAuthorized(account, address(router)));
        assertFalse(morpho.isAuthorized(account, alice));
        vm.prank(alice);
        vm.expectRevert(bytes("unauthorized"));
        morpho.borrow(mp, 1, 0, account, alice);
        vm.prank(alice);
        vm.expectRevert(bytes("unauthorized"));
        morpho.withdrawCollateral(mp, 1, account, alice);
        vm.prank(alice);
        morpho.setAuthorization(delegate, true);
        vm.prank(delegate);
        vm.expectRevert(bytes("unauthorized"));
        morpho.borrow(mp, 1, 0, account, delegate);
        vm.prank(alice);
        (bool ok,) = account.call(abi.encodeWithSelector(IMorpho.setAuthorization.selector, delegate, true));
        assertFalse(ok);
        vm.prank(alice);
        vm.expectRevert(bytes("insufficient collateral"));
        morpho.borrow(mp, 1, 0, alice, alice);
    }

    function test_RepaymentAndDebtFreeWithdrawalSurvivePermissionLossAndPause() public {
        _open(900e18);
        vm.warp(block.timestamp + 91);
        assertFalse(permission.allowed(address(receipt)));
        BlueRouter.Attestation memory a = _attest();
        vm.prank(alice);
        vm.expectRevert(BlueRouter.PermissionExpired.selector);
        router.supplyCollateralAndBorrow(mp, 0, 1, alice, a);
        vm.prank(alice);
        vm.expectRevert(BlueRouter.PermissionExpired.selector);
        router.withdrawCollateral(mp, 1, alice);
        router.pause();
        address account = router.positionOf(id, alice);
        (, uint128 shares,) = morpho.position(id, account);
        vm.startPrank(alice);
        loan.approve(address(router), type(uint256).max);
        router.repay(mp, 0, shares, alice);
        router.withdrawCollateral(mp, 10e18, alice);
        vm.stopPrank();
        assertEq(stock.balanceOf(alice), 100e18);
        assertEq(receipt.totalSupply(), 0);
    }

    function test_LiquidationAndRedemptionRemainPublicButReceiptResupplyCannotBypass() public {
        _open(900e18);
        feed.setAnswer(120e8);
        oracle.update();
        address account = router.positionOf(id, alice);
        (, uint128 shares,) = morpho.position(id, account);
        loan.mint(delegate, 1000e18);
        vm.startPrank(delegate);
        loan.approve(address(morpho), type(uint256).max);
        morpho.liquidate(mp, account, 0, shares, "");
        uint256 seized = receipt.balanceOf(delegate);
        assertGt(seized, 0);
        receipt.approve(address(morpho), type(uint256).max);
        vm.expectRevert();
        morpho.supplyCollateral(mp, seized, delegate, "");
        receipt.redeem(seized, delegate);
        vm.stopPrank();
        assertEq(stock.balanceOf(delegate), seized);
        assertEq(receipt.balanceOf(delegate), 0);
        assertEq(receipt.totalSupply(), stock.balanceOf(address(receipt)));
    }

    function test_UnknownAndOverrideExpiryRequireNewContinuousRecovery() public {
        permission.record(address(receipt), false);
        assertFalse(permission.allowed(address(receipt)));
        permission.record(address(receipt), true);
        vm.warp(block.timestamp + 91);
        permission.record(address(receipt), true);
        (uint64 since,,,) = permission.evidence(address(receipt));
        assertEq(since, block.timestamp);
        registry.setOverride(address(receipt), IRegimeRegistry.Regime.HALTED, 60);
        permission.record(address(receipt), true); // a healthy claim cannot override registry restriction
        vm.warp(block.timestamp + 61);
        assertFalse(permission.allowed(address(receipt)));
        _recover();
        permission.setHold(address(receipt), true);
        permission.record(address(receipt), true);
        assertFalse(permission.allowed(address(receipt)));
        permission.setHold(address(receipt), false);
        assertFalse(permission.allowed(address(receipt)));
    }

    function test_GuardianCanOnlyTightenMarginAndCapsWithoutChangingExistingDebt() public {
        _open(900e18);
        address account = router.positionOf(id, alice);
        (, uint128 beforeShares,) = morpho.position(id, account);
        vm.startPrank(guardian);
        router.raiseMargin(mp, 300);
        vm.expectRevert(BlueRouter.MarginRelaxation.selector);
        router.raiseMargin(mp, 200);
        uint256[6] memory caps;
        router.lowerCaps(id, 0, caps);
        vm.stopPrank();
        (, uint128 afterShares,) = morpho.position(id, account);
        assertEq(beforeShares, afterShares);
        BlueRouter.Attestation memory a = _attest();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(BlueRouter.CapExceeded.selector, 900e18 + 1, 0));
        router.supplyCollateralAndBorrow(mp, 0, 1, alice, a);
    }

    function test_SupplyCapBlocksNewWrappingWithoutTakingExistingCollateral() public {
        _open(900e18);
        vm.prank(guardian);
        router.lowerSupplyCap(mp, 5e18);
        assertEq(receipt.totalSupply(), 10e18);
        assertEq(stock.balanceOf(address(receipt)), 10e18);
        vm.prank(guardian);
        vm.expectRevert(BlueRouter.CapRaise.selector);
        router.lowerSupplyCap(mp, 6e18);
        BlueRouter.Attestation memory none;
        vm.prank(alice);
        vm.expectRevert(BlueManagedCollateral.SupplyCapExceeded.selector);
        router.supplyCollateralAndBorrow(mp, 1e18, 0, alice, none);
        assertEq(stock.balanceOf(alice), 90e18);
    }

    function test_MultiplierChangeInvalidatesReviewedUpdate() public {
        BlueRiskExecutor executor = _executor();
        BlueRiskExecutor.Update memory u = _update(executor);
        stock.setUIMultiplierNow(2e18);
        vm.expectRevert(BlueRiskExecutor.StaleConfiguration.selector);
        executor.tighten(u);
    }

    function _executor() internal returns (BlueRiskExecutor executor) {
        executor = new BlueRiskExecutor(router, address(this), guardian, 1 days);
        router.transferAdmin(address(executor));
        executor.acceptRouterAdmin();
    }

    function _update(BlueRiskExecutor executor) internal view returns (BlueRiskExecutor.Update memory u) {
        u.chainId = block.chainid;
        u.market = mp;
        u.expectedConfigHash = executor.configHash(id);
        u.evidenceHash = keccak256("reviewed evidence record");
        u.marginBps = 300;
        u.totalCap = Risk.TOTAL_CAP;
        u.supplyCap = Risk.SUPPLY_CAP;
        u.expectedMultiplier = 1e18;
        u.regimeCaps = Risk.regimeCaps();
        u.expiresAt = uint64(block.timestamp + 3 days);
        u.nonce = 1;
    }

    function test_ExecutorDelayReplayExpiryAndEmergencyInvalidation() public {
        BlueRiskExecutor executor = _executor();
        BlueRiskExecutor.Update memory u = _update(executor);
        executor.schedule(u);
        vm.expectRevert(BlueRiskExecutor.NotReady.selector);
        executor.execute(u);
        vm.warp(block.timestamp + 1 days);
        executor.execute(u);
        assertEq(router.marketConfig(id).marginBps, 300);
        vm.expectRevert(BlueRiskExecutor.InvalidUpdate.selector);
        executor.tighten(u);
        u = _update(executor);
        u.nonce = 2;
        u.marginBps = 200; // relaxation must wait
        vm.prank(guardian);
        vm.expectRevert(BlueRiskExecutor.NotTightening.selector);
        executor.tighten(u);
        executor.schedule(u);
        BlueRiskExecutor.Update memory emergency = _update(executor);
        emergency.nonce = 3;
        emergency.marginBps = 400;
        vm.prank(guardian);
        executor.tighten(emergency);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(BlueRiskExecutor.StaleConfiguration.selector);
        executor.execute(u);
        u = _update(executor);
        u.nonce = 4;
        u.chainId += 1;
        vm.expectRevert(BlueRiskExecutor.InvalidUpdate.selector);
        executor.schedule(u);
        u.chainId = block.chainid;
        u.expiresAt = uint64(block.timestamp);
        vm.expectRevert(BlueRiskExecutor.InvalidUpdate.selector);
        executor.schedule(u);
    }

    function test_IntegerReplayMatchesCanonicalInterestAndPartialLiquidation() public {
        FixedRate irm = new FixedRate();
        ReplayPrice price = new ReplayPrice();
        IMorphoAdmin(address(morpho)).enableIrm(address(irm));
        MarketParams memory raw = MarketParams(address(loan), address(stock), address(price), address(irm), Risk.LLTV);
        morpho.createMarket(raw);
        loan.mint(address(this), 100_000e18);
        morpho.supply(raw, 100_000e18, 0, address(this), "");
        vm.startPrank(alice);
        stock.approve(address(morpho), type(uint256).max);
        morpho.supplyCollateral(raw, 10e18, alice, "");
        morpho.borrow(raw, 900e18, 0, alice, alice);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        price.set(120e36);
        loan.mint(delegate, 1000e18);
        vm.startPrank(delegate);
        loan.approve(address(morpho), type(uint256).max);
        (uint256 seized, uint256 repaid) = morpho.liquidate(raw, alice, 0, 100e24, "");
        vm.stopPrank();
        string memory fixture = vm.readFile("test/fixtures/morpho-replay.json");
        assertEq(seized, vm.parseUint(vm.parseJsonString(fixture, ".result.seized_assets")));
        assertEq(repaid, vm.parseUint(vm.parseJsonString(fixture, ".result.repaid_assets")));
        (uint128 supplyAssets, uint128 supplyShares, uint128 borrowAssets, uint128 borrowShares,,) =
            morpho.market(raw.id());
        assertEq(supplyAssets, vm.parseUint(vm.parseJsonString(fixture, ".result.total_supply_assets")));
        assertEq(supplyShares, vm.parseUint(vm.parseJsonString(fixture, ".result.total_supply_shares")));
        assertEq(borrowAssets, vm.parseUint(vm.parseJsonString(fixture, ".result.total_borrow_assets")));
        assertEq(borrowShares, vm.parseUint(vm.parseJsonString(fixture, ".result.total_borrow_shares")));
        (, uint128 remainingShares, uint128 collateral) = morpho.position(raw.id(), alice);
        assertEq(remainingShares, vm.parseUint(vm.parseJsonString(fixture, ".result.remaining_borrow_shares")));
        assertEq(collateral, vm.parseUint(vm.parseJsonString(fixture, ".result.remaining_collateral")));
    }

    function test_OperationalRecoveryIsDelayedAndGuardianCanCancel() public {
        BlueRiskExecutor executor = _executor();
        vm.prank(guardian);
        router.pause();
        bytes memory data = abi.encodeCall(BlueRouter.unpause, ());
        bytes32 digest = executor.scheduleAdminCall(data, 1);
        vm.expectRevert(BlueRiskExecutor.NotReady.selector);
        executor.executeAdminCall(data, 1);
        vm.prank(guardian);
        executor.cancel(digest);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(BlueRiskExecutor.NotReady.selector);
        executor.executeAdminCall(data, 1);
        executor.scheduleAdminCall(data, 2);
        vm.warp(block.timestamp + 1 days);
        executor.executeAdminCall(data, 2);
        assertFalse(router.paused());
        vm.expectRevert(BlueRiskExecutor.NotReady.selector);
        executor.executeAdminCall(data, 2);
        vm.expectRevert(BlueRiskExecutor.InvalidUpdate.selector);
        executor.scheduleAdminCall(abi.encodeCall(BlueRouter.setMargin, (mp, 1)), 3);
    }

    function test_GuardianRotationRevokesExecutorAuthorityToo() public {
        BlueRiskExecutor executor = _executor();
        bytes memory rotation = abi.encodeCall(BlueRouter.setGuardian, (delegate));
        executor.scheduleAdminCall(rotation, 1);
        vm.warp(block.timestamp + 1 days);
        executor.executeAdminCall(rotation, 1);
        assertEq(executor.GUARDIAN(), delegate);
        BlueRiskExecutor.Update memory u = _update(executor);
        vm.prank(guardian);
        vm.expectRevert(BlueRiskExecutor.Unauthorized.selector);
        executor.tighten(u);
        vm.prank(delegate);
        executor.tighten(u);
    }

    function testFuzz_ReceiptSupplyMaintainsOneToOneBacking(uint96 amount) public {
        amount = uint96(bound(amount, 1, 90e18));
        BlueRouter.Attestation memory none;
        vm.prank(alice);
        router.supplyCollateralAndBorrow(mp, amount, 0, alice, none);
        assertEq(receipt.totalSupply(), stock.balanceOf(address(receipt)));
        vm.prank(alice);
        router.withdrawCollateral(mp, amount, alice);
        assertEq(receipt.totalSupply(), 0);
        assertEq(stock.balanceOf(alice), 100e18);
    }
}
