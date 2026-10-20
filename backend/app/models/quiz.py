from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class ResourceHistorySchema(BaseModel):
    user_id: str
    source_reference: str
    source_type: str
    extracted_topics: List[str]
    created_at: datetime = Field(default_factory=datetime.now)


class MCQItem(BaseModel):
    question: str
    options: List[str] = Field(..., min_length=4, max_length=4)
    correct_answer: str
    explanation: str


class QuizMasterSchema(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    user_id: str
    target_topics: List[str]
    generation_type: str = Field("custom", description="'review' or 'custom'")
    questions: List[MCQItem]
    created_at: datetime = Field(default_factory=datetime.now)


class QuizResponseItem(BaseModel):
    question_idx: int
    selected_option: str
    is_correct: bool
    approach_feedback: str
    topic_name: Optional[str] = None


class QuizAttemptSchema(BaseModel):
    user_id: str
    quiz_id: str
    target_topics: List[str]
    score: int
    total_questions: int
    responses: List[QuizResponseItem]
    completed_at: datetime = Field(default_factory=datetime.now)


class QuizGenerateRequest(BaseModel):
    target_topics: List[str] = Field(..., description="Topics to generate quiz questions for")
    generation_type: str = Field("custom", description="'review' or 'custom'")


class QuizSubmitRequest(BaseModel):
    quiz_id: str
    target_topics: List[str]
    score: int
    total_questions: int
    responses: List[QuizResponseItem]
    completed_at: datetime
