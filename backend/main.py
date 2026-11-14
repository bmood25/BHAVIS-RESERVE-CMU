# Entrypoint for Vercel's FastAPI runtime (and `uvicorn main:app`). The app itself lives in app/main.py.
from app.main import app

__all__ = ["app"]
