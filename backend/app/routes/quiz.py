from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime, timezone
from typing import List
from bson import ObjectId

from app.core.dependencies import get_current_user
from app.core.database import get_database
from app.models.quiz import QuizGenerateRequest, MCQItem, QuizSubmitRequest, QuizMasterSchema, QuizAttemptSchema
from app.utils.srs import calculate_next_review
from app.services.llm import generate_mcqs
from app.services.course import get_user_subjects, subject_context

router = APIRouter(prefix="/quiz", tags=["Quiz & SRS"])


@router.get("/recommendations", response_model=List[str])
async def get_quiz_recommendations(
    current_user: dict = Depends(get_current_user)
):
    """
    Aggregation Engine: Finds the topics the learner engages with most often
    across their uploaded library documents, to recommend for a quiz.
    """
    db = get_database()
    user_id = current_user["user_id"]

    pipeline = [
        {"$match": {"user_id": {"$in": [user_id, ObjectId(user_id)]}}},
        {"$unwind": "$topics"},
        {"$group": {
            "_id": "$topics",
            "count": {"$sum": 1}
        }},
        {"$sort": {"count": -1}},
        {"$limit": 5}
    ]

    cursor = db.source_topics.aggregate(pipeline)
    results = await cursor.to_list(length=5)

    return [doc["_id"] for doc in results if doc.get("_id")]


@router.post("/generate", response_model=dict)
async def generate_quiz(
    request: QuizGenerateRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Generate 5 MCQs for the given target topics using AI.
    Saves the generated quiz to QuizMaster collection.
    """
    db = get_database()
    user_id = current_user["user_id"]
    
    try:
        # 1. Fetch the learner so the questions match their subject context
        subjects = await get_user_subjects(db, user_id)
        context = subject_context(subjects)

        # 2. Generate questions via the LLM, grounded in the learner's subjects
        questions_raw = await generate_mcqs(request.target_topics, context)
        questions = [MCQItem(**q) for q in questions_raw]

        # 3. Create Quiz Master Record
        quiz_master = QuizMasterSchema(
            user_id=user_id,
            target_topics=request.target_topics,
            generation_type=request.generation_type,
            questions=questions,
            created_at=datetime.now(timezone.utc)
        )

        # 4. Insert into MongoDB
        result = await db.quizzes.insert_one(quiz_master.dict(by_alias=True, exclude={"id"}))
        quiz_id = str(result.inserted_id)

        return {
            "quiz_id": quiz_id,
            "questions": questions
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Quiz generation failed: {str(e)}"
        )


@router.post("/submit", response_model=dict)
async def submit_quiz(
    request: QuizSubmitRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Finalized Submission Engine:
    - Persists detailed quiz attempts.
    - Updates user XP and ELO.
    - Populates mistake logs and SRS records.
    """
    db = get_database()
    user_id = current_user["user_id"]
    now_utc = request.completed_at if request.completed_at else datetime.now(timezone.utc)
    today_str = now_utc.strftime("%Y-%m-%d")

    # 1. Align Target Topics
    target_topics = request.target_topics

    # 2. Replicate Gamification Math
    total_q = request.total_questions
    pct = (request.score / total_q) if total_q > 0 else 0
    xp_gained = int(pct * 120)
    elo_delta = int(pct * 28) if pct >= 0.6 else -int((1 - pct) * 18)

    # Permanent Global Stat Persistence
    await db.users.update_one(
        {"_id": ObjectId(user_id)}, 
        {"$inc": {"total_xp": xp_gained, "elo_rating": elo_delta}}
    )

    # 3. Implement the Mistake Vault
    mistakes_to_insert = []
    for resp in request.responses:
        if not resp.is_correct:
            mistakes_to_insert.append({
                "user_id": user_id,
                "quiz_id": request.quiz_id,
                "question_idx": resp.question_idx,
                "selected_option": resp.selected_option,
                "target_topics": target_topics,
                "is_resolved": False,
                "created_at": now_utc
            })

    if mistakes_to_insert:
        await db.mistake_logs.insert_many(mistakes_to_insert)

    # 4. Attempt Persistence (EXACT SCHEMA MATCH)
    await db.quiz_attempts.insert_one({
        "user_id": user_id,
        "quiz_id": request.quiz_id,
        "target_topics": target_topics,
        "score": request.score,
        "total_questions": request.total_questions,
        "responses": [r.dict() for r in request.responses],
        "completed_at": now_utc
    })

    # 5. SRS Topic Updates
    quality = int(pct * 5)
    for topic in target_topics:
        srs_record = await db.srs_records.find_one({"user_id": user_id, "reference_id": topic})
        cf = srs_record["ease_factor"] if srs_record else 2.5
        interval = srs_record["interval"] if srs_record else 0

        # Note: Using 'quality' calculated as int(pct * 5) to ensure integer type
        srs_result = calculate_next_review(quality, cf, interval)
        await db.srs_records.update_one(
            {"user_id": user_id, "reference_id": topic},
            {
                "$set": {
                    "ease_factor": srs_result["ease_factor"],
                    "interval": srs_result["interval"],
                    "next_review_date": srs_result["next_review_date"],
                }
            },
            upsert=True
        )

    # 6. Daily Activity Update
    await db.activity_logs.update_one(
        {"user_id": user_id, "date": today_str},
        {
            "$inc": {"actions_completed": 1},
            "$setOnInsert": {"user_id": user_id, "date": today_str}
        },
        upsert=True
    )

    return {
        "message": "Quiz submitted",
        "score": request.score,
        "xp_gained": xp_gained,
        "elo_delta": elo_delta,
        "mistakes_logged": len(mistakes_to_insert)
    }
@router.get("/daily", response_model=List[str])
async def get_daily_review(
    current_user: dict = Depends(get_current_user)
):
    """
    Get a list of topics due for review today.
    """
    db = get_database()
    user_id = current_user["user_id"]
    now_utc = datetime.now(timezone.utc)

    cursor = db.srs_records.find(
        {
            "user_id": user_id,
            "next_review_date": {"$lte": now_utc}
        },
        {"reference_id": 1, "_id": 0}
    )

    due_records = await cursor.to_list(length=100)
    return [record["reference_id"] for record in due_records if record.get("reference_id")]
