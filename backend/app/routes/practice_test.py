from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from bson import ObjectId
from pydantic import BaseModel

from app.core.dependencies import get_current_user
from app.core.database import get_database
from app.models.quiz import QuizResponseItem
from app.services.llm import generate_mcqs
from app.services.course import get_user_completed_topics, get_user_topics, subject_context

router = APIRouter(prefix="/practice-test", tags=["Practice Test"])


class QuizSubmitRequest(BaseModel):
    user_id: str
    score: int
    warnings_issued: int
    total_questions: int
    responses: List[QuizResponseItem]
    completed_at: Optional[datetime] = None


@router.get("/generate/{user_id}")
async def generate_practice_test(user_id: str, current_user: dict = Depends(get_current_user)):
    """
    Build a short self-assessment set from the topics the learner has already
    worked through, so the questions reinforce what they know.
    """
    db = get_database()

    # 1. Fetch learner
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    covered_topics = await get_user_completed_topics(db, user_id)
    if not covered_topics:
        covered_topics = user.get("covered_topics", [])

    if not covered_topics:
        # A learner who has just set up their tracker has not completed
        # anything yet. Fall back to the topics they are about to study so the
        # session is still useful instead of a dead end.
        covered_topics = await get_user_topics(db, user_id, limit=5)

    if not covered_topics:
        raise HTTPException(
            status_code=400,
            detail="Add a few topics to your course tracker first."
        )

    # 2. Generate questions from the topics covered so far
    topic_context = ", ".join(covered_topics)
    subjects = user.get("active_subjects", [])
    context = subject_context(subjects)

    try:
        questions_raw = await generate_mcqs(topic_context, context)
        questions_raw = questions_raw[:5]

        return {
            "user_id": user_id,
            "topics_queried": covered_topics,
            "questions": questions_raw
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate the practice test: {str(e)}"
        )


@router.post("/submit")
async def submit_practice_test(request: QuizSubmitRequest, current_user: dict = Depends(get_current_user)):
    """
    Submit the self-assessment results, update XP, and schedule SRS reviews
    for the questions the learner got wrong.
    """
    db = get_database()
    user_id = request.user_id

    # 1. Update learner stats (gamification)
    xp_gained = request.score * 20

    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$inc": {"total_xp": xp_gained}}
    )

    # 2. The SRS Loop: schedule the mistakes for review
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)

    srs_updates = 0
    for resp in request.responses:
        if not resp.is_correct:
            topic = resp.topic_name or "General Practice"

            # SM-2: Reset on mistake (interval=1, which is the immediate next day for review)
            srs_record = {
                "user_id": user_id,
                "reference_id": topic,
                "record_type": "topic",
                "interval": 1,
                "repetition_count": 0,
                "ease_factor": 2.5,
                "last_reviewed_date": datetime.now(timezone.utc),
                "next_review_date": tomorrow
            }

            await db.srs_records.update_one(
                {"user_id": user_id, "reference_id": topic, "record_type": "topic"},
                {"$set": srs_record},
                upsert=True
            )
            srs_updates += 1

    return {
        "message": "Results recorded successfully",
        "xp_gained": xp_gained,
        "warnings_issued": request.warnings_issued,
        "srs_entries_created": srs_updates
    }
