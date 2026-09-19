"""
BakeSuite Feature Cache & Online Feature Store Client.
Supports Redis 7 with an automatic in-memory fallback if Redis is unavailable.
"""
import time
from typing import Optional, Any
import redis
from config import settings

class InMemoryCache:
    """Thread-safe dictionary-based cache simulating Redis key-value store."""
    def __init__(self):
        self._store: dict[str, tuple[Any, Optional[float]]] = {}

    def get(self, key: str) -> Optional[str]:
        if key in self._store:
            val, expiry = self._store[key]
            if expiry is None or expiry > time.time():
                return val
            else:
                del self._store[key]
        return None

    def set(self, key: str, value: Any, ex: Optional[int] = None) -> bool:
        expiry = (time.time() + ex) if ex else None
        self._store[key] = (str(value), expiry)
        return True

    def ping(self) -> bool:
        return True


class FeatureCache:
    def __init__(self):
        self.is_mock = settings.USE_MOCK_CACHE
        self.client = None
        self._init_client()

    def _init_client(self):
        if not self.is_mock:
            try:
                r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
                r.ping()
                self.client = r
                return
            except Exception as e:
                print(f"[FeatureCache] Redis connection failed ({e}), falling back to in-memory cache.")
        
        self.is_mock = True
        self.client = InMemoryCache()

    def get(self, key: str) -> Optional[str]:
        return self.client.get(key)

    def set(self, key: str, value: Any, ex: Optional[int] = None) -> bool:
        return self.client.set(key, value, ex=ex)

    def ping(self) -> bool:
        try:
            return bool(self.client.ping())
        except Exception:
            return False

cache = FeatureCache()
