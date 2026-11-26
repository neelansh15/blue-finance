"""Bounded in-memory cache for identical external requests, including failures."""
from collections import OrderedDict
from threading import RLock
from time import monotonic
from typing import Callable, Generic, TypeVar

API_CACHE_SECONDS = 60
T = TypeVar("T")


class ApiCache(Generic[T]):
    def __init__(self, clock=monotonic, max_entries=256):
        self.clock, self.max_entries = clock, max_entries
        self.entries = OrderedDict()
        self.lock = RLock()

    def get(self, key: str, load: Callable[[], T]) -> T:
        # Holding the lock through the request coalesces simultaneous callers.
        with self.lock:
            now = self.clock()
            hit = self.entries.get(key)
            if hit is None or not 0 <= now - hit[0] < API_CACHE_SECONDS:
                self.entries.pop(key, None)
                for old_key, entry in list(self.entries.items()):
                    if not 0 <= now - entry[0] < API_CACHE_SECONDS:
                        del self.entries[old_key]
                try:
                    hit = (now, load(), False)
                except Exception:
                    # Do not retain provider bodies, keys, or tracebacks in cached errors.
                    hit = (now, None, True)
                if len(self.entries) >= self.max_entries:
                    self.entries.popitem(last=False)
                self.entries[key] = hit
            if hit[2]:
                raise RuntimeError("External API request unavailable")
            return hit[1]
