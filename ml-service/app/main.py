"""Team 37 ML service. Run from ml-service/:  uvicorn app.main:app --port 8000 --reload"""
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import anomaly, prediction, suggestions

load_dotenv()

app = FastAPI(title="Team 37 ML service", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(anomaly.router, prefix="/anomaly", tags=["anomaly (Layer 2)"])
app.include_router(prediction.router, prefix="/prediction", tags=["prediction"])
app.include_router(suggestions.router, prefix="/suggestions", tags=["suggestions"])


@app.get("/health")
def health():
    return {"status": "ok"}
