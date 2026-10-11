from fastapi import HTTPException, Depends
from sqlalchemy.orm import Session
from pwdlib import PasswordHash
import uuid
import pymupdf
from pathlib import Path
from fastapi import UploadFile, File
from sqlalchemy.exc import SQLAlchemyError
from models import Document,StudyMaterial
from schemas import DocumentResponse
import os
import jwt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jwt.exceptions import InvalidTokenError
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from schemas import UserLogin, TokenResponse
from database import get_db
from models import User
from schemas import UserRegister, UserResponse
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import Base, engine, get_db
import models  # Registers our database models
from ai_service import generate_study_material


load_dotenv()

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not JWT_SECRET_KEY or JWT_SECRET_KEY == "replace_this_with_a_long_random_secret":
    raise RuntimeError("Set a real JWT_SECRET_KEY in your .env file.")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables for our initial local development version.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Quiz Craft API",
    description="AI-powered PDF summarization and quiz generation",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
        )

        user_id = payload.get("sub")

        if user_id is None:
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication token.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user_id = int(user_id)

    except (InvalidTokenError, ValueError, TypeError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.get(User, user_id)

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="User not found.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user



@app.get("/")
def home():
    return {
        "message": "Welcome to Quiz Craft API!",
        "status": "running",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "application": "Quiz Craft",
    }


@app.get("/db-check")
def database_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {
            "status": "connected",
            "database": "quizcraft",
        }
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed. Check the backend configuration.",
        )
password_hash = PasswordHash.recommended()


@app.post("/auth/register", response_model=UserResponse, status_code=201)
def register_user(
    user_data: UserRegister,
    db: Session = Depends(get_db),
):
    existing_user = (
        db.query(User)
        .filter(User.email == user_data.email)
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists.",
        )

    user = User(
        name=user_data.name,
        email=str(user_data.email).lower(),
        password_hash=password_hash.hash(user_data.password),
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


@app.post("/auth/login", response_model=TokenResponse)
def login_user(
    credentials: UserLogin,
    db: Session = Depends(get_db),
):
    email = str(credentials.email).lower()

    user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if not user or not password_hash.verify(
        credentials.password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    token = jwt.encode(
        {
            "sub": str(user.id),
            "exp": expires_at,
        },
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
    }


@app.get("/auth/me", response_model=UserResponse)
def get_my_profile(
    current_user: User = Depends(get_current_user),
):
    return current_user



UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@app.post(
    "/documents/upload",
    response_model=DocumentResponse,
    status_code=201,
)
def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename or Path(file.filename).suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are allowed.",
        )

    stored_path = None

    try:
        # Read at most 10 MB plus one byte to detect oversized files.
        contents = file.file.read(MAX_FILE_SIZE + 1)

        if not contents:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty.",
            )

        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="PDF must be 10 MB or smaller.",
            )

        # Check PDF signature and parse the document.
        if not contents.startswith(b"%PDF-"):
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is not a valid PDF.",
            )

        try:
            with pymupdf.open(stream=contents, filetype="pdf") as pdf:
                extracted_text = "\n".join(
                    page.get_text() for page in pdf
                ).strip()
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Could not read this PDF. Please try another file.",
            )

        if not extracted_text:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No selectable text found. "
                    "Scanned PDFs require OCR, which we will add later."
                ),
            )

        original_name = Path(file.filename).name
        title = Path(original_name).stem[:255] or "Untitled document"
        stored_name = f"{uuid.uuid4().hex}.pdf"
        stored_path = UPLOAD_DIR / stored_name

        stored_path.write_bytes(contents)

        document = Document(
            title=title,
            filename=stored_name,
            extracted_text=extracted_text,
            user_id=current_user.id,
        )

        db.add(document)
        db.commit()
        db.refresh(document)

        return document

    except HTTPException:
        raise
    except (OSError, SQLAlchemyError):
        db.rollback()

        if stored_path and stored_path.exists():
            stored_path.unlink()

        raise HTTPException(
            status_code=500,
            detail="Could not save the document.",
        )
    finally:
        file.file.close()




@app.post("/documents/{document_id}/generate")
def generate_document_study_material(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = (
        db.query(Document)
        .filter(
            Document.id == document_id,
            Document.user_id == current_user.id,
        )
        .first()
    )

    if document is None:
        raise HTTPException(
            status_code=404,
            detail="Document not found.",
        )

    if not document.extracted_text or not document.extracted_text.strip():
        raise HTTPException(
            status_code=400,
            detail="This document has no extractable text.",
        )

    # Generate study material using Gemini.
    try:
        study_material = generate_study_material(
            document.extracted_text
        )
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="AI generation failed. Please try again.",
        )

    # Save the generated content to PostgreSQL.
    saved_material = StudyMaterial(
        document_id=document.id,
        content=study_material,
    )

    try:
        db.add(saved_material)
        db.commit()
        db.refresh(saved_material)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Study material could not be saved.",
        )

    return {
        "id": saved_material.id,
        "document_id": document.id,
        "title": document.title,
        "created_at": saved_material.created_at,
        "study_material": saved_material.content,
    }



@app.get("/documents/{document_id}/study-material")
def get_document_study_material(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    document = (
        db.query(Document)
        .filter(
            Document.id == document_id,
            Document.user_id == current_user.id,
        )
        .first()
    )

    if document is None:
        raise HTTPException(
            status_code=404,
            detail="Document not found.",
        )

    saved_material = (
        db.query(StudyMaterial)
        .filter(StudyMaterial.document_id == document.id)
        .order_by(StudyMaterial.created_at.desc())
        .first()
    )

    if saved_material is None:
        raise HTTPException(
            status_code=404,
            detail="No study material has been generated for this document.",
        )

    return {
        "id": saved_material.id,
        "document_id": document.id,
        "title": document.title,
        "created_at": saved_material.created_at,
        "study_material": saved_material.content,
    }
