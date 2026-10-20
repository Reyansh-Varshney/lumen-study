import os
import logging
from typing import Annotated, List

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from pydantic import field_validator

load_dotenv()

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    MONGO_URI: str = os.getenv("MONGO_URI", "")
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "your_secret_key")
    ALGORITHM: str = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    DATABASE_NAME: str = os.getenv("DATABASE_NAME", "lumen_db")

    # AI providers
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_API_KEY_2: str = os.getenv("GEMINI_API_KEY_2", "")
    YOUTUBE_API_KEY: str = os.getenv("YOUTUBE_API_KEY", "")

    # ── Kilo gateway (primary text generation) ──────────────────────────────
    # OpenAI-compatible gateway. The free models work without a key, so
    # KILO_API_KEY is optional — set it to raise the rate limit.
    KILO_API_BASE: str = os.getenv("KILO_API_BASE", "https://api.kilo.ai/api/gateway")
    KILO_API_KEY: str = os.getenv("KILO_API_KEY", "")
    # NoDecode: these are comma-separated lists, not JSON arrays.
    KILO_MODELS: Annotated[List[str], NoDecode] = [
        m.strip()
        for m in os.getenv(
            "KILO_MODELS",
            "poolside/laguna-s-2.1:free,"
            "poolside/laguna-xs-2.1:free,"
            "minimax/minimax-m3.1-flash:free,"
            "nvidia/nemotron-3.5-lightning:free",
        ).split(",")
        if m.strip()
    ]
    KILO_TIMEOUT: float = float(os.getenv("KILO_TIMEOUT", "120"))

    # Candidate Gemini models, best first. The daily free-tier quota is
    # tracked per model, so falling back to a different model keeps the app
    # working when one of them is exhausted. Gemini is only used for
    # embeddings now — the gateway does not serve an embedding model.
    GEMINI_MODELS: Annotated[List[str], NoDecode] = [
        m.strip()
        for m in os.getenv(
            "GEMINI_MODELS",
            "gemini-2.5-flash,gemini-3.8-flash,gemini-3.5-flash,gemini-2.5-flash-lite",
        ).split(",")
        if m.strip()
    ]

    # Candidate embedding models, best first.
    GEMINI_EMBEDDING_MODELS: Annotated[List[str], NoDecode] = [
        m.strip()
        for m in os.getenv(
            "GEMINI_EMBEDDING_MODELS",
            "gemini-embedding-001,gemini-embedding-2",
        ).split(",")
        if m.strip()
    ]

    # ── NVIDIA NIM (embeddings) ─────────────────────────────────────────────
    # The Kilo gateway does not serve an embedding model, so vectors come
    # from NVIDIA NIM. `nvidia/nemotron-3-embed-1b` is a retrieval model:
    # it wants "query" for the search side and "passage" for stored text.
    NVIDIA_API_KEY: str = os.getenv("NVIDIA_API_KEY", "")
    NVIDIA_EMBEDDING_BASE: str = os.getenv(
        "NVIDIA_EMBEDDING_BASE", "https://integrate.api.nvidia.com/v1"
    )
    NVIDIA_EMBEDDING_MODEL: str = os.getenv(
        "NVIDIA_EMBEDDING_MODEL", "nvidia/nemotron-3-embed-1b"
    )

    # Optional — only needed by optional integrations.
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")

    # Vector store
    CHROMA_DB_DIR: str = os.getenv("CHROMA_DB_DIR", "./chroma_db")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator(
        "KILO_MODELS", "GEMINI_MODELS", "GEMINI_EMBEDDING_MODELS",
        mode="before",
    )
    @classmethod
    def _split_csv(cls, value):
        """Accept a comma-separated string as well as a list."""
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @property
    def GEMINI_API_KEYS(self) -> list[str]:
        """Every configured Gemini key, in priority order.

        The free tier allows only a small number of requests per day per
        project, so the app rotates to the next key when one is exhausted.
        """
        return [k.strip() for k in (self.GEMINI_API_KEY, self.GEMINI_API_KEY_2) if k.strip()]


settings = Settings()

# ── Validation ───────────────────────────────────────────────────────────────
# Only the keys the platform genuinely depends on are mandatory. Optional
# integrations degrade gracefully instead of blocking the whole application.
if not settings.MONGO_URI:
    raise ValueError("MONGO_URI is missing from environment variables or .env file.")

if not settings.GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY is missing from environment variables or .env file.")

if not settings.GROQ_API_KEY:
    logger.warning(
        "GROQ_API_KEY is not set. Optional integrations that use it will be skipped."
    )
