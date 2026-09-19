"""
BakeSuite ML Database Engine
Strictly configured to target the 'ml' schema in PostgreSQL.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from config import settings

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"options": f"-csearch_path={settings.DB_SCHEMA}"},
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def check_db_connection() -> dict:
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT current_schema(), current_timestamp;")).fetchone()
            schema, ts = result[0], result[1]
            return {
                "connected": True,
                "schema": schema,
                "server_time": str(ts),
                "error": None
            }
    except Exception as e:
        return {
            "connected": False,
            "schema": settings.DB_SCHEMA,
            "server_time": None,
            "error": str(e)
        }
