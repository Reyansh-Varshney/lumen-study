from pydantic import BaseModel
from typing import Optional

class ActivityLogSchema(BaseModel):
    user_id: str
    date: str  # YYYY-MM-DD
    actions_completed: int = 1
