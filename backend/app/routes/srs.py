from fastapi import APIRouter, Depends
from app.core.dependencies import get_current_user
from app.core.database import get_database
from bson import ObjectId
from datetime import datetime, timedelta

router = APIRouter(prefix="/srs", tags=["Spaced Repetition System"])

@router.get("/curves")
async def get_srs_curves(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    db = get_database()
    
    # Fetch all srs_records for the current_user where record_type == "topic"
    records = await db.srs_records.find({
        "user_id": user_id,
        "record_type": "topic"
    }).to_list(length=None)
    
    # Format for the frontend
    formatted_records = []
    for record in records:
        record["_id"] = str(record["_id"])
        
        # Determine last_reviewed_date
        last_reviewed_date = record.get("last_reviewed_date")
        if not last_reviewed_date:
            next_review_date = record.get("next_review_date")
            interval = record.get("interval", 0)
            if next_review_date:
                last_reviewed_date = next_review_date - timedelta(days=interval)
            else:
                last_reviewed_date = datetime.utcnow()
                
        # Make sure datetimes are formatted string
        record["last_reviewed_date"] = last_reviewed_date.isoformat() if isinstance(last_reviewed_date, datetime) else last_reviewed_date
        
        next_review_date = record.get("next_review_date")
        if next_review_date:
            record["next_review_date"] = next_review_date.isoformat() if isinstance(next_review_date, datetime) else next_review_date
        
        formatted_records.append(record)
        
    return formatted_records
