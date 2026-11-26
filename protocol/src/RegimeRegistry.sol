// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IRegimeRegistry, RegimeLib} from "./interfaces/IRegimeRegistry.sol";
import {EasternCalendar} from "./libraries/EasternCalendar.sol";

/// @title RegimeRegistry
/// @notice Market-regime source for BlueOracle and BlueRouter.
///         Calendar part: US Eastern sessions with on-chain DST, an admin-set holiday table and early closes.
///         Override part: a keeper can push an asset (or all assets via address(0)) into a more conservative
///         regime for a bounded duration. The effective regime is the most conservative of calendar and
///         active overrides, so a keeper can never make the effective regime less conservative than the calendar.
/// @dev Sessions (ET, weekdays that are not holidays):
///        00:00-04:00 CLOSED, 04:00-09:30 EXTENDED (pre), 09:30-16:00 OPEN, 16:00-20:00 EXTENDED (post),
///        20:00-24:00 CLOSED, or WEEKEND if the next calendar day is a weekend day or a holiday.
///      Early close days: OPEN ends 13:00, EXTENDED (post) ends 17:00.
///      Saturday, Sunday before 20:00 and holidays (until 20:00) are WEEKEND. Sunday 20:00+ is CLOSED,
///      or WEEKEND if Monday is a holiday.
///      This function must never revert for real block timestamps: the oracle depends on it.
contract RegimeRegistry is IRegimeRegistry {
    using RegimeLib for Regime;

    struct Override {
        Regime state;
        uint64 expiry;
    }

    /// Hard ceiling for the configurable override bound.
    uint64 public constant HARD_MAX_OVERRIDE = 30 days;

    /// Maximum duration of a single keeper/admin override.
    uint64 public immutable MAX_OVERRIDE;

    address public admin;
    address public pendingAdmin;
    mapping(address => bool) public isKeeper;
    /// If false, only ADMIN can clear an override early (keepers wait for expiry).
    bool public keeperCanClear;

    mapping(uint32 => bool) public isHoliday;
    mapping(uint32 => bool) public isEarlyClose;
    mapping(address => Override) internal _overrides;

    event KeeperSet(address indexed keeper, bool enabled);
    event KeeperCanClearSet(bool enabled);
    event HolidaySet(uint32 indexed yyyymmdd, bool closed);
    event EarlyCloseSet(uint32 indexed yyyymmdd, bool early);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed current);

    error Unauthorized();
    error ZeroAddress();
    error InvalidDuration();
    error InvalidDate(uint32 yyyymmdd);
    error InvalidRegime();
    error NotMoreConservative();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address admin_, address keeper_, uint64 maxOverride_, bool keeperCanClear_) {
        if (admin_ == address(0)) revert ZeroAddress();
        if (maxOverride_ == 0 || maxOverride_ > HARD_MAX_OVERRIDE) revert InvalidDuration();
        admin = admin_;
        MAX_OVERRIDE = maxOverride_;
        keeperCanClear = keeperCanClear_;
        emit AdminTransferred(address(0), admin_);
        emit KeeperCanClearSet(keeperCanClear_);
        if (keeper_ != address(0)) {
            isKeeper[keeper_] = true;
            emit KeeperSet(keeper_, true);
        }
    }

    // ---------------------------------------------------------------- views

    function regime(address asset) external view returns (Regime r) {
        r = calendarRegimeAt(block.timestamp);
        Override memory o = _overrides[asset];
        if (o.expiry > block.timestamp) r = RegimeLib.moreConservative(r, o.state);
        if (asset != address(0)) {
            Override memory g = _overrides[address(0)];
            if (g.expiry > block.timestamp) r = RegimeLib.moreConservative(r, g.state);
        }
    }

    function calendarRegime() external view returns (Regime) {
        return calendarRegimeAt(block.timestamp);
    }

    /// Raw stored override (may be expired; compare expiry with block.timestamp).
    function overrideOf(address asset) external view returns (Regime state, uint64 expiry) {
        Override memory o = _overrides[asset];
        return (o.state, o.expiry);
    }

    function calendarRegimeAt(uint256 t) public view returns (Regime) {
        uint256 local = EasternCalendar.toEastern(t);
        uint256 day = local / EasternCalendar.SECONDS_PER_DAY;
        uint256 mins = (local % EasternCalendar.SECONDS_PER_DAY) / 60;
        uint256 dow = EasternCalendar.dayOfWeek(day);

        if (dow == 6) return Regime.WEEKEND; // Saturday
        if (dow == 0) {
            // Sunday: weekend until 20:00, then the overnight session before Monday.
            if (mins < 20 * 60) return Regime.WEEKEND;
            return _isHolidayDay(day + 1) ? Regime.WEEKEND : Regime.CLOSED;
        }

        if (_isHolidayDay(day)) {
            if (mins < 20 * 60) return Regime.WEEKEND;
            return _overnightAfter(day, dow);
        }

        bool early = isEarlyClose[EasternCalendar.toYmd(day)];
        uint256 closeAt = early ? 13 * 60 : 16 * 60;
        uint256 postEnd = early ? 17 * 60 : 20 * 60;

        if (mins < 4 * 60) return Regime.CLOSED;
        if (mins < 9 * 60 + 30) return Regime.EXTENDED;
        if (mins < closeAt) return Regime.OPEN;
        if (mins < postEnd) return Regime.EXTENDED;
        return _overnightAfter(day, dow);
    }

    function _overnightAfter(uint256 day, uint256 dow) internal view returns (Regime) {
        if (dow == 5 || _isHolidayDay(day + 1)) return Regime.WEEKEND;
        return Regime.CLOSED;
    }

    function _isHolidayDay(uint256 day) internal view returns (bool) {
        return isHoliday[EasternCalendar.toYmd(day)];
    }

    // ---------------------------------------------------------------- overrides

    /// @notice Push `asset` (address(0) = all assets) into regime `r` for `duration` seconds.
    /// @dev Callable by KEEPER or ADMIN. Rules:
    ///      - r must not be OPEN; 0 < duration <= MAX_OVERRIDE.
    ///      - If an override is active, the new one must be at least as conservative and must not expire
    ///        earlier. Setting can therefore never relax the effective regime; relaxing is clearOverride's job.
    function setOverride(address asset, Regime r, uint64 duration) external {
        if (!isKeeper[msg.sender] && msg.sender != admin) revert Unauthorized();
        if (r == Regime.OPEN) revert InvalidRegime();
        if (duration == 0 || duration > MAX_OVERRIDE) revert InvalidDuration();

        uint64 expiry = uint64(block.timestamp) + duration;
        Override memory cur = _overrides[asset];
        if (cur.expiry > block.timestamp) {
            if (r.rank() < cur.state.rank() || expiry < cur.expiry) revert NotMoreConservative();
        }
        _overrides[asset] = Override({state: r, expiry: expiry});
        emit OverrideSet(asset, r, expiry, msg.sender);
    }

    /// @notice Remove an override early. ADMIN always; KEEPER only when `keeperCanClear` is enabled.
    function clearOverride(address asset) external {
        if (msg.sender != admin && !(keeperCanClear && isKeeper[msg.sender])) revert Unauthorized();
        delete _overrides[asset];
        emit OverrideCleared(asset, msg.sender);
    }

    // ---------------------------------------------------------------- admin

    function setHoliday(uint32 yyyymmdd, bool closed) public onlyAdmin {
        if (!EasternCalendar.isValidYmd(yyyymmdd)) revert InvalidDate(yyyymmdd);
        isHoliday[yyyymmdd] = closed;
        emit HolidaySet(yyyymmdd, closed);
    }

    function setHolidays(uint32[] calldata dates, bool closed) external {
        for (uint256 i; i < dates.length; ++i) {
            setHoliday(dates[i], closed);
        }
    }

    function setEarlyClose(uint32 yyyymmdd, bool early) public onlyAdmin {
        if (!EasternCalendar.isValidYmd(yyyymmdd)) revert InvalidDate(yyyymmdd);
        isEarlyClose[yyyymmdd] = early;
        emit EarlyCloseSet(yyyymmdd, early);
    }

    function setEarlyCloses(uint32[] calldata dates, bool early) external {
        for (uint256 i; i < dates.length; ++i) {
            setEarlyClose(dates[i], early);
        }
    }

    function setKeeper(address keeper, bool enabled) external onlyAdmin {
        if (keeper == address(0)) revert ZeroAddress();
        isKeeper[keeper] = enabled;
        emit KeeperSet(keeper, enabled);
    }

    function setKeeperCanClear(bool enabled) external onlyAdmin {
        keeperCanClear = enabled;
        emit KeeperCanClearSet(enabled);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        emit AdminTransferred(admin, msg.sender);
        admin = msg.sender;
        pendingAdmin = address(0);
    }
}
