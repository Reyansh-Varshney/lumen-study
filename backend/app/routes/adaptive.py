from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from bson import ObjectId

from app.core.database import get_database
from app.core.dependencies import get_current_user

router = APIRouter(prefix="/adaptive", tags=["Adaptive Practice"])

@router.get("/weaknesses", response_model=List[Dict[str, Any]])
async def get_weaknesses(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    db = get_database()
    
    # 1. Pipeline to identify top 3 weak topics for the user
    # Group mistake_logs by target_topics. For each topic, calculate avg_time_taken and error_count.
    pipeline = [
        # Note: Added fallback for string vs ObjectId types just in case
        {"$match": {"user_id": {"$in": [user_id, ObjectId(user_id)]}, "is_resolved": False}},
        
        # Unwind target_topics since it's typically a list. (Works perfectly if it is a list of strings)
        {"$unwind": "$target_topics"}, 
        
        # Group by the topic
        {"$group": {
            "_id": "$target_topics",
            "error_count": {"$sum": 1},
            "avg_time_taken": {"$avg": "$time_taken"}
        }},
        
        # Sort by most errors, then by longest average time
        {"$sort": {"error_count": -1, "avg_time_taken": -1}},
        
        # Give us only the top 3 weaknesses
        {"$limit": 3}
    ]
    
    cursor = db.mistake_logs.aggregate(pipeline)
    results = await cursor.to_list(length=3)
    
    # Map the output to a cleaner structure
    weaknesses = []
    for r in results:
        topic_name = r["_id"]
        # Handle unexpected dict returns safely
        if isinstance(topic_name, dict):
            topic_name = str(topic_name)
            
        weaknesses.append({
            "topic": topic_name,
            "error_count": r.get("error_count", 0),
            "avg_time_taken": round(r.get("avg_time_taken", 0), 2)
        })
        
    return weaknesses
