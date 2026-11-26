"""Small SQLite audit store; replace via this interface for a Postgres deployment."""
import json
import sqlite3
import threading
from datetime import datetime, timezone


class AuditStore:
    def __init__(self, path: str = "risk.sqlite3"):
        self._connection = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.RLock()
        with self._connection:
            self._connection.execute("CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, asset TEXT NOT NULL, as_of TEXT NOT NULL, payload TEXT NOT NULL)")
            self._connection.execute("CREATE INDEX IF NOT EXISTS records_asset ON records(kind, asset, as_of, id)")

    def put(self, kind: str, asset: str, as_of: str, payload: dict) -> None:
        as_of = datetime.fromisoformat(as_of).astimezone(timezone.utc).isoformat(timespec="microseconds")
        with self._lock, self._connection:
            self._connection.execute("INSERT INTO records(kind, asset, as_of, payload) VALUES (?, ?, ?, ?)",
                                     (kind, asset, as_of, json.dumps(payload, allow_nan=False)))

    def history(self, kind: str, asset: str, limit: int = 100) -> list[dict]:
        with self._lock:
            rows = self._connection.execute("SELECT payload FROM records WHERE kind=? AND asset=? ORDER BY as_of DESC, id DESC LIMIT ?",
                                             (kind, asset, limit)).fetchall()
        return [json.loads(r[0]) for r in rows]

    def close(self) -> None:
        with self._lock:
            self._connection.close()
