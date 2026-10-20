import os
import httpx
import logging
from dotenv import load_dotenv

from app.core.constants import build_resource_query, sanitize_search_terms

logger = logging.getLogger(__name__)

# ── API Key ───────────────────────────────────────────────────────────────────
load_dotenv()
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "").strip().strip("'").strip('"')

YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"


def build_query(subject: str, topic: str) -> str:
    """
    Build a clean resource-search query.

    The query is always "{subject} {topic}" plus a neutral teaching qualifier.
    No test names, no packaging jargon, no ranking vocabulary — the platform is
    subject-agnostic, so the search must be too.
    """
    return build_resource_query(subject, topic)


async def get_youtube_videos(query: str, max_results: int = 2) -> list[str]:
    """
    Searches YouTube Data API v3 for videos matching the query.
    Returns a list of videoId strings.
    Returns an empty list [] silently if the API fails, quota is exceeded,
    or the key is missing — so the main endpoint never crashes due to YouTube.
    """
    if not YOUTUBE_API_KEY:
        logger.warning("YOUTUBE_API_KEY is not set. Skipping YouTube search.")
        return []

    # Keep the query clean even if the caller passed a noisy string.
    clean_query = sanitize_search_terms(query)
    if not clean_query:
        return []

    params = {
        "part":       "snippet",
        "q":          clean_query,
        "type":       "video",
        "key":        YOUTUBE_API_KEY,
        "maxResults": max_results,
        # Prefer educational content
        "relevanceLanguage": "en",
        "safeSearch":        "strict",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(YOUTUBE_SEARCH_URL, params=params)

        if response.status_code != 200:
            logger.error(
                f"YouTube API failed — HTTP {response.status_code}: {response.text[:200]}"
            )
            return []

        data = response.json()
        items = data.get("items", [])

        video_ids = [
            item["id"]["videoId"]
            for item in items
            if item.get("id", {}).get("kind") == "youtube#video"
        ]

        logger.info(f"YouTube search '{clean_query}' → {video_ids}")
        return video_ids

    except Exception as e:
        # Graceful degradation: YouTube failure NEVER crashes the app
        logger.error(f"YouTube service error for query '{query}': {type(e).__name__}: {e}")
        return []
