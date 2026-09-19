from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from app.api.health import router as health_router
from app.api.forecast import router as forecast_router

app = FastAPI(
    title="BakeSuite ML Microservice",
    description="Dedicated ML Inference & Feature Engineering Engine for BakeSuite ERP",
    version="1.0.0",
    docs_url="/ml/v1/docs",
    openapi_url="/ml/v1/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(forecast_router)

@app.get("/")
def root():
    return {
        "service": "bakesuite-ml-service",
        "status": "online",
        "docs": "/ml/v1/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=True)
