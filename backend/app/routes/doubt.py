from fastapi import APIRouter, Depends
from datetime import datetime, timezone

from app.core.dependencies import get_current_user
from app.core.database import get_database
from app.models.doubt import ApproachRequest, ApproachResponse
from app.services.tutor import evaluate_user_logic
from app.services.youtube import get_youtube_videos

router = APIRouter(prefix="/doubt", tags=["Doubt Resolver"])


@router.post("/approach", response_model=ApproachResponse)
async def check_approach(
    request: ApproachRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Pedagogical Diagnostic Tutor endpoint.

    Accepts the student's wrong logic, evaluates it against the correct answer
    using Gemini, fetches relevant YouTube videos, logs the activity, and
    returns structured pedagogical feedback.
    """
    db = get_database()
    user_id = current_user["user_id"]
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # ── Step 1: AI evaluates the student's approach ───────────────────────────
    tutor_result = await evaluate_user_logic(
        question=request.question,
        correct_answer=request.correct_answer,
        user_logic=request.user_logic,
    )

    feedback: str = tutor_result["feedback"]
    youtube_query: str = tutor_result["youtube_query"]

    # ── Step 2: Fetch YouTube videos for the weak sub-concept ────────────────
    video_ids = await get_youtube_videos(youtube_query)

    # ── Step 3: Log activity (keeps heatmap green for doubts too) ─────────────
    await db.activity_logs.update_one(
        {"user_id": user_id, "date": today_str},
        {
            "$inc":         {"actions_completed": 1},
            "$setOnInsert": {"user_id": user_id, "date": today_str},
        },
        upsert=True,
    )

    return ApproachResponse(
        feedback=feedback,
        youtube_video_ids=video_ids,
    )
