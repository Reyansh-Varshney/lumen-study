from fastapi import APIRouter, File, UploadFile, Depends, HTTPException, Form
from pydantic import BaseModel
from typing import Optional, List
import pymupdf as fitz  # PyMuPDF
import logging
import asyncio
from datetime import datetime
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.core.dependencies import get_current_user
from app.core.database import get_database
from app.models.syllabus import (
    ModuleSchema,
    SubjectSchema,
    SyllabusSchema,
    TopicSchema,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/syllabus", tags=["Course Tracker"])


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
async def _get_or_create_course(db, user_id: str, title: str = "My Course"):
    """Return the learner's tracker, creating an empty one when missing."""
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    syllabus_id = user.get("master_syllabus_id")
    course = None
    if syllabus_id:
        try:
            course = await db.syllabuses.find_one({"_id": ObjectId(syllabus_id)})
        except Exception:
            course = None

    if course:
        return course

    # Create the primary tracker exactly once.
    #
    # The onboarding flow submits several subjects in parallel, so this must
    # be safe to call concurrently:
    #   * the document id is derived from the learner's id, so every request
    #     targets the SAME document instead of racing to create duplicates;
    #   * a plain insert is used rather than an upsert. An upsert takes the
    #     document write lock and can write back a stale snapshot, which
    #     silently discards subjects pushed by a concurrent request.
    try:
        course_id = ObjectId(str(user_id))
    except Exception:
        course_id = ObjectId()

    try:
        await db.syllabuses.insert_one({
            "_id": course_id,
            "user_id": str(user_id),
            "title": title,
            "subjects": [],
            "created_at": datetime.utcnow(),
        })
    except DuplicateKeyError:
        # Another request created it first — that is exactly what we want.
        logger.info("create_tracker: course %s already existed", course_id)

    course = await db.syllabuses.find_one({"_id": course_id})
    if not course:
        for _ in range(20):
            await asyncio.sleep(0.05)
            course = await db.syllabuses.find_one({"_id": course_id})
            if course:
                break

    if not course:
        logger.error("create_tracker: could not create or read course %s", course_id)
        raise HTTPException(status_code=500, detail="Could not create the course tracker.")

    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"master_syllabus_id": str(course_id)}},
    )
    return course


def _normalize_hierarchy(parsed: dict) -> List[SubjectSchema]:
    """
    Convert the LLM hierarchy payload into validated Subject/Module/Topic models.

    Accepts a few forgiving shapes so a slightly-off model response never
    breaks the tracker:
      topics: ["Algebra", ...]  or  [{"topic_name": "Algebra"}, ...]
    """
    subjects: List[SubjectSchema] = []

    for raw_subject in parsed.get("subjects", []) or []:
        if not isinstance(raw_subject, dict):
            continue

        subject_name = (raw_subject.get("subject_name") or raw_subject.get("subject") or "").strip()
        if not subject_name:
            continue

        modules: List[ModuleSchema] = []
        for raw_module in raw_subject.get("modules", []) or []:
            if not isinstance(raw_module, dict):
                continue

            module_name = (raw_module.get("module_name") or raw_module.get("module") or "").strip()
            if not module_name:
                continue

            topics: List[TopicSchema] = []
            for raw_topic in raw_module.get("topics", []) or []:
                if isinstance(raw_topic, str):
                    name = raw_topic.strip()
                elif isinstance(raw_topic, dict):
                    name = (raw_topic.get("topic_name") or raw_topic.get("topic") or "").strip()
                else:
                    name = ""
                if name:
                    topics.append(TopicSchema(topic_name=name))

            if topics:
                modules.append(ModuleSchema(module_name=module_name, topics=topics))

        if modules:
            subjects.append(SubjectSchema(subject_name=subject_name, modules=modules))

    return subjects


async def _parse_syllabus_pdf(raw_text: str) -> List[SubjectSchema]:
    """Ask the LLM to structure the document into Subject -> Module -> Topic."""
    from app.services.llm import _generate

    system = (
        "You are an expert curriculum parser. Extract the course structure from the provided text. "
        "Return only a JSON object of exactly this shape: "
        '{"subjects": [{"subject_name": "...", "modules": [{"module_name": "...", "topics": ["...", "..."]}]}]}. '
        "Use the subject and chapter names exactly as they appear in the document. "
        "Do not invent content that is not present. Keep the original order. "
        "If the document has no clear structure, return a single subject named 'General' with one "
        "module named 'Overview'. Output raw JSON only."
    )
    user = f"Extract the course structure from this text:\n\n{raw_text}"

    schema = {
        "type": "object",
        "properties": {
            "subjects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "subject_name": {"type": "string"},
                        "modules": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "module_name": {"type": "string"},
                                    "topics": {"type": "array", "items": {"type": "string"}},
                                },
                                "required": ["module_name", "topics"],
                            },
                        },
                    },
                    "required": ["subject_name", "modules"],
                },
            }
        },
        "required": ["subjects"],
    }

    parsed = await _generate(system, user, schema=schema, temperature=0.1)

    if not isinstance(parsed, dict):
        raise ValueError("Unexpected syllabus payload")

    return _normalize_hierarchy(parsed)


# ─────────────────────────────────────────────────────────────────────────────
# PDF import
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/upload")
async def upload_course_material(
    file: UploadFile = File(...),
    title: str = Form("My Course"),
    current_user: dict = Depends(get_current_user),
):
    """
    Import a course document (syllabus, notes, textbook) and structure it into
    Subject -> Module -> Topic.
    """
    user_id = current_user["user_id"]

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # 1. Text Extraction (PyMuPDF)
    try:
        content = await file.read()
        doc = fitz.open(stream=content, filetype="pdf")
        raw_text = "".join(page.get_text() for page in doc)
    except Exception as e:
        logger.error(f"Failed to read PDF: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to read PDF: {str(e)}")

    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="PDF contains no extractable text.")

    # 2. LLM Parsing
    try:
        subjects = await _parse_syllabus_pdf(raw_text)
    except Exception as e:
        logger.error(f"LLM Parsing failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to parse the document with AI.")

    if not subjects:
        raise HTTPException(
            status_code=422,
            detail="No structured subjects could be identified in this document.",
        )

    # 3. Persist
    db = get_database()
    try:
        syllabus_obj = SyllabusSchema(
            user_id=str(user_id),
            title=title or "My Course",
            subjects=subjects,
        )
        syllabus_dict = syllabus_obj.model_dump(by_alias=True, exclude_none=True)
        syllabus_dict["_id"] = ObjectId()

        insert_result = await db.syllabuses.insert_one(syllabus_dict)
        inserted_id = insert_result.inserted_id

        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "master_syllabus_id": str(inserted_id),
                    "course_title": title or "My Course",
                }
            },
        )

        # Keep the learner's profile subjects in sync with what they imported.
        subject_names = [s.subject_name for s in subjects]
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$addToSet": {"active_subjects": {"$each": subject_names}}},
        )

        syllabus_dict["_id"] = str(syllabus_dict["_id"])
    except Exception as e:
        logger.error(f"Database operation failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save the course tracker.")

    return {
        "message": "Course tracker created successfully",
        "data": syllabus_dict,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Read
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/my-roadmap")
async def get_my_roadmap(current_user: dict = Depends(get_current_user)):
    """Return the learner's course tracker (Subject -> Module -> Topic)."""
    db = get_database()
    user_id = current_user["user_id"]

    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user or not user.get("master_syllabus_id"):
        return {"data": None}

    course = await db.syllabuses.find_one({"_id": ObjectId(user["master_syllabus_id"])})
    if not course:
        return {"data": None}

    course["_id"] = str(course["_id"])
    return {"data": course}


# ─────────────────────────────────────────────────────────────────────────────
# Dynamic course building (learners and instructors)
# ─────────────────────────────────────────────────────────────────────────────
class SubjectCreateRequest(BaseModel):
    subject_name: str
    module_name: Optional[str] = None


class ModuleCreateRequest(BaseModel):
    module_name: str


class TopicCreateRequest(BaseModel):
    topic_name: str


class TopicStatusRequest(BaseModel):
    subject_name: str
    module_name: str
    topic_name: str
    is_completed: bool = True


@router.post("/subjects")
async def add_subject(
    payload: SubjectCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a new subject (optionally with its first module) in the tracker."""
    db = get_database()
    user_id = current_user["user_id"]

    course = await _get_or_create_course(db, user_id)

    new_subject = {
        "subject_name": payload.subject_name,
        "modules": [],
    }
    if payload.module_name:
        new_subject["modules"].append({"module_name": payload.module_name, "topics": []})

    # NOTE: an atomic `$push` guarded by the filter is used instead of a
    # read-modify-write of the whole array. The onboarding flow submits
    # several subjects in parallel, and a read-modify-write would let the
    # last request overwrite the ones before it.
    result = await db.syllabuses.update_one(
        {
            "_id": course["_id"],
            "subjects.subject_name": {"$ne": payload.subject_name},
        },
        {"$push": {"subjects": new_subject}},
    )

    logger.info(
        "add_subject: course=%s subject=%r matched=%s modified=%s",
        course["_id"], payload.subject_name,
        result.matched_count, result.modified_count,
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Subject already exists")

    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$addToSet": {"active_subjects": payload.subject_name}},
    )

    return {"message": "Subject added", "subject": new_subject}


@router.post("/subjects/{subject_name}/modules")
async def add_module(
    subject_name: str,
    payload: ModuleCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add a module (chapter) to an existing subject."""
    db = get_database()
    user_id = current_user["user_id"]

    course = await _get_or_create_course(db, user_id)

    result = await db.syllabuses.update_one(
        {
            "_id": course["_id"],
            "subjects": {
                "$elemMatch": {
                    "subject_name": subject_name,
                    "modules.module_name": {"$ne": payload.module_name},
                }
            },
        },
        {"$push": {"subjects.$[s].modules": {"module_name": payload.module_name, "topics": []}}},
        array_filters=[{"s.subject_name": subject_name}],
    )

    if result.matched_count == 0:
        # Either the subject does not exist, or the module is already there.
        exists = await db.syllabuses.find_one(
            {"_id": course["_id"], "subjects.subject_name": subject_name}
        )
        if not exists:
            raise HTTPException(status_code=404, detail="Subject not found")
        raise HTTPException(status_code=409, detail="Module already exists in this subject")

    return {"message": "Module added", "module": payload.module_name}


@router.post("/subjects/{subject_name}/modules/{module_name}/topics")
async def add_topic(
    subject_name: str,
    module_name: str,
    payload: TopicCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add a topic checklist item to a module."""
    db = get_database()
    user_id = current_user["user_id"]

    course = await _get_or_create_course(db, user_id)

    result = await db.syllabuses.update_one(
        {
            "_id": course["_id"],
            "subjects": {
                "$elemMatch": {
                    "subject_name": subject_name,
                    "modules": {
                        "$elemMatch": {
                            "module_name": module_name,
                            "topics.topic_name": {"$ne": payload.topic_name},
                        }
                    },
                }
            },
        },
        {
            "$push": {
                "subjects.$[s].modules.$[m].topics": {
                    "topic_name": payload.topic_name,
                    "is_completed": False,
                }
            }
        },
        array_filters=[
            {"s.subject_name": subject_name},
            {"m.module_name": module_name},
        ],
    )

    if result.matched_count == 0:
        # Work out which of the three failure modes this is.
        subject = await db.syllabuses.find_one(
            {"_id": course["_id"], "subjects.subject_name": subject_name}
        )
        if not subject:
            raise HTTPException(status_code=404, detail="Subject not found")

        module = await db.syllabuses.find_one(
            {
                "_id": course["_id"],
                "subjects": {
                    "$elemMatch": {
                        "subject_name": subject_name,
                        "modules.module_name": module_name,
                    }
                },
            }
        )
        if not module:
            raise HTTPException(status_code=404, detail="Module not found")

        raise HTTPException(status_code=409, detail="Topic already exists in this module")

    return {"message": "Topic added", "topic": payload.topic_name}


@router.patch("/topic")
async def update_topic_status(
    payload: TopicStatusRequest,
    current_user: dict = Depends(get_current_user),
):
    """Mark a topic complete (or reopen it) in the tracker."""
    db = get_database()
    user_id = current_user["user_id"]

    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user or not user.get("master_syllabus_id"):
        raise HTTPException(status_code=404, detail="Course tracker not found")

    course = await db.syllabuses.find_one({"_id": ObjectId(user["master_syllabus_id"])})
    if not course:
        raise HTTPException(status_code=404, detail="Course tracker not found")

    subjects = course.get("subjects", []) or []
    target_subject = next((s for s in subjects if s.get("subject_name") == payload.subject_name), None)
    if target_subject is None:
        raise HTTPException(status_code=404, detail="Subject not found")

    target_module = next(
        (m for m in target_subject.get("modules", []) if m.get("module_name") == payload.module_name),
        None,
    )
    if target_module is None:
        raise HTTPException(status_code=404, detail="Module not found")

    target_topic = next(
        (t for t in target_module.get("topics", []) if t.get("topic_name") == payload.topic_name),
        None,
    )
    if target_topic is None:
        raise HTTPException(status_code=404, detail="Topic not found")

    target_topic["is_completed"] = payload.is_completed
    target_topic["completed_at"] = datetime.utcnow() if payload.is_completed else None

    await db.syllabuses.update_one(
        {"_id": course["_id"]},
        {"$set": {"subjects": subjects}},
    )

    if payload.is_completed:
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$addToSet": {"covered_topics": payload.topic_name}},
        )
    else:
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$pull": {"covered_topics": payload.topic_name}},
        )

    return {"message": "Topic updated", "is_completed": payload.is_completed}


@router.delete("/subjects/{subject_name}")
async def delete_subject(
    subject_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a subject from the tracker."""
    db = get_database()
    user_id = current_user["user_id"]

    course = await _get_or_create_course(db, user_id)
    subjects = course.get("subjects", []) or []
    remaining = [s for s in subjects if s.get("subject_name") != subject_name]

    if len(remaining) == len(subjects):
        raise HTTPException(status_code=404, detail="Subject not found")

    await db.syllabuses.update_one(
        {"_id": course["_id"]},
        {"$set": {"subjects": remaining}},
    )
    # NOTE: the learner's declared `active_subjects` is intentionally left
    # alone. Removing a chapter from the course outline should not erase the
    # fact that they are still studying that subject.

    return {"message": "Subject removed"}
