"""
BakeSuite Database Bootstrap Script
Initializes the 'bakesuite' database on PostgreSQL 18 and ensures:
- public schema (ERP Core transactions)
- ml schema (Feature store, model registry, forecasts)
"""
import os
import sys
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
TARGET_DB = os.getenv("DB_NAME", "bakesuite")

def init_database():
    print(f"Connecting to PostgreSQL at {DB_HOST}:{DB_PORT} as {DB_USER}...")
    try:
        conn = psycopg2.connect(
            dbname="postgres",
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        
        # Check if target database exists
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s;", (TARGET_DB,))
        exists = cur.fetchone()
        if not exists:
            print(f"Creating database '{TARGET_DB}'...")
            cur.execute(f'CREATE DATABASE "{TARGET_DB}";')
            print(f"Database '{TARGET_DB}' created successfully.")
        else:
            print(f"Database '{TARGET_DB}' already exists.")
            
        cur.close()
        conn.close()
        
        # Connect to target database to create schemas
        print(f"Connecting to '{TARGET_DB}' to verify/create schemas...")
        app_conn = psycopg2.connect(
            dbname=TARGET_DB,
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT
        )
        app_conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        app_cur = app_conn.cursor()
        
        # Ensure public and ml schemas exist
        app_cur.execute("CREATE SCHEMA IF NOT EXISTS public;")
        app_cur.execute("CREATE SCHEMA IF NOT EXISTS ml;")
        print("Ensured schemas 'public' and 'ml' exist in database.")
        
        # Verify
        app_cur.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('public', 'ml');")
        schemas = [row[0] for row in app_cur.fetchall()]
        print(f"Verified schemas present: {schemas}")
        
        app_cur.close()
        app_conn.close()
        print("Database initialization completed successfully.")
        return 0
    except Exception as e:
        print(f"Error during database initialization: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(init_database())
