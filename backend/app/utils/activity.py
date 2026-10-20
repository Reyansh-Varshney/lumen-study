from datetime import datetime, timezone

async def log_user_activity(db, user_id: str):
    """Increments the user's activity count for today."""
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    try:
        await db.activity_logs.update_one(
            {"user_id": str(user_id), "date": today_str},
            {"$inc": {"count": 1}},
            upsert=True
        )
    except Exception as e:
        print(f"Failed to log activity: {e}")
