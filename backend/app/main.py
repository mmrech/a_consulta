"""
La Consulta Backend API
Main application entry point with all routers configured
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import auth, documents, extractions, annotations, ai, pdf_library
from .models import User, db
from .auth import get_password_hash
from datetime import datetime, timezone


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Backend API for La Consulta Clinical Extractor - Secure AI proxy and data management"
)

# Auto-create demo user on startup (zero-configuration UX)
@app.on_event("startup")
async def startup_event():
    """Create a demo user and initialize PDF library on startup"""
    from datetime import datetime, timezone
    import bcrypt
    import base64
    from pathlib import Path
    from .models import User, PDFLibraryItem, db

    # Create demo user
    demo_email = "demo@example.com"
    demo_password = "demo123"

    if demo_email not in db.users_by_email:
        user_id = db.generate_id()
        password_hash = bcrypt.hashpw(demo_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        now = datetime.now(timezone.utc)

        user = User(
            id=user_id,
            email=demo_email,
            password_hash=password_hash,
            created_at=now,
            updated_at=now
        )

        db.users[user_id] = user
        db.users_by_email[demo_email] = user_id

        print(f"✅ Auto-created demo user: {demo_email}")

    # Initialize PDF library if empty
    if not db.pdf_library:
        now = datetime.now(timezone.utc)

        # Try to load Kim2016.pdf from public folder
        sample_pdf_path = Path(__file__).parent.parent.parent / "public" / "Kim2016.pdf"

        if sample_pdf_path.exists():
            with open(sample_pdf_path, "rb") as f:
                pdf_data = base64.b64encode(f.read()).decode('utf-8')
                pdf_data_with_prefix = f"data:application/pdf;base64,{pdf_data}"

            library_item = PDFLibraryItem(
                id="sample_kim2016",
                title="Kim et al. 2016 - Cerebellar Infarction Study",
                filename="Kim2016.pdf",
                pdf_data=pdf_data_with_prefix,
                total_pages=9,
                description="Clinical study on cerebellar infarction treatment outcomes",
                created_at=now
            )

            db.pdf_library[library_item.id] = library_item
            print(f"✅ Initialized PDF library with {len(db.pdf_library)} items")
        else:
            print(f"⚠️ Sample PDF not found at {sample_pdf_path}")


# Parse CORS origins from environment variable
cors_origins_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = []
if cors_origins_env:
    if cors_origins_env == "*":
        allowed_origins = ["*"]
    else:
        allowed_origins.extend([origin.strip() for origin in cors_origins_env.split(",") if origin.strip()])

# Get current Replit URL if running on Replit
replit_url = None
if os.getenv('REPL_SLUG') and os.getenv('REPL_OWNER'):
    replit_url = f"https://{os.getenv('REPL_SLUG')}.{os.getenv('REPL_OWNER')}.repl.co"

allowed_origins.extend([
    "http://localhost:5173",
    "http://localhost:5000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5000",
])

if replit_url:
    allowed_origins.append(replit_url)


# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=r"https://.*\.replit\.dev" if cors_origins_env == "*" else None,
)

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(extractions.router)
app.include_router(annotations.router)
app.include_router(ai.router)
app.include_router(pdf_library.router)


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