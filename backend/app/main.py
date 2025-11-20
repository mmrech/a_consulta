"""
La Consulta Backend API
Main application entry point with all routers configured
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import auth, ai, documents, extractions, annotations

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Backend API for La Consulta Clinical Extractor - Secure AI proxy and data management"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.CORS_ORIGINS == "*" else settings.cors_origins_list,  # Frontend URLs
    allow_credentials=False if settings.CORS_ORIGINS == "*" else True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],  # Restrict to common HTTP methods
    allow_headers=["*"],  # Allow all headers for development
)

app.include_router(auth.router)
app.include_router(ai.router)
app.include_router(documents.router)
app.include_router(extractions.router)
app.include_router(annotations.router)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "La Consulta Backend API",
        "version": settings.APP_VERSION,
        "status": "running"
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "version": settings.APP_VERSION,
        "debug": settings.DEBUG
    }


@app.get("/healthz")
async def healthz():
    """Health check endpoint for deployment"""
    return {"status": "ok"}
