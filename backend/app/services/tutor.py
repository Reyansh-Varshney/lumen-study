import logging
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ── System Prompt ─────────────────────────────────────────────────────────────
# Persona: supportive academic mentor & study partner. It never references a
# specific entrance test, a score threshold, or assessment-pressure framing.
SYSTEM_INSTRUCTION = (
    "You are a supportive academic mentor and study partner. "
    "The student got a question wrong. Your job is to analyse their reasoning and give targeted, encouraging feedback. "
    "Compare the user_logic field to the correct_answer field. "
    "Identify the exact conceptual or procedural misstep in the student's approach. "
    "Do NOT simply reveal the answer — explain WHY their specific approach failed and what the correct mental model is. "
    "Stay calm and constructive: never imply the student is behind, unprepared, or failing. "
    "Also, produce a highly specific 3-4 word YouTube search query (in English) that targets exactly the "
    "sub-concept they are struggling with. The query must describe ONLY the subject and concept — "
    "never include a test name, a course name, or sensational marketing packaging. "
    "Return only a JSON object with exactly two string keys: 'feedback' and 'youtube_query'. "
    "NEVER use unescaped double quotes inside the text; use single quotes instead. "
    "Output raw JSON only — no markdown fences."
)


async def evaluate_user_logic(
    question: str,
    correct_answer: str,
    user_logic: str,
) -> dict:
    """
    Calls the LLM to analyse a student's incorrect approach.

    Returns a dict with 'feedback' (str) and 'youtube_query' (str).
    """
    from app.services.llm import _generate

    user_message = (
        f"Question: {question}\n"
        f"Correct Answer: {correct_answer}\n"
        f"Student's Reasoning / Attempt: {user_logic}"
    )

    schema = {
        "type": "object",
        "properties": {
            "feedback": {"type": "string"},
            "youtube_query": {"type": "string"},
        },
        "required": ["feedback", "youtube_query"],
    }

    result = await _generate(
        SYSTEM_INSTRUCTION,
        user_message,
        schema=schema,
        temperature=0.4,
    )

    if not isinstance(result, dict):
        raise HTTPException(
            status_code=503,
            detail="The AI tutor could not be reached right now. Please try again.",
        )

    if "feedback" not in result or "youtube_query" not in result:
        raise HTTPException(
            status_code=503,
            detail=f"AI tutor response missing required keys: {list(result.keys())}",
        )

    return result
