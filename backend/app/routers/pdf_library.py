
"""
PDF Library management endpoints
Fixed library of PDFs available to all users
"""
from typing import List
from fastapi import APIRouter, HTTPException, status, Depends
from ..models import (
    User, PDFLibraryItem, PDFLibraryItemResponse, PDFLibraryItemDetail, db
)
from ..auth import get_current_user

router = APIRouter(prefix="/api/pdf-library", tags=["pdf-library"])


@router.get("", response_model=List[PDFLibraryItemResponse])
async def list_library_pdfs(current_user: User = Depends(get_current_user)):
    """List all PDFs in the library (without PDF data)"""
    items = list(db.pdf_library.values())
    
    return [
        PDFLibraryItemResponse(
            id=item.id,
            title=item.title,
            filename=item.filename,
            total_pages=item.total_pages,
            description=item.description
        )
        for item in items
    ]


@router.get("/{library_id}", response_model=PDFLibraryItemDetail)
async def get_library_pdf(library_id: str, current_user: User = Depends(get_current_user)):
    """Get specific PDF from library with full data"""
    item = db.pdf_library.get(library_id)
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found in library"
        )
    
    return PDFLibraryItemDetail(
        id=item.id,
        title=item.title,
        filename=item.filename,
        pdf_data=item.pdf_data,
        total_pages=item.total_pages,
        description=item.description
    )
