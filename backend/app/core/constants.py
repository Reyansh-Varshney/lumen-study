"""
Subject-agnostic constants for the Lumen platform.

This module must never encode a specific competitive test, a fixed subject
combination, or any test-oriented ranking vocabulary. Everything here is
deliberately neutral so the platform can serve a learner studying *any*
subject at *any* academic level.
"""

import re

# ── Platform branding ────────────────────────────────────────────────────────
APP_NAME = "Lumen"
APP_TAGLINE = "Your AI study companion"

# ── Learner profile ──────────────────────────────────────────────────────────
DEFAULT_GRADE_LEVEL = "Undergraduate"

# Neutral level descriptors offered during onboarding.
GRADE_LEVELS = [
    "Middle School",
    "High School",
    "Diploma",
    "Undergraduate",
    "Postgraduate",
    "Self-directed",
]

# Broad, subject-agnostic buckets used when a learner has not chosen any
# subjects yet. They intentionally span science, commerce, arts and skills.
GENERIC_SUBJECTS = [
    "Mathematics",
    "Physics",
    "Chemistry",
    "Biology",
    "Computer Science",
    "Economics",
    "History",
    "Geography",
    "Languages",
    "General Aptitude",
]

# Subject used when a learner works on something completely outside this list.
DEFAULT_SUBJECT = "General Studies"

# Terms that must never survive into a resource-search query. They are
# stripped so a search always resolves to "{subject} {topic}" cleanly.
_EXAM_TERM_PATTERN = re.compile(
    r"\b(?:jee|neet|upsc|gate|bitsat|uet|ismt|aiims|clat|"
    r"mains|advanced|prelims|finals|cutoff|rank|aspirant|"
    r"one\s*shot|crash\s*course|past\s*year|pyq|pyqs)\b",
    re.IGNORECASE,
)

_NOISE_TERM_PATTERN = re.compile(
    r"\b(?:mock\s*test|proctored|proctoring|final\s*exam|semester\s*exam)\b",
    re.IGNORECASE,
)

# Words used to turn a bare topic into a useful teaching-resource query.
RESOURCE_QUERY_QUALIFIER = "tutorial"


def sanitize_search_terms(text: str) -> str:
    """
    Strip test-specific vocabulary and collapse whitespace.

    The platform is subject-agnostic, so a search string must never smuggle
    in a test name, a ranking, or sensational packaging.
    """
    if not text:
        return ""
    cleaned = _EXAM_TERM_PATTERN.sub(" ", text)
    cleaned = _NOISE_TERM_PATTERN.sub(" ", cleaned)
    cleaned = re.sub(r"[^a-zA-Z0-9\s.+&/()\-:']", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -|:,")
    return cleaned


def build_resource_query(subject: str, topic: str, qualifier: str = RESOURCE_QUERY_QUALIFIER) -> str:
    """
    Build a clean resource-search query of the form "{subject} {topic}".

    Example:
        build_resource_query("Organic Chemistry", "Benzene structure")
        -> "Organic Chemistry Benzene structure tutorial"
    """
    subject_clean = sanitize_search_terms(subject)
    topic_clean = sanitize_search_terms(topic)

    parts = [part for part in (subject_clean, topic_clean) if part]
    query = " ".join(parts)

    if qualifier:
        qualifier_clean = sanitize_search_terms(qualifier)
        if qualifier_clean:
            query = f"{query} {qualifier_clean}".strip()

    return query
