// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMorpho, Id, MarketParams, MarketParamsLib} from "../../src/interfaces/IMorpho.sol";
import {IRegimeRegistry} from "../../src/interfaces/IRegimeRegistry.sol";
import {BlueRouter} from "../../src/BlueRouter.sol";
import {BlueDeploy} from "../../script/BlueDeploy.sol";

interface IERC20T {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Shared fork setup: runs the same BlueDeploy code as script/Deploy.s.sol on a BNB Chain fork, then moves time
/// forward to the next OPEN session. RPC: BSC_RPC_URL, else the public endpoint. All tests are skipped (not failed)
/// if the fork cannot be created.
abstract contract ScenarioBase is Test, BlueDeploy {
    using MarketParamsLib for MarketParams;

    IMorpho internal constant M = IMorpho(MORPHO);
    uint256 internal constant SEED = 100_000e18;
    int256 internal constant PRICE0 = 200e8; // $200 per UI share

    bool internal forked;
    Deployment internal d;
    address internal keeper = makeAddr("keeper");
    address internal guardian = makeAddr("guardian");
    address internal borrower = makeAddr("borrower");
    address internal liquidator = makeAddr("liquidator");
    uint256 internal signerKey = DEMO_SIGNER_KEY;
    uint256 internal nextNonce = 1;

    modifier onlyFork() {
        vm.skip(!forked);
        _;
    }

    function setUp() public virtual {
        string memory url = vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.binance.org"));
        try vm.createSelectFork(url) {
            forked = true;
        } catch {
            forked = false;
        }
        if (!forked) return;

        deal(USDT, address(this), SEED);
        d = _deployBlue(
            DeployParams({
                deployer: address(this),
                keeper: keeper,
                signer: vm.addr(signerKey),
                guardian: guardian,
                seedSupply: SEED,
                initialPrice: PRICE0
            })
        );
        _warpToNextOpen();
        _refresh(PRICE0);
    }

    // ------------------------------------------------------------ helpers

    function _warpToNextOpen() internal {
        uint256 t = block.timestamp;
        for (uint256 i; i < 7 * 96 && d.registry.calendarRegimeAt(t) != IRegimeRegistry.Regime.OPEN; ++i) {
            t += 15 minutes;
        }
        require(d.registry.calendarRegimeAt(t) == IRegimeRegistry.Regime.OPEN, "no OPEN session within a week");
        vm.warp(t + 1 minutes); // forward only: Morpho accrual requires monotone time
    }

    /// Push a fresh feed answer and record it.
    function _refresh(int256 answer) internal {
        d.feed.setAnswer(answer);
        d.oracle.update();
    }

    function _attest(address account) internal returns (BlueRouter.Attestation memory a) {
        a.nonce = nextNonce++;
        a.expiry = block.timestamp + 10 minutes;
        a.signature = _sign(signerKey, account, a.nonce, a.expiry);
    }

    function _sign(uint256 key, address account, uint256 nonce, uint256 expiry) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, d.router.eligibilityDigest(account, nonce, expiry));
        return abi.encodePacked(r, s, v);
    }

    function _noAttestation() internal pure returns (BlueRouter.Attestation memory a) {}

    /// Mint collateral to `who`, approve the router, authorize it on Morpho.
    function _prepare(address who, uint256 collateral) internal {
        d.bStock.mint(who, collateral);
        vm.startPrank(who);
        d.bStock.approve(address(d.router), type(uint256).max);
        M.setAuthorization(address(d.router), true);
        vm.stopPrank();
    }

    /// Supply collateral and borrow `amount` through the router.
    function _open(address who, uint256 collateral, uint256 amount) internal {
        _prepare(who, collateral);
        BlueRouter.Attestation memory a = _attest(who);
        vm.prank(who);
        d.router.supplyCollateralAndBorrow(d.marketParams, collateral, amount, who, a);
    }

    /// Supply collateral, then borrow exactly the router's current limit.
    function _openAtLimit(address who, uint256 collateral) internal returns (uint256 amount) {
        _prepare(who, collateral);
        vm.prank(who);
        d.router.supplyCollateralAndBorrow(d.marketParams, collateral, 0, who, _noAttestation());
        amount = d.router.borrowLimit(d.marketId, who);
        BlueRouter.Attestation memory a = _attest(who);
        vm.prank(who);
        d.router.supplyCollateralAndBorrow(d.marketParams, 0, amount, who, a);
    }

    function _debt(MarketParams memory mp, address who) internal view returns (uint256) {
        Id id = mp.id();
        (, uint128 shares,) = M.position(id, who);
        (,, uint128 tba, uint128 tbs,,) = M.market(id);
        return (uint256(shares) * (uint256(tba) + 1) + (uint256(tbs) + 1e6) - 1) / (uint256(tbs) + 1e6);
    }

    /// Morpho health factor (1e18 = liquidation threshold), using the market's own oracle and LLTV.
    function _health(MarketParams memory mp, address who) internal view returns (uint256) {
        (,, uint128 coll) = M.position(mp.id(), who);
        uint256 debt = _debt(mp, who);
        if (debt == 0) return type(uint256).max;
        uint256 maxBorrow = (((uint256(coll) * IOraclePrice(mp.oracle).price()) / 1e36) * mp.lltv) / 1e18;
        return (maxBorrow * 1e18) / debt;
    }

    function _liquidatable(MarketParams memory mp, address who) internal view returns (bool) {
        return _health(mp, who) < 1e18;
    }

    /// Liquidator repays all of `who`'s borrow shares on `mp` via Morpho liquidate().
    function _liquidateAll(MarketParams memory mp, address who) internal returns (uint256 seized, uint256 repaid) {
        (, uint128 shares,) = M.position(mp.id(), who);
        deal(USDT, liquidator, 1_000_000e18);
        vm.startPrank(liquidator);
        IERC20T(USDT).approve(MORPHO, type(uint256).max);
        (seized, repaid) = M.liquidate(mp, who, 0, shares, "");
        vm.stopPrank();
    }

    function _expectLiquidateReverts(MarketParams memory mp, address who) internal {
        (, uint128 shares,) = M.position(mp.id(), who);
        deal(USDT, liquidator, 1_000_000e18);
        vm.startPrank(liquidator);
        IERC20T(USDT).approve(MORPHO, type(uint256).max);
        vm.expectRevert(bytes("position is healthy"));
        M.liquidate(mp, who, 0, shares, "");
        vm.stopPrank();
    }
}

interface IOraclePrice {
    function price() external view returns (uint256);
}
