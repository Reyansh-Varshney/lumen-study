"""
Provider-layer tests: the Kilo gateway for text generation and NVIDIA NIM for
embeddings.

These hit the network, so each one skips itself when the provider cannot be
reached rather than failing the suite.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.services import kilo
from app.services.embeddings import (
    INPUT_TYPE_PASSAGE,
    INPUT_TYPE_QUERY,
    embed,
)


def _kilo_available() -> bool:
    try:
        import httpx
        response = httpx.get(
            f"{settings.KILO_API_BASE.rstrip('/')}/models", timeout=20.0
        )
        return response.status_code == 200
    except Exception:
        return False


def _nvidia_available() -> bool:
    if not settings.NVIDIA_API_KEY:
        return False
    try:
        import httpx
        response = httpx.post(
            f"{settings.NVIDIA_EMBEDDING_BASE.rstrip('/')}/embeddings",
            json={"model": settings.NVIDIA_EMBEDDING_MODEL, "input": ["ping"]},
            headers={"Authorization": f"Bearer {settings.NVIDIA_API_KEY}"},
            timeout=30.0,
        )
        return response.status_code == 200
    except Exception:
        return False


KILO = pytest.mark.skipif(not _kilo_available(), reason="Kilo gateway is unreachable")
NIM = pytest.mark.skipif(not _nvidia_available(), reason="NVIDIA NIM is unreachable")


# ── Configuration ────────────────────────────────────────────────────────────
def test_kilo_is_configured():
    assert settings.KILO_API_BASE.startswith("http")
    assert settings.KILO_MODELS, "at least one Kilo model must be configured"
    assert settings.KILO_MODELS[0]


def test_nvidia_is_configured():
    assert settings.NVIDIA_EMBEDDING_BASE.startswith("http")
    assert settings.NVIDIA_EMBEDDING_MODEL


# ── Kilo gateway ────────────────────────────────────────────────────────────
@KILO
def test_kilo_chat_completion_returns_text():
    import asyncio

    text = asyncio.run(kilo.chat_completion(
        system="Reply with the single word: pong",
        user="ping",
        max_tokens=32,
        temperature=0,
    ))
    assert text, "the gateway should return a completion"
    assert "pong" in text.lower()


@KILO
def test_kilo_parsing_handles_json_and_prose():
    # A bare JSON document.
    assert kilo.parse_json('{"a": 1}') == {"a": 1}
    # A fenced code block.
    assert kilo.parse_json('```json\n{"a": 2}\n```') == {"a": 2}
    # JSON wrapped in prose.
    assert kilo.parse_json('Here you go:\n{"a": 3}\nHope that helps.') == {"a": 3}
    # An array.
    assert kilo.parse_json('[1, 2, 3]') == [1, 2, 3]
    # Nothing usable.
    assert kilo.parse_json("not json at all") is None


@KILO
def test_generate_mcqs_returns_real_questions():
    """The practice generator must not fall back to the built-in set."""
    import asyncio

    from app.services.llm import FALLBACK_PRACTICE_QUESTIONS, generate_mcqs

    questions = asyncio.run(generate_mcqs("photosynthesis", "Biology"))
    assert len(questions) == 5
    for question in questions:
        assert question["question"]
        assert len(question["options"]) == 4
        assert question["correct_answer"] in question["options"]
        assert question["explanation"]
    assert questions != FALLBACK_PRACTICE_QUESTIONS


@KILO
def test_generate_daily_plan_uses_generic_action_types():
    import asyncio

    from app.services.llm import generate_daily_plan

    plan = asyncio.run(generate_daily_plan(30, ["Cell Biology"], ["Osmosis"]))
    assert plan
    allowed = {"resource_study", "practice_arena", "practice_test", "revision"}
    for task in plan:
        assert task["action_type"] in allowed
        assert task["task_title"]
        assert task["target_topic"]


# ── NVIDIA NIM embeddings ────────────────────────────────────────────────────
@NIM
def test_embeddings_return_matching_dimensions():
    import asyncio

    passage = asyncio.run(embed(["Water moves across a membrane."],
                                input_type=INPUT_TYPE_PASSAGE))
    query = asyncio.run(embed(["What is osmosis?"], input_type=INPUT_TYPE_QUERY))

    assert passage and query
    assert len(passage) == 1 and len(query) == 1
    assert len(passage[0]) == len(query[0]), "passage and query must share a dimension"
    assert len(passage[0]) > 0


@NIM
def test_embeddings_are_normalised_ish():
    """Cosine similarity should be high for related text."""
    import asyncio
    import math

    vectors = asyncio.run(embed([
        "The cell membrane controls what enters and leaves the cell.",
        "The plasma membrane is selectively permeable.",
        "Photosynthesis converts light energy into chemical energy.",
    ], input_type=INPUT_TYPE_PASSAGE))
    assert vectors and len(vectors) == 3

    def cosine(a, b):
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(y * y for y in b))
        return dot / (na * nb)

    related = cosine(vectors[0], vectors[1])
    unrelated = cosine(vectors[0], vectors[2])
    assert related > unrelated, (
        f"related pairs ({related:.3f}) should score higher than unrelated ({unrelated:.3f})"
    )
