from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
from datetime import datetime, timedelta, timezone
from bson import ObjectId

from app.core.database import get_database
from app.core.dependencies import get_current_user
from app.services.course import get_user_subjects
from app.core.constants import GENERIC_SUBJECTS

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _bucket_for_topic(topic: str, subjects: list) -> str:
    """
    Map an SRS topic onto one of the learner's subjects.

    Matching is case-insensitive and substring based, so "Organic Chemistry"
    lands under "Chemistry". Topics that match nothing fall into a generic
    "General Review" bucket.
    """
    lowered = (topic or "").lower()
    for subject in subjects:
        token = subject.lower()
        if token in lowered or lowered in token:
            return subject
        # Also try the first word (e.g. "Computer Science" -> "computer")
        head = token.split()[0]
        if len(head) > 3 and head in lowered:
            return subject
    return "General Review"


@router.get("/metrics", response_model=Dict[str, Any])
async def get_dashboard_metrics(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    db = get_database()
    today = datetime.now(timezone.utc)

    # 1. Learner stats
    try:
        user_doc = await db.users.find_one({"_id": ObjectId(user_id)})
    except Exception:
        user_doc = None

    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    username = user_doc.get("username", "Learner")
    total_xp = user_doc.get("total_xp", user_doc.get("xp", 0))
    elo_rating = user_doc.get("elo_rating", 1200)
    level = int(total_xp / 500) + 1
    grade_level = user_doc.get("grade_level")
    academic_goal = user_doc.get("academic_goal")

    subjects = await get_user_subjects(db, user_id)
    if not subjects:
        subjects = list(GENERIC_SUBJECTS[:5])

    # 2. Daily activity heatmap (last 28 days)
    heatmap = []
    for i in range(27, -1, -1):
        d = today - timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")

        action_doc = await db.activity_logs.find_one({
            "user_id": {"$in": [str(user_id), ObjectId(user_id)]},
            "date": date_str
        })
        action_count = action_doc.get("count", 0) if action_doc else 0

        heatmap.append({"date": date_str, "count": action_count})

    # 3. Targeted mastery radar — bucketed by the learner's own subjects
    srs_cursor = db.srs_records.find({
        "user_id": {"$in": [user_id, ObjectId(user_id)]}
    })
    srs_list = await srs_cursor.to_list(length=500)

    mastery_radar = []
    if srs_list:
        buckets: Dict[str, list] = {subject: [] for subject in subjects}
        buckets.setdefault("General Review", [])

        for rec in srs_list:
            ef = rec.get("ease_factor", 2.5)
            # Normalize EF: 2.5 typical -> 80% mark
            normalized = min(100, max(0, int((ef / 3.125) * 100)))
            topic = rec.get("reference_id", "")
            buckets[_bucket_for_topic(topic, subjects)].append(normalized)

        for subject, values in buckets.items():
            avg = sum(values) // len(values) if values else 40
            mastery_radar.append({"subject": subject, "A": avg, "fullMark": 100})
    else:
        # Default starting stats for the learner's subjects
        mastery_radar = [
            {"subject": subject, "A": 40, "fullMark": 100}
            for subject in subjects
        ]

    return {
        "username": username,
        "total_xp": total_xp,
        "elo_rating": elo_rating,
        "level": level,
        "grade_level": grade_level,
        "academic_goal": academic_goal,
        "active_subjects": subjects,
        "heatmap": heatmap,
        "mastery_radar": mastery_radar
    }
