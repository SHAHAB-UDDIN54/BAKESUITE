import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PORT: int = int(os.getenv("PORT", "8000"))
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    
    # Strictly isolate to 'ml' schema in PostgreSQL
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:@localhost:5432/bakesuite")
    DB_SCHEMA: str = os.getenv("DB_SCHEMA", "ml")
    
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    USE_MOCK_CACHE: bool = os.getenv("USE_MOCK_CACHE", "true").lower() in ("true", "1", "yes")
    
    TIMEZONE: str = os.getenv("TIMEZONE", "Asia/Karachi")
    ALLOWED_ORIGINS: list = [o.strip() for o in os.getenv("ML_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000").split(",") if o.strip()]

    # Business rule elasticity adjustment for promotional scenario rescoring:
    # 1.5% demand uplift per 1% promotional depth (Documented business rule adjustment, not a learned ML weight)
    PROMOTION_BUSINESS_RULE_ELASTICITY: float = float(os.getenv("PROMOTION_BUSINESS_RULE_ELASTICITY", "0.015"))
    
settings = Settings()
