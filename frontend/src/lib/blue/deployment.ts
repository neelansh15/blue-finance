// Blue Finance on BNB Smart Chain mainnet. Addresses and creation transactions come from the
// DeployBsc.s.sol broadcast record. Explorer source verification is a separate step; see the docs page.
import type { Address, Hex } from "viem";

export type DeployedContract = { label: string; contract: string; address: Address; created: Hex; role: string };
export type DeploymentGroup = { id: string; title: string; contracts: DeployedContract[] };

export const DEPLOYMENT = {
  chainId: 56,
  transactions: 59,
  firstTransaction: "0xc84e46923f3b27e8e038716ac4aa6006a6fa9bd0d3b28fe0bcee0ce43ffd51ca" as Hex,
  finalTransaction: "0x38cf51152ebfed7579b9ebd700c381a622f849115887a0045692113529443cac" as Hex,
  firstBlock: 135915898,
  finalBlock: 135916697,
} as const;

export const DEPLOYMENT_GROUPS: DeploymentGroup[] = [
  {
    id: "core", title: "Pool and configurator", contracts: [
      { label: "Pool proxy", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0xDAC47642621B0C3E4191Fe68281EddAC355f12bC", created: "0xae1ec4320e3e94da175551279ca8cfd3a69ee6e3336bab282c1fc0adf7da0d2e", role: "Entry point for supply, withdraw, borrow, repay and liquidation." },
      { label: "Pool implementation", contract: "BluePool", address: "0x361Aa80AeD6348F7e892656b3D9cC3F115503D09", created: "0x4994aad55e67206560f27f427a20776eeffe30ab976538f60b853759667d1634", role: "Logic behind the pool proxy, with Blue’s per-stock rules." },
      { label: "PoolConfigurator proxy", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x6F858Bd70D123d1a4767Db66bcdDE07817f391CE", created: "0xd8419b9dfed791849d287443d3ec9aeb3d775babe6d9b348facdb64b54d2a407", role: "Lists and configures reserves for the pool admin." },
      { label: "PoolConfigurator implementation", contract: "PoolConfiguratorInstance", address: "0x64c29FD88069519C8Cd8f2E4718599eaf5a03a0d", created: "0xc68cb9cfdc8221bb40884e5e3a1d7ec34d94b395ea2418e81f96b5f65bfe3669", role: "Logic behind the configurator proxy." },
      { label: "Interest rate strategy", contract: "DefaultReserveInterestRateStrategyV2", address: "0x11c3A1471aaEC4C0B3239D4c34C5A3F6FD948884", created: "0xb512a661804ef3194ff53d622a3733257c3b3f0c17b828491b48f360851c15c2", role: "Sets the USDT rate curve." },
    ],
  },
  {
    id: "access", title: "Addresses provider and access control", contracts: [
      { label: "PoolAddressesProvider", contract: "PoolAddressesProvider", address: "0x1AfE5e07f6c6f092494DA8423708c412939B6906", created: "0xb289ac1fa8a57508b440f95a4981f62955eeb9d49b170c419437988b53be56ce", role: "Registry for the pool, configurator, oracle and ACL." },
      { label: "ACLManager", contract: "ACLManager", address: "0x396Eb4506C212cC895DBd412318A061C99026fab", created: "0xd21e5a9b57f734ade4fe923b072b230908719383ab94e876578b0ed759b1fe1b", role: "Holds the Aave admin roles." },
      { label: "Pool data provider", contract: "AaveProtocolDataProvider", address: "0xA7DB8D9E04c466126D58379fCFAb2aE0f26a7643", created: "0xbd407994ffef629c1bbc6b35e3bcf45b2e2b0219f49e17121f667d23aa9ae436", role: "Read-only reserve and account data." },
    ],
  },
  {
    id: "controls", title: "Blue controls and calendar", contracts: [
      { label: "StockBorrowControls", contract: "StockBorrowControls", address: "0x9F80DEe6652798855133358a382264986C2A5d4D", created: "0xe5fa5c5b7cab7274ee1f54da57bc5e0fc66d41b93cb9f8720fb7ca04e52d4f31", role: "Eligibility, keeper heartbeat, guardian holds, limits and caps." },
      { label: "MarketCalendar", contract: "MarketCalendar", address: "0x33CcEcEDA8f2f47BdE9f234FF025977aeB292B17", created: "0xe426e33831811893df92ec70aa198dd49b403aec4b0c00ccd3540db146a0c0d4", role: "US market sessions, holidays and status overrides." },
    ],
  },
  {
    id: "oracle", title: "Oracle and price adapters", contracts: [
      { label: "AaveOracle", contract: "AaveOracle", address: "0x727D5D5001717e7F5fAC98c5b134B27487192e4d", created: "0x91417bac480439242d545112d55f6f89decbb02caae60150e45edac55daecb98", role: "Routes each reserve to its price adapter." },
      { label: "USDT price adapter", contract: "StockPriceSource", address: "0xe3329b970Acf9545496786B77aa73639E3F4b489", created: "0xc010ca4b16d7c90a99ec96feec89c78554236d8e3d70305c5c187770a1532f3c", role: "Validates the Chainlink USDT/USD feed." },
      { label: "TSLAB price adapter", contract: "StockPriceSource", address: "0x2162Ba3A993BC8442CEE02340693D1818bbB6826", created: "0x5a8f88d12f30bc35c28b475ed64afa1aaadad4b7f5ddab3c8cd7a057656664b1", role: "Validates the Atlas TSLAB/USD feed." },
      { label: "NVDAB price adapter", contract: "StockPriceSource", address: "0xE28c1AFf5549CBAD6e7Dfb09C7446CC8EDA6Cb3D", created: "0x43b3826d0fffbe19d4f0378a49f3921614f9af8063882fde26ac31aff3438ba9", role: "Validates the Atlas NVDAB/USD feed." },
      { label: "QQQB price adapter", contract: "StockPriceSource", address: "0xC0a4c6fb4dF398c64B48b19898e5BE1375a83c67", created: "0x406538af32aa062f4ceb7dbe7bbe568bb5db7dfdb4f7d64529d31d551d1212b3", role: "Validates the Atlas QQQB/USD feed." },
      { label: "SPCXB price adapter", contract: "StockPriceSource", address: "0x57569eEDA113AF59BFcEfd549610AF6692fD0772", created: "0x816b35d3d9ee335bde29a4e7844e88d4c83e49e71a10b03c2a32ceb35c44423a", role: "Validates the Atlas SPCXB/USD feed." },
      { label: "GOOGLB price adapter", contract: "StockPriceSource", address: "0x289Ae6026ae1a9E02fC4dC964861e72473E5f28e", created: "0x8ac9ba831f974367048485c4edd088424fd3ca22898be68db8fd9c9ca9ba0272", role: "Validates the Atlas GOOGLB/USD feed." },
    ],
  },
  {
    id: "libraries", title: "Linked libraries", contracts: [
      { label: "BorrowLogic", contract: "BorrowLogic", address: "0x5db95B53bD4Ec673E780Ecb6aBD7cd1214b3D0c3", created: "0xc84e46923f3b27e8e038716ac4aa6006a6fa9bd0d3b28fe0bcee0ce43ffd51ca", role: "Borrow and repay logic." },
      { label: "SupplyLogic", contract: "SupplyLogic", address: "0x860b68D6D716b70B36Ab2Db22c4179BE53655F06", created: "0x00660b4b63c6610561b41de726697326609624e495f0506ab25a33abf80209e3", role: "Supply, withdraw and collateral logic." },
      { label: "PoolLogic", contract: "PoolLogic", address: "0xDd53005006932993927F8B0a1f8b52cE1643bfDe", created: "0x8ac65ba00687268c73d55bb9b2a6ad14431aceb6e625d3daf1390ea8a7b9d9df", role: "Reserve initialisation and account data." },
      { label: "LiquidationLogic", contract: "LiquidationLogic", address: "0xb15A65C1749d7B4E0EC6E5DE15a18a89d5C39562", created: "0x2a5549f822a0065a63be469e93845c319574db6241b598a93831215966379d1f", role: "Liquidation and deficit logic." },
      { label: "FlashLoanLogic", contract: "FlashLoanLogic", address: "0x91F4c4b34658E0D401695Ae61e4bdD003AF00415", created: "0x59e08af3d01fc7fa8ffeb35157bbf2216fc6f1279dc0fc2514fb53d723d88763", role: "Linked by Aave. BluePool disables flash loans." },
      { label: "ConfiguratorLogic", contract: "ConfiguratorLogic", address: "0x28c3FCE6e8f9376b443736F4051b67C9E05F66d7", created: "0x6a79a7e71157e55ae9f1812b9aacd37e19a6b0408d46c1e2324f84b60a9e12a4", role: "Reserve token deployment and upgrades." },
    ],
  },
  {
    id: "token-implementations", title: "Reserve token implementations", contracts: [
      { label: "bluToken implementation", contract: "ATokenInstance", address: "0x08700D38b0A1F4867295A994b4ac1e0b45f04836", created: "0x3d8216e075caf5e578a9b5bc6089b7b7352a9b58d4f0b0cdc53f1210d05537d8", role: "Shared logic for every supply receipt token." },
      { label: "bluDebtToken implementation", contract: "VariableDebtTokenInstance", address: "0x008A68039497A3D65226fa9DC7BC495Ce91e0ED3", created: "0xde26dcbf0e6f22b6827b8869cbcb9d5ee5789cd1d776a6376c449ea74ffa43fc", role: "Shared logic for every variable debt token." },
    ],
  },
];

/** Per-reserve receipt and debt token proxies, created when the reserves were initialised. */
export const RESERVE_TOKENS: { asset: string; receipt: DeployedContract; debt: DeployedContract }[] = [
  {
    asset: "USDT",
    receipt: { label: "bluUSDT", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0xCaa9baB69a15A5d33A13e568585f9731BF08D770", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Supply receipt for USDT lenders." },
    debt: { label: "bluDebtUSDT", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x2FeC243c3FA490aC6057A941667D27144463498F", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Variable USDT debt of borrowers." },
  },
  {
    asset: "TSLAB",
    receipt: { label: "bluTSLAB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x3166E2F85D77bF8117c9E4Ca1CFDFC70bF8b94d8", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Receipt for supplied TSLAB collateral." },
    debt: { label: "bluDebtTSLAB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x9D788107d2f9A8c659Cb7812b70F37dc92c2315B", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Created by Aave. TSLAB cannot be borrowed." },
  },
  {
    asset: "NVDAB",
    receipt: { label: "bluNVDAB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x0D6b64066484Be4BB1a0161e75233fF0D320209a", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Receipt for supplied NVDAB collateral." },
    debt: { label: "bluDebtNVDAB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0xdBcadF84F627cdCd4805319528fE844565C5D5d7", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Created by Aave. NVDAB cannot be borrowed." },
  },
  {
    asset: "QQQB",
    receipt: { label: "bluQQQB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x9C492566D0dbD3C3EbA8eab13A974270DE33707e", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Receipt for supplied QQQB collateral." },
    debt: { label: "bluDebtQQQB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x707E1F6DcfdF0f149f30bA7abf8F8ce19E74e1a3", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Created by Aave. QQQB cannot be borrowed." },
  },
  {
    asset: "SPCXB",
    receipt: { label: "bluSPCXB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x296967b7D40715DAF61Ef3b15a48D071a6B74423", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Receipt for supplied SPCXB collateral." },
    debt: { label: "bluDebtSPCXB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x8BF8f679007fE5D47960C0DCA6F181CED1bA5a13", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Created by Aave. SPCXB cannot be borrowed." },
  },
  {
    asset: "GOOGLB",
    receipt: { label: "bluGOOGLB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x16eb410564F5c48b4Be8357F3d857105c403d08e", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Receipt for supplied GOOGLB collateral." },
    debt: { label: "bluDebtGOOGLB", contract: "InitializableImmutableAdminUpgradeabilityProxy", address: "0x29c24606618c5986233667379E10Ceba84fde350", created: "0xb363d1fd46a542cd98b71b3cb78e5bada55b5fed1655ba98d6b3fa0f8cbd007f", role: "Created by Aave. GOOGLB cannot be borrowed." },
  },
];

/** Tokens and price feeds that existed before this deployment. Blue neither deployed nor controls them. */
export const EXTERNAL_ASSETS: { asset: string; token: Address; feed: Address; feedName: string }[] = [
  { asset: "USDT", token: "0x55d398326f99059fF775485246999027B3197955", feed: "0xB97Ad0E74fa7d920791E90258A6E2085088b4320", feedName: "Chainlink USDT/USD" },
  { asset: "TSLAB", token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", feed: "0xf569C3e52e797219eCFDc1659c3250B0BbDC693C", feedName: "Atlas TSLAB/USD" },
  { asset: "NVDAB", token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", feed: "0x2bd759006b423BFF444181A13C96a6b134E557BB", feedName: "Atlas NVDAB/USD" },
  { asset: "QQQB", token: "0x205812CdBed920aFf76C6580abD681a46D11efc7", feed: "0xA94918f11c9e7703426CCD494A4a999924942DDD", feedName: "Atlas QQQB/USD" },
  { asset: "SPCXB", token: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1", feed: "0xdf8b61796436eD39F406623aa2166a7f185185Cb", feedName: "Atlas SPCXB/USD" },
  { asset: "GOOGLB", token: "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238", feed: "0x9A47A6560E224a26F663675D5c76888A26cac6C3", feedName: "Atlas GOOGLB/USD" },
];

export const DEPLOYMENT_ACCOUNTS: { address: Address; roles: string }[] = [
  { address: "0xf475D99Be3241c69454eA8AF7B12F38078F697bc", roles: "Deployer, admin (provider owner, ACL admin, pool admin, calendar admin), keeper, price reporter, eligibility signer and bluToken treasury." },
  { address: "0x08DcE649f86AF45dA8648FaD31D1C33A617C52d1", roles: "Guardian on the borrow controls and price adapters. No Aave emergency-admin role." },
];
