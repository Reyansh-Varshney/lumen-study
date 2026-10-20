from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from app.models.common import PyObjectId


class UserSchema(BaseModel):
    """A learner account.

    The profile is intentionally generic — it describes *who* the learner is
    and *what* they are studying, never a specific competitive test track.
    """

    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    username: str
    email: EmailStr
    hashed_password: str
    role: str = "student"
    elo_rating: int = 1200
    total_xp: int = 0

    # Generic learner attributes
    grade_level: Optional[str] = Field(
        default=None,
        description="Current study level, e.g. 'High School', 'Undergraduate', 'Self-directed'",
    )
    academic_goal: Optional[str] = Field(
        default=None,
        description="Free-text goal describing what the learner wants to achieve",
    )
    active_subjects: List[str] = Field(
        default_factory=list,
        description="Subjects the learner is currently working on",
    )

    target_date: Optional[datetime] = Field(
        default=None,
        description="Optional self-set milestone date used to pace the study plan",
    )
    master_syllabus_id: Optional[str] = Field(
        default=None,
        description="Id of the primary course tracker owned by this learner",
    )
    covered_topics: List[str] = Field(
        default_factory=list,
        description="List of topics the learner has completed",
    )

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )


class UserCreate(BaseModel):
    """Registration payload.

    Every field is optional apart from the credentials themselves, so a learner
    can start studying immediately and refine their profile later from the
    onboarding flow.
    """

    username: str
    email: EmailStr
    password: str
    grade_level: Optional[str] = None
    academic_goal: Optional[str] = None
    active_subjects: List[str] = Field(default_factory=list)


class UserProfileUpdate(BaseModel):
    """Payload for refining a learner profile after sign-up."""

    grade_level: Optional[str] = None
    academic_goal: Optional[str] = None
    active_subjects: Optional[List[str]] = None
    target_date: Optional[datetime] = None


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    user_id: Optional[str] = None
    role: Optional[str] = None
