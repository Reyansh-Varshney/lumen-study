from pydantic import BaseModel, Field
from typing import List


class ApproachRequest(BaseModel):
    topic: str = Field(..., min_length=2, max_length=200, description="The subject topic of the question")
    question: str = Field(..., min_length=5, description="The full text of the MCQ question")
    correct_answer: str = Field(..., min_length=1, description="The correct answer text")
    user_logic: str = Field(
        ...,
        min_length=5,
        description="The student's reasoning or the option they chose and why",
    )


class ApproachResponse(BaseModel):
    feedback: str = Field(..., description="Targeted AI feedback on the student's incorrect approach")
    youtube_video_ids: List[str] = Field(
        default=[],
        description="List of YouTube video IDs relevant to the weak sub-concept",
    )
