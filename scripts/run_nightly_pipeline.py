"""
BakeSuite ERP — Nightly Pipeline Production Entrypoint
Executes the nightly ETL -> Redis Feature Refresh -> 35-Day Batch Forecast Scoring sequence
in Asia/Karachi timezone.
"""
import os
import sys

# Ensure ml-service is in sys.path
ml_service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "apps", "ml-service"))
sys.path.insert(0, ml_service_dir)

from app.serving.nightly_pipeline import run_full_nightly_pipeline

if __name__ == "__main__":
    result = run_full_nightly_pipeline()
    sys.exit(0 if result.get("status") == "COMPLETED" else 1)
