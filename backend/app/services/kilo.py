"""
Client for the Kilo gateway — an OpenAI-compatible completion API.

The gateway serves a pool of free models, and the app rotates between them
when one is rate limited. A key is optional: the free models answer
anonymously, and setting ``KILO_API_KEY`` simply raises the rate limit.

Used for all text generation. Embeddings are not served by the gateway, so
those still go through Gemini (see ``app/services/rag.py``).
"""

import json
import logging
from typing import Any, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Status codes that mean "this model cannot serve the request right now" and
# the next candidate should be tried.
RETRYABLE_STATUS = (400, 402, 403, 404, 429, 500, 502, 503, 504)


def _is_response_format_rejection(status_code: int, body: str) -> bool:
    """
    Did the model reject the request because it does not support
    ``response_format``?

    Support varies per model on the gateway: some accept a JSON schema, others
    only accept plain text. When that happens the request is retried without
    the constraint and the reply is parsed defensively instead.
    """
    if status_code != 400:
        return False
    lowered = body.lower()
    return "response_format" in lowered or "json_schema" in lowered


def _headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if settings.KILO_API_KEY:
        headers["Authorization"] = f"Bearer {settings.KILO_API_KEY}"
    return headers


def _extract_content(message: dict) -> str:
    """
    Pull the text out of a completion message.

    Providers differ: the content may be a plain string, a list of parts, or
    empty with the text parked in the reasoning field.
    """
    content = message.get("content")

    if isinstance(content, str) and content.strip():
        return content

    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", ""))
            elif isinstance(part, str):
                parts.append(part)
        joined = "".join(parts).strip()
        if joined:
            return joined

    reasoning = message.get("reasoning")
    if isinstance(reasoning, str) and reasoning.strip():
        return reasoning

    return ""


async def chat_completion(
    system: str,
    user: str,
    json_schema: Optional[dict] = None,
    max_tokens: int = 8192,
    temperature: float = 0.7,
) -> Optional[str]:
    """
    Send a chat completion and return the assistant's text.

    When ``json_schema`` is given the request asks for JSON that matches it.
    The gateway enforces the schema for the models that support it; for the
    others the prompt still asks for JSON, and the caller parses the result
    defensively.

    Returns ``None`` when every candidate model failed.
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})

    payload: dict = {
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }

    if json_schema is not None:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "response",
                "strict": False,
                "schema": json_schema,
            },
        }

    models = settings.KILO_MODELS or ["poolside/laguna-s-2.1:free"]
    last_error = None

    for index, model in enumerate(models):
        body = dict(payload)
        body["model"] = model
        url = f"{settings.KILO_API_BASE.rstrip('/')}/chat/completions"

        async def send(current_body):
            async with httpx.AsyncClient(timeout=settings.KILO_TIMEOUT) as client:
                return await client.post(url, json=current_body, headers=_headers())

        try:
            response = await send(body)
        except httpx.HTTPError as exc:
            logger.warning("Kilo request error on %s: %s", model, exc)
            last_error = str(exc)
            continue

        # The model does not support structured output — ask for plain JSON
        # in the prompt instead and parse the reply defensively.
        if _is_response_format_rejection(response.status_code, response.text) and "response_format" in body:
            logger.warning(
                "Kilo model %s does not support response_format — retrying without it.",
                model,
            )
            body.pop("response_format", None)
            try:
                response = await send(body)
            except httpx.HTTPError as exc:
                logger.warning("Kilo retry error on %s: %s", model, exc)
                last_error = str(exc)
                continue

        if response.status_code == 200:
            try:
                data = response.json()
                message = data["choices"][0]["message"]
            except (KeyError, IndexError, ValueError) as exc:
                logger.warning("Kilo returned an unexpected body on %s: %s", model, exc)
                last_error = str(exc)
                continue

            text = _extract_content(message)
            if text:
                return text

            logger.warning("Kilo model %s returned an empty completion.", model)
            last_error = "empty completion"
            continue

        if response.status_code in RETRYABLE_STATUS and index < len(models) - 1:
            logger.warning(
                "Kilo model %s returned %d — trying the next model.",
                model, response.status_code,
            )
            last_error = f"{response.status_code}: {response.text[:200]}"
            continue

        logger.error("Kilo model %s failed with %d: %s", model, response.status_code, response.text[:300])
        return None

    logger.error("Every Kilo model failed. Last error: %s", last_error)
    return None


async def chat_json(
    system: str,
    user: str,
    json_schema: Optional[dict] = None,
    max_tokens: int = 8192,
    temperature: float = 0.7,
) -> Optional[Any]:
    """
    Send a chat completion and parse the reply as JSON.

    Handles the usual wrappers: a bare JSON document, a fenced code block, or
    JSON embedded in prose.
    """
    text = await chat_completion(
        system=system,
        user=user,
        json_schema=json_schema,
        max_tokens=max_tokens,
        temperature=temperature,
    )
    if not text:
        return None

    return parse_json(text)


def parse_json(text: str) -> Optional[Any]:
    """Best-effort extraction of a JSON document from a model reply."""
    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[: -3]
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Fall back to the outermost {...} or [...] block.
    for opening, closing in (("[", "]"), ("{", "}")):
        start = cleaned.find(opening)
        end = cleaned.rfind(closing)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except json.JSONDecodeError:
                continue

    return None
