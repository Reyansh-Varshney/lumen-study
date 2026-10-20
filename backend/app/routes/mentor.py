from fastapi import APIRouter, Depends
from typing import List, Dict, Any
from app.core.database import get_database
from bson import ObjectId

router = APIRouter(prefix="/mentor", tags=["Mentor"])

@router.get("/stats")
async def get_mentor_stats(db = Depends(get_database)):
    # In a real app, these would be calculated from the DB
    return {
        "active_students": 1284,
        "avg_class_elo": 2140,
        "quiz_completion": 94.2,
        "goal": 90.0
    }

@router.get("/roster")
async def get_student_roster(db = Depends(get_database)):
    # Fetch real users from the database to make it feel real
    users_cursor = db.users.find().limit(5)
    users = await users_cursor.to_list(length=5)
    
    roster = []
    for user in users:
        roster.append({
            "id": str(user["_id"]),
            "name": user.get("username", "Unknown"),
            "email": user.get("email", ""),
            "elo": user.get("elo_rating", 1200),
            "status": "Proficient" if user.get("elo_rating", 0) > 2000 else "Active",
            "progress": 85,  # Mock progress
            "avatar": user.get("username", "U")[0].upper()
        })
    return roster

@router.get("/alerts")
async def get_intervention_alerts():
    return [
        {
          "id": 1,
          "type": "warning",
          "title": "Cohort Review Suggested",
          "message": "Several learners spent extra time on the 'Newton's Laws' module in the last 24h.",
          "timestamp": "2 hours ago"
        },
        {
          "id": 2,
          "type": "critical",
          "title": "Declining Engagement Alert",
          "message": "One learner's practice rating dropped noticeably over 48 hours. A check-in is recommended.",
          "timestamp": "5 hours ago"
        }
    ]
