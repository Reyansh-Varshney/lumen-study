from fastapi import APIRouter, File, UploadFile, Depends, HTTPException, Form
from app.utils.activity import log_user_activity
from typing import List
from datetime import datetime, timedelta
from app.models.srs import SRSRecordSchema
from pydantic import BaseModel
from app.core.dependencies import get_current_user
from app.services.rag import (
    process_and_store_pdf,
    generate_resource_answer,
    generate_practice_from_scratchpad
)
from app.services.llm import extract_pdf_topics
import fitz  # PyMuPDF
import logging
from app.core.database import get_database
from bson import ObjectId

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/library", tags=["Resource Library"])


class AskRequest(BaseModel):
    question: str
    active_doc_ids: List[str]
    socratic_mode: bool = False


class PracticeRequest(BaseModel):
    text: str


class ScratchpadRequest(BaseModel):
    text: str


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    # NOTE: this must be a form field, not a plain parameter. FastAPI treats
    # bare scalars as query parameters, so the multipart body would be
    # silently ignored and every document would land under "General".
    subject: str = Form("General"),
    current_user: dict = Depends(get_current_user),
):
    """Store a learner-supplied document in the shared resource library."""
    user_id = current_user["user_id"]
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # 1. Extract, chunk and embed the document
    try:
        result = await process_and_store_pdf(file, user_id, subject=subject)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Document upload failed for user %s: %s", user_id, exc, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=f"Could not process that document: {exc}",
        )

    doc_id = result.get("doc_id")

    # 2. SILENT TOPIC EXTRACTION
    try:
        await file.seek(0)
        content = await file.read()
        doc = fitz.open(stream=content, filetype="pdf")
        full_text = "".join(page.get_text() for page in doc)

        topics = await extract_pdf_topics(full_text)

        if topics:
            db = get_database()

            # Link the topics to their source document
            await db.resource_sources.update_one(
                {"source_id": doc_id},
                {
                    "$set": {
                        "user_id": ObjectId(user_id),
                        "source_name": file.filename,
                        "subject": subject,
                        "created_at": datetime.utcnow()
                    }
                },
                upsert=True
            )

            # Track the learner's topics
            await db.user_topics.update_one(
                {"user_id": ObjectId(user_id)},
                {
                    "$addToSet": {"topics": {"$each": topics}},
                    "$set": {"last_updated": datetime.utcnow()}
                },
                upsert=True
            )

            # Track the topics specific to this document
            await db.source_topics.insert_one({
                "source_id": doc_id,
                "user_id": ObjectId(user_id),
                "topics": topics,
                "extracted_at": datetime.utcnow()
            })

    except Exception as e:
        # Fail silently — topic extraction must never break the upload
        print(f"Silent topic extraction failed: {str(e)}")

    return result


@router.post("/ask")
async def ask_question(request: AskRequest, current_user: dict = Depends(get_current_user)):
    """Answer a question using only the learner's own library documents."""
    user_id = current_user["user_id"]

    answer_result = await generate_resource_answer(
        question=request.question,
        active_doc_ids=request.active_doc_ids,
        socratic_mode=request.socratic_mode,
        user_id=user_id
    )

    db = get_database()
    now = datetime.utcnow()

    # 2. Refresh the review schedule for every topic touched by this document
    if request.active_doc_ids:
        source_records = await db.source_topics.find({
            "source_id": {"$in": request.active_doc_ids},
            "user_id": ObjectId(user_id)
        }).to_list(length=None)

        topics_to_update = set()
        for record in source_records:
            for topic in record.get("topics", []):
                topics_to_update.add(topic)

        for topic in topics_to_update:
            existing_record = await db.srs_records.find_one({
                "user_id": user_id,
                "reference_id": topic,
                "record_type": "topic"
            })

            if existing_record:
                await db.srs_records.update_one(
                    {"_id": existing_record["_id"]},
                    {
                        "$set": {"last_reviewed_date": now},
                        "$inc": {"repetition_count": 1}
                    }
                )
            else:
                new_record = SRSRecordSchema(
                    user_id=user_id,
                    reference_id=topic,
                    record_type="topic",
                    repetition_count=1,
                    interval=1,
                    ease_factor=2.5,
                    last_reviewed_date=now,
                    next_review_date=now + timedelta(days=1)
                )

                await db.srs_records.insert_one(new_record.model_dump(by_alias=True, exclude_none=True))

    # 3. Log the conversation
    chat_log = {
        "user_id": ObjectId(user_id),
        "question": request.question,
        "answer": answer_result,
        "active_doc_ids": request.active_doc_ids,
        "socratic_mode": request.socratic_mode,
        "timestamp": now
    }
    await db.library_chat_logs.insert_one(chat_log)

    # --- ACTIVITY LOGGING ---
    await log_user_activity(db, str(user_id))

    return answer_result


@router.post("/generate-practice")
async def generate_practice(request: PracticeRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    return await generate_practice_from_scratchpad(request.text, user_id)


@router.get("/documents")
async def get_documents(current_user: dict = Depends(get_current_user)):
    db = get_database()
    user_id = current_user["user_id"]
    user = await db.users.find_one({"_id": ObjectId(user_id)}, {"resource_documents": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user.get("resource_documents", [])


@router.post("/scratchpad")
async def save_scratchpad(request: ScratchpadRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    db = get_database()
    note = {
        "text": request.text,
        "created_at": datetime.utcnow().isoformat()
    }
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$push": {"scratchpad_notes": note}}
    )
    return {"message": "Note saved", "note": note}


@router.get("/scratchpad")
async def get_scratchpad(current_user: dict = Depends(get_current_user)):
    db = get_database()
    user_id = current_user["user_id"]
    user = await db.users.find_one({"_id": ObjectId(user_id)}, {"scratchpad_notes": 1})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {"notes": user.get("scratchpad_notes", [])}
