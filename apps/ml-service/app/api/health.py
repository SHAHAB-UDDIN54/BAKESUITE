from fastapi import APIRouter
from datetime import datetime
import zoneinfo
from config import settings
from app.core.db import check_db_connection
from app.core.cache import cache

router = APIRouter(prefix="/ml/v1", tags=["Health"])

@router.get("/health")
def health_check():
    db_status = check_db_connection()
    cache_alive = cache.ping()
    
    # Format time in Asia/Karachi
    now_utc = datetime.now(zoneinfo.ZoneInfo("UTC"))
    now_karachi = now_utc.astimezone(zoneinfo.ZoneInfo(settings.TIMEZONE))
    
    healthy = db_status["connected"] and cache_alive
    
    return {
        "status": "healthy" if healthy else "degraded",
        "service": "bakesuite-ml-service",
        "version": "1.0.0",
        "timestamp_utc": now_utc.isoformat(),
        "timestamp_karachi": now_karachi.strftime("%d-%m-%Y %H:%M:%S"),
        "timezone": settings.TIMEZONE,
        "database": {
            "connected": db_status["connected"],
            "target_schema": settings.DB_SCHEMA,
            "active_schema": db_status["schema"],
            "server_time": db_status["server_time"],
            "error": db_status["error"]
        },
        "feature_cache": {
            "status": "online",
            "is_in_memory_fallback": cache.is_mock
        }
    }
