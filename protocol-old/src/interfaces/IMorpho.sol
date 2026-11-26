// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// Minimal vendored subset of the Morpho Blue interface
/// (morpho-org/morpho-blue src/interfaces/IMorpho.sol). Signatures only, no logic.
/// The fork test checks these selectors against the canonical BNB singleton.

type Id is bytes32;

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

interface IMorpho {
    function owner() external view returns (address);
    function isIrmEnabled(address irm) external view returns (bool);
    function isLltvEnabled(uint256 lltv) external view returns (bool);
    function isAuthorized(address authorizer, address authorized) external view returns (bool);

    function position(Id id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);

    function market(Id id)
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );

    function idToMarketParams(Id id)
        external
        view
        returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv);

    function createMarket(MarketParams memory marketParams) external;

    function supply(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256 assetsSupplied, uint256 sharesSupplied);

    function withdraw(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);

    function borrow(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external
        returns (uint256 assetsBorrowed, uint256 sharesBorrowed);

    function repay(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
        external
        returns (uint256 assetsRepaid, uint256 sharesRepaid);

    function supplyCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, bytes memory data)
        external;

    function withdrawCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, address receiver)
        external;

    function liquidate(
        MarketParams memory marketParams,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        bytes memory data
    ) external returns (uint256, uint256);

    function setAuthorization(address authorized, bool newIsAuthorized) external;
}

/// Same id derivation as Morpho's MarketParamsLib: keccak256 over the 5-word struct encoding.
library MarketParamsLib {
    function id(MarketParams memory marketParams) internal pure returns (Id marketParamsId) {
        marketParamsId = Id.wrap(keccak256(abi.encode(marketParams)));
    }
}
