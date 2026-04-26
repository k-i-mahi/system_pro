from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_REPO_DIR = _BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[_REPO_DIR / ".env", _BACKEND_DIR / ".env"],
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"
    ARQ_REDIS_URL: str = "redis://localhost:6379/2"
    AUTH_SECRET: str
    JWT_ACCESS_EXPIRES: str = "15m"
    JWT_REFRESH_EXPIRES: str = "7d"

    CLOUDINARY_CLOUD_NAME: str | None = None
    CLOUDINARY_API_KEY: str | None = None
    CLOUDINARY_API_SECRET: str | None = None
    CLOUDINARY_UPLOAD_FOLDER: str = "cognitive-copilot"

    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2"
    OLLAMA_VISION_MODEL: str = ""
    OLLAMA_EMBEDDING_MODEL: str = "nomic-embed-text"
    OLLAMA_EMBEDDING_DIM: int = 768

    AI_SIDECAR_URL: str = "http://localhost:8000"
    METRICS_KEY: str = "change-me"

    ENABLE_CROSS_ENCODER: bool = False
    ENABLE_AGENT_TOOLS: bool = True
    AGENT_MAX_ITERATIONS: int = 5
    AGENT_WALL_CLOCK_MS: int = 12_000

    RAG_TOP_K: int = 8
    RAG_CHUNK_SIZE: int = 800
    RAG_CHUNK_OVERLAP: int = 150

    # RAG material indexing: false = in API process; true = Redis ARQ (requires a running arq worker).
    INGEST_USE_ARQ_QUEUE: bool = False
    # If True, wait for indexing to finish before returning from upload/reingest (reliable for Ask Course).
    # Ignored when INGEST_USE_ARQ_QUEUE is True (queue is async; run the ingest worker or set queue to False).
    INGEST_AWAIT: bool = True

    LLM_LOG_SAMPLING_RATE: float = 1.0

    PORT: int = 3002
    CORS_ORIGINS: str = "http://localhost:5173"
    NODE_ENV: str = "development"

    EMAIL_PROVIDER: str = "smtp"
    EMAIL_FROM_NAME: str = "Cognitive Copilot"
    EMAIL_FROM_ADDRESS: str | None = None
    EMAIL_REPLY_TO: str | None = None

    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASS: str | None = None
    SMTP_FROM: str | None = None
    SMTP_USE_TLS: bool = True
    RESEND_API_KEY: str | None = None
    RESEND_BASE_URL: str = "https://api.resend.com"
    FRONTEND_URL: str = "http://localhost:5173"
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REDIRECT_URI: str | None = None

    @property
    def async_database_url(self) -> str:
        """Convert postgres:// or postgresql:// to asyncpg driver URL."""
        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

    @property
    def jwt_access_seconds(self) -> int:
        return _parse_duration(self.JWT_ACCESS_EXPIRES)

    @property
    def jwt_refresh_seconds(self) -> int:
        return _parse_duration(self.JWT_REFRESH_EXPIRES)

    @property
    def email_provider(self) -> str:
        return self.EMAIL_PROVIDER.strip().lower()

    @property
    def email_from_address(self) -> str:
        if self.EMAIL_FROM_ADDRESS and self.EMAIL_FROM_ADDRESS.strip():
            return self.EMAIL_FROM_ADDRESS.strip()
        if self.SMTP_FROM and self.SMTP_FROM.strip():
            return self.SMTP_FROM.strip()
        if self.SMTP_USER and self.SMTP_USER.strip():
            return self.SMTP_USER.strip()
        return "noreply@cognitivecopilot.com"

    @property
    def email_from_header(self) -> str:
        if self.EMAIL_FROM_NAME.strip():
            return f"{self.EMAIL_FROM_NAME.strip()} <{self.email_from_address}>"
        return self.email_from_address

    @property
    def resend_base_url(self) -> str:
        return self.RESEND_BASE_URL.rstrip("/")


def _parse_duration(s: str) -> int:
    """Convert '15m' → 900, '7d' → 604800."""
    unit = s[-1]
    value = int(s[:-1])
    return value * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]


settings = Settings()
