from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from datetime import datetime, timezone
from bson import ObjectId

from app.core.database import get_database
from app.core.dependencies import get_current_user
from app.services.llm import generate_daily_plan
from app.services.course import get_user_topics

router = APIRouter(prefix="/planner", tags=["Planner"])


@router.get("/daily", response_model=List[Dict[str, Any]])
async def get_daily_plan(current_user: dict = Depends(get_current_user)):
    """
    Build today's study plan from the learner's own course tracker,
    spaced-repetition queue and self-set study window.
    """
    try:
        # --- SAFE ID EXTRACTION ---
        if hasattr(current_user, "id"):
            user_id_str = str(current_user.id)
        elif isinstance(current_user, dict):
            user_id_str = str(current_user.get("user_id") or current_user.get("id") or current_user.get("_id"))
        else:
            user_id_str = str(current_user)
        # --------------------------

        if not user_id_str or user_id_str == "None":
            raise HTTPException(status_code=401, detail="Unauthorized")

        db = get_database()

        try:
            obj_id = ObjectId(user_id_str)
        except Exception:
            obj_id = user_id_str

        # 1. Study window — the learner's own target date, if they set one
        try:
            user_doc = await db.users.find_one({"_id": obj_id})
        except Exception:
            user_doc = {}

        if not user_doc:
            user_doc = {}

        days_remaining = 30  # Default window when the learner has not set one
        target_date = user_doc.get("target_date")

        if target_date:
            if isinstance(target_date, str):
                try:
                    target_date = datetime.fromisoformat(target_date.replace('Z', '+00:00'))
                except ValueError:
                    target_date = None
            # Ensure timezone awareness before subtracting
            now = datetime.now(timezone.utc)
            if isinstance(target_date, datetime):
                if target_date.tzinfo is None:
                    target_date = target_date.replace(tzinfo=timezone.utc)
                days_remaining = max(0, (target_date - now).days)

        # 2. Pending topics from the course tracker
        pending_topics = await get_user_topics(db, user_id_str, limit=3)
        if not pending_topics:
            pending_topics = ["General Concepts"]

        # 3. Safe SRS fetch
        srs_cursor = db.srs_records.find({
            "user_id": {"$in": [user_id_str, obj_id]},
            "next_review_date": {"$lte": datetime.now(timezone.utc)}
        }).limit(3)
        srs_records = await srs_cursor.to_list(length=3)
        urgent_srs = [r.get("reference_id") for r in srs_records if r.get("reference_id")]

        # 4. Generate AI Plan
        plan = await generate_daily_plan(days_remaining, pending_topics, urgent_srs)
        return plan

    except Exception as e:
        print(f"--- [CRITICAL ERROR IN /planner/daily] ---")
        print(f"Error details: {str(e)}")
        import traceback
        traceback.print_exc()

        return [{
            "task_title": "Set Up Your Study Plan",
            "reasoning": "We need a little more information before we can build your plan.",
            "action_type": "resource_study",
            "target_topic": "General Concepts"
        }]
