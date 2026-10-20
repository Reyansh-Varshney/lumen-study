"""
Subject-agnostic helpers for reading a learner's course tracker.

Everything in this module works against the generic hierarchy

    Subject -> Module / Chapter -> Topic

so no part of the platform depends on a fixed subject combination.
"""

from typing import Any, Dict, List, Optional

from bson import ObjectId

from app.core.constants import DEFAULT_SUBJECT


async def get_user_course(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Return the learner's primary course tracker document, if any."""
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return None

    syllabus_id = user.get("master_syllabus_id")
    if not syllabus_id:
        return None

    try:
        return await db.syllabuses.find_one({"_id": ObjectId(syllabus_id)})
    except Exception:
        return None


async def get_user_subjects(db, user_id: str) -> List[str]:
    """
    Subjects the learner is working on.

    Profile subjects come first, then anything discovered in the tracker.
    """
    user = await db.users.find_one({"_id": ObjectId(user_id)}) or {}
    subjects: List[str] = [s for s in (user.get("active_subjects") or []) if s]

    course = await get_user_course(db, user_id)
    if course:
        for subject in course.get("subjects", []) or []:
            name = subject.get("subject_name")
            if name and name not in subjects:
                subjects.append(name)

    return subjects


async def get_user_topics(db, user_id: str, limit: Optional[int] = None) -> List[str]:
    """Topic names from the learner's tracker (pending topics only)."""
    course = await get_user_course(db, user_id)
    if not course:
        return []

    topics: List[str] = []
    for subject in course.get("subjects", []) or []:
        for module in subject.get("modules", []) or []:
            for topic in module.get("topics", []) or []:
                name = topic.get("topic_name")
                if name and not topic.get("is_completed"):
                    topics.append(name)

    return topics[:limit] if limit else topics


async def get_user_completed_topics(db, user_id: str) -> List[str]:
    """Topic names the learner has already checked off."""
    course = await get_user_course(db, user_id)
    if not course:
        return []

    topics: List[str] = []
    for subject in course.get("subjects", []) or []:
        for module in subject.get("modules", []) or []:
            for topic in module.get("topics", []) or []:
                name = topic.get("topic_name")
                if name and topic.get("is_completed"):
                    topics.append(name)

    return topics


def subject_context(subjects: List[str]) -> str:
    """Short, human-readable subject descriptor for LLM prompts."""
    cleaned = [s.strip() for s in (subjects or []) if s and s.strip()]
    if not cleaned:
        return DEFAULT_SUBJECT
    return ", ".join(cleaned[:4])


def build_topic_prompt_context(subjects: List[str], topics: List[str]) -> str:
    """
    Compose the descriptive string handed to the question generator.

    Format: "Subject: topic, Subject: topic" — clean and subject-agnostic.
    """
    if topics:
        subject = subjects[0] if subjects else DEFAULT_SUBJECT
        return ", ".join(f"{subject}: {topic}" for topic in topics[:5])

    return subject_context(subjects)
