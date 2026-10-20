"""
Embedding client.

Vectors come from NVIDIA NIM (`nvidia/nemotron-3-embed-1b`), which is a
retrieval model: it wants the search side tagged as ``query`` and the stored
text tagged as ``passage``. Tagging them correctly measurably improves
retrieval quality, so the two are never mixed up.

Gemini is kept as a fallback in case the NIM endpoint is unavailable.
"""

import asyncio
import logging
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# The retrieval model's input types.
INPUT_TYPE_QUERY = "query"
INPUT_TYPE_PASSAGE = "passage"


async def _embed_nim(texts: list[str], input_type: str) -> Optional[list[list[float]]]:
    """Embed a batch through NVIDIA NIM."""
    if not settings.NVIDIA_API_KEY:
        return None

    url = f"{settings.NVIDIA_EMBEDDING_BASE.rstrip('/')}/embeddings"
    payload = {
        "model": settings.NVIDIA_EMBEDDING_MODEL,
        "input": texts,
        "input_type": input_type,
        "encoding_format": "float",
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {settings.NVIDIA_API_KEY}",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("NVIDIA NIM embedding request failed: %s", exc)
        return None

    if response.status_code != 200:
        logger.warning(
            "NVIDIA NIM returned %d: %s", response.status_code, response.text[:200]
        )
        return None

    try:
        data = response.json().get("data", [])
    except ValueError as exc:
        logger.warning("NVIDIA NIM returned an unreadable body: %s", exc)
        return None

    if len(data) != len(texts):
        logger.warning(
            "NVIDIA NIM returned %d vectors for %d inputs.", len(data), len(texts)
        )
        return None

    return [item.get("embedding", []) for item in data]


async def _embed_gemini(texts: list[str]) -> Optional[list[list[float]]]:
    """Fallback: embed through the Gemini embedding endpoint."""
    keys = settings.GEMINI_API_KEYS
    models = settings.GEMINI_EMBEDDING_MODELS
    if not keys or not models:
        return None

    combos = [(model, key) for model in models for key in keys]

    requests = [
        {"model": f"models/{combos[0][0]}", "content": {"parts": [{"text": text}]}}
        for text in texts
    ]
    payload = {"requests": requests}

    for model, key in combos:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:batchEmbedContents?key={key}"
        )
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                response = await client.post(url, json=payload)
        except httpx.HTTPError as exc:
            logger.warning("Gemini embedding request failed on %s: %s", model, exc)
            continue

        if response.status_code == 200:
            try:
                embeddings = response.json().get("embeddings", [])
            except ValueError:
                continue
            if len(embeddings) == len(texts):
                return [emb.get("values", []) for emb in embeddings]

        logger.warning(
            "Gemini embedding %s returned %d", model, response.status_code
        )

    return None


async def embed(texts: list[str], input_type: str = INPUT_TYPE_PASSAGE) -> Optional[list[list[float]]]:
    """
    Embed a batch of texts.

    ``input_type`` must be ``"query"`` for the text being searched for and
    ``"passage"`` for text being stored.

    Returns ``None`` when no provider could embed the batch.
    """
    if not texts:
        return []

    vectors = await _embed_nim(texts, input_type)
    if vectors:
        return vectors

    logger.warning("Falling back to Gemini for embeddings.")
    return await _embed_gemini(texts)
