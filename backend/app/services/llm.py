import json
import os
import re
import httpx
import logging
from typing import Any, Optional

from dotenv import load_dotenv

from app.services import kilo

logger = logging.getLogger(__name__)

# ── API Key (Gemini fallback only) ───────────────────────────────────────────
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY", "").strip().strip("'").strip('"')

# The persona shared by every generation path: a supportive academic mentor
# and study partner. No competitive-testing framing anywhere.
MENTOR_PERSONA = (
    "You are a supportive academic mentor and study partner. "
    "You value foundational understanding over scoring tricks: you test whether the "
    "learner actually grasps a concept, and you always explain the reasoning behind an "
    "answer in plain language. "
    "Stay strictly on academic content — never discuss competitive testing, "
    "selection quotas, ranking, or performance anxiety."
)

# ── Schemas ──────────────────────────────────────────────────────────────────
MCQ_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "question": {"type": "string"},
            "options": {"type": "array", "items": {"type": "string"}},
            "correct_answer": {"type": "string"},
            "explanation": {"type": "string"},
        },
        "required": ["question", "options", "correct_answer", "explanation"],
    },
}

TOPIC_SCHEMA = {
    "type": "array",
    "items": {"type": "string"},
}

PLAN_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "task_title": {"type": "string"},
            "reasoning": {"type": "string"},
            "action_type": {"type": "string"},
            "target_topic": {"type": "string"},
        },
        "required": ["task_title", "reasoning", "action_type", "target_topic"],
    },
}

# The Gemini response schema uses a different dialect.
GEMINI_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "question": {"type": "STRING"},
            "options": {"type": "ARRAY", "items": {"type": "STRING"}},
            "correct_answer": {"type": "STRING"},
            "explanation": {"type": "STRING"},
        },
        "required": ["question", "options", "correct_answer", "explanation"],
    },
}


# ── Gemini fallback ──────────────────────────────────────────────────────────
def _gemini_endpoints() -> list[tuple[str, str]]:
    """
    Every usable (model, key) combination, best first.

    The Gemini free tier tracks its daily quota per project *and per model*,
    and a key can be rejected outright for a model it is not provisioned for.
    So the app walks the combinations — best model on every key first, then
    the next model — and uses the first one that answers.
    """
    from app.core.config import settings

    keys = settings.GEMINI_API_KEYS or ([API_KEY] if API_KEY else [])
    models = settings.GEMINI_MODELS or ["gemini-2.5-flash"]

    combos = []
    for model in models:
        for key in keys:
            combos.append((model, key))
    return combos


def _endpoint_url(model: str, key: str) -> str:
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={key}"
    )


async def _post_gemini(payload: dict, timeout: float = 90.0):
    """POST to Gemini, rotating over (model, key) combinations."""
    combos = _gemini_endpoints()
    last_response = None

    for index, (model, key) in enumerate(combos):
        url = _endpoint_url(model, key)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                )
        except httpx.HTTPError as exc:
            logger.warning("Gemini request error on %s: %s", model, exc)
            continue

        if response.status_code == 200:
            return response

        if response.status_code in (429, 403, 404, 500) and index < len(combos) - 1:
            logger.warning(
                "Gemini %s returned %d — trying the next model/key combination.",
                model, response.status_code,
            )
            last_response = response
            continue

        return response

    if last_response is not None:
        return last_response

    raise RuntimeError("Could not reach the Gemini API with any configured key or model.")


# ── Generation ───────────────────────────────────────────────────────────────
async def _generate(
    system: str,
    user: str,
    schema: Optional[dict] = None,
    gemini_schema: Optional[dict] = None,
    max_tokens: int = 8192,
    temperature: float = 0.7,
) -> Optional[Any]:
    """
    Produce structured output.

    The Kilo gateway is the primary provider. Gemini is used when the gateway
    cannot serve the request.
    """
    result = await kilo.chat_json(
        system=system,
        user=user,
        json_schema=schema,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    if result is not None:
        return result

    logger.warning("Kilo could not serve the request — falling back to Gemini.")

    payload = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            "responseMimeType": "application/json",
        },
    }
    if gemini_schema:
        payload["generationConfig"]["responseSchema"] = gemini_schema

    try:
        response = await _post_gemini(payload)
    except Exception as exc:
        logger.error("Both providers failed: %s", exc)
        return None

    if response.status_code != 200:
        logger.error("Gemini fallback failed with %d", response.status_code)
        return None

    try:
        raw = response.json()["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, ValueError) as exc:
        logger.error("Could not read the Gemini response: %s", exc)
        return None

    return kilo.parse_json(raw)


FALLBACK_PRACTICE_QUESTIONS = [
    {
        "question": "If a system is in equilibrium, the net force is?",
        "options": ["Zero", "Maximum", "Minimum", "Infinite"],
        "correct_answer": "Zero",
        "explanation": "By definition, equilibrium means zero net force."
    },
    {
        "question": "What is the derivative of e^x with respect to x?",
        "options": ["x*e^(x-1)", "e^x", "ln(x)", "1/x"],
        "correct_answer": "e^x",
        "explanation": "The exponential function e^x is its own derivative."
    },
    {
        "question": "In chemistry, what is the atomic number of Carbon?",
        "options": ["12", "14", "6", "8"],
        "correct_answer": "6",
        "explanation": "Carbon features exactly 6 protons in its nucleus."
    },
    {
        "question": "What is traditionally called the powerhouse of the cell?",
        "options": ["Nucleus", "Mitochondria", "Ribosome", "Endoplasmic Reticulum"],
        "correct_answer": "Mitochondria",
        "explanation": "Mitochondria generate most of the cell's supply of ATP."
    },
    {
        "question": "Which of these is a scalar quantity?",
        "options": ["Velocity", "Acceleration", "Force", "Speed"],
        "correct_answer": "Speed",
        "explanation": "Speed has only magnitude, without a specific direction."
    }
]


async def generate_mcqs(topic: str, subject_context: str = "") -> list[dict]:
    """
    Generate a set of practice questions for a topic.

    Falls back to a small built-in set so the learner is never stuck on a
    loading screen.
    """
    subject_line = f" The subject area is: {subject_context}." if subject_context else ""
    system = (
        f"{MENTOR_PERSONA} "
        f"Generate exactly 5 multiple-choice questions on the topic: {topic}.{subject_line} "
        "Spread the questions across every topic that is listed, rather than focusing on only one. "
        "Questions must be answerable from first principles and must not rely on memorised tricks. "
        "Keep the 'explanation' field focused: maximum 2 sentences that state the reasoning. "
        "Return only a JSON array of 5 objects, each with the keys "
        "'question', 'options' (exactly 4 strings), 'correct_answer' and 'explanation'. "
        "Never use unescaped double quotes inside the text; use single quotes instead. "
        "Output raw JSON only — no markdown fences, no commentary."
    )
    user = f"Generate 5 practice questions about: {topic}"

    result = await _generate(
        system, user,
        schema=MCQ_SCHEMA,
        gemini_schema=GEMINI_RESPONSE_SCHEMA,
        temperature=0.7,
    )

    if isinstance(result, list) and result:
        return result

    logger.error("Could not generate practice questions — using the built-in set.")
    return FALLBACK_PRACTICE_QUESTIONS


async def generate_mcqs_from_context(context_text: str) -> list[dict]:
    """Generate questions grounded strictly in a learner's own material."""
    system = (
        f"{MENTOR_PERSONA} "
        "Generate exactly 5 multiple-choice questions based STRICTLY on the provided context text. "
        "Do not use outside knowledge. Return only a JSON array of 5 objects, each with the keys "
        "'question', 'options' (exactly 4 strings), 'correct_answer' and 'explanation'. "
        "Output raw JSON only."
    )

    result = await _generate(
        system,
        f"Context Text:\n{context_text}",
        schema=MCQ_SCHEMA,
        gemini_schema=GEMINI_RESPONSE_SCHEMA,
        temperature=0.5,
    )

    if isinstance(result, list) and result:
        return result

    return FALLBACK_PRACTICE_QUESTIONS


async def extract_pdf_topics(pdf_text: str) -> list[str]:
    """Extract the core subject topics from a learner's document."""
    system = (
        "You are an academic analyzer. Extract the top 4-6 core subject topics or tags from this "
        "educational text. Keep topic names concise (e.g., 'Thermodynamics', 'Organic Chemistry', "
        "'Poetic Devices'). Return only a JSON array of strings. Output raw JSON only."
    )

    result = await _generate(
        system,
        f"PDF CONTENT:\n{pdf_text[:10000]}",
        schema=TOPIC_SCHEMA,
        temperature=0.2,
    )

    if isinstance(result, list) and result:
        return [str(t) for t in result if t]

    return []


async def generate_resource_mcqs(doc_ids: list[str], subject_context: str = "") -> list[dict]:
    """Generate practice questions grounded in the learner's own documents."""
    if not doc_ids:
        return FALLBACK_PRACTICE_QUESTIONS

    from app.services.rag import run_on_collection

    # Query ChromaDB to get all text chunks for the checked documents
    results = run_on_collection(
        lambda col: col.get(where={"doc_id": {"$in": doc_ids}})
    )

    # Combine the text chunks, slice the string to a maximum of 15,000 characters
    combined_text = "\n".join(results.get("documents", []))[:15000]

    system = (
        f"{MENTOR_PERSONA} "
        "Generate exactly 5 multiple-choice questions based STRICTLY on the provided context text. "
        "Do not hallucinate outside info. Return only a JSON array of 5 objects, each with the keys "
        "'question', 'options' (exactly 4 strings), 'correct_answer' and 'explanation'. "
        "Output raw JSON only."
    )

    result = await _generate(
        system,
        f"Context Text:\n{combined_text}",
        schema=MCQ_SCHEMA,
        gemini_schema=GEMINI_RESPONSE_SCHEMA,
        temperature=0.5,
    )

    if isinstance(result, list) and result:
        return result

    return FALLBACK_PRACTICE_QUESTIONS


async def generate_daily_plan(
    days_remaining: int, pending_topics: list[str], urgent_srs: list[str]
) -> list[dict]:
    """Build an optimised daily study mission for the learner."""
    system = (
        f"{MENTOR_PERSONA} "
        "Based on the learner's remaining study window, pending course topics, and topics whose "
        "memory is decaying, build one optimal daily mission. "
        "Return only a JSON array of up to 3 objects, each with the keys "
        "'task_title', 'reasoning', 'action_type' and 'target_topic'. "
        "'action_type' MUST be exactly one of: 'resource_study', 'practice_arena', 'revision'. "
        "Keep 'reasoning' supportive and specific — explain why this is the best use of today's time. "
        "Output raw JSON only."
    )
    user = (
        f"Remaining study days: {days_remaining}\n"
        f"Pending course topics: {pending_topics}\n"
        f"Topics due for review (memory decaying): {urgent_srs}\n\n"
        "Generate a strictly optimal daily mission."
    )

    result = await _generate(
        system, user,
        schema=PLAN_SCHEMA,
        temperature=0.3,
    )

    if isinstance(result, list) and result:
        return result

    logger.error("The planner returned an unexpected format — using a safe default.")
    return [{
        "task_title": "Review a Pending Topic",
        "reasoning": "The AI planner returned an unexpected format, so here is a simple, reliable task.",
        "action_type": "resource_study",
        "target_topic": pending_topics[0] if pending_topics else "General Concepts",
    }]


async def generate_adaptive_practice(
    topic: str, past_mistakes: list[str], subject_context: str = ""
) -> list[dict]:
    """Generate questions aimed squarely at the learner's weak spots."""
    subject_line = f" The subject area is: {subject_context}." if subject_context else ""
    system = (
        f"{MENTOR_PERSONA} "
        f"The learner is struggling with '{topic}'.{subject_line} "
        f"Previously they stumbled on these concepts: {past_mistakes}. "
        "Generate exactly 5 new questions that target this exact weakness and help the "
        "learner rebuild the underlying concept step by step. "
        "Return only a JSON array of 5 objects, each with the keys "
        "'question', 'options' (exactly 4 strings), 'correct_answer' and 'explanation'. "
        "Output raw JSON only."
    )

    result = await _generate(
        system,
        "Generate the practice set.",
        schema=MCQ_SCHEMA,
        gemini_schema=GEMINI_RESPONSE_SCHEMA,
        temperature=0.5,
    )

    if isinstance(result, list) and result:
        return result

    return FALLBACK_PRACTICE_QUESTIONS
