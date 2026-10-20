from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from app.models.common import PyObjectId


class TopicSchema(BaseModel):
    """A single, checkable unit of study inside a module."""

    topic_name: str
    is_completed: bool = False
    completed_at: Optional[datetime] = None


class ModuleSchema(BaseModel):
    """A chapter / unit that groups related topics."""

    module_name: str
    topics: List[TopicSchema] = Field(default_factory=list)


class SubjectSchema(BaseModel):
    """A subject the learner studies (Mathematics, History, Design, ...)."""

    subject_name: str
    modules: List[ModuleSchema] = Field(default_factory=list)


class SyllabusSchema(BaseModel):
    """
    Generic course structure.

    The hierarchy is fully decoupled from any fixed subject combination:

        Syllabus -> Subject -> Module / Chapter -> Topic

    Both learners and instructors can create subjects, modules and topic
    checklists dynamically.
    """

    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    user_id: str
    title: str = "My Course"
    subjects: List[SubjectSchema] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    def all_topics(self) -> List[str]:
        """Flatten every topic name across all subjects and modules."""
        topics: List[str] = []
        for subject in self.subjects:
            for module in subject.modules:
                topics.extend(topic.topic_name for topic in module.topics)
        return topics

    def all_subject_names(self) -> List[str]:
        return [subject.subject_name for subject in self.subjects]


# ── Request models for dynamic course building ──────────────────────────────
class SubjectCreate(BaseModel):
    subject_name: str = Field(..., min_length=1, max_length=120)
    module_name: Optional[str] = Field(
        default=None,
        description="Optional first module created together with the subject",
    )


class ModuleCreate(BaseModel):
    module_name: str = Field(..., min_length=1, max_length=160)


class TopicCreate(BaseModel):
    topic_name: str = Field(..., min_length=1, max_length=160)


class TopicStatusUpdate(BaseModel):
    """Toggle the completion state of one topic in the tracker."""

    subject_name: str
    module_name: str
    topic_name: str
    is_completed: bool = True
