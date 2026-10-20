# Lumen — Backend API

The FastAPI service behind **Lumen**, a general-purpose study platform for any
subject or academic level. It exposes the course tracker, the resource library,
live practice, self-assessment, spaced repetition, the daily planner and the AI
mentor as a single JSON + WebSocket API.

Interactive documentation is served at `/docs` once the server is running.

---

## Tech Stack

- **FastAPI** — async web framework and OpenAPI generation.
- **Motor / PyMongo** — async MongoDB driver.
- **Pydantic v2 + pydantic-settings** — request/response validation and settings.
- **PyJWT** — JSON Web Tokens for authentication.
- **Passlib (bcrypt)** — secure password hashing.
- **ChromaDB** — persistent vector store for learner-uploaded documents.
- **Kilo gateway** — all text generation (OpenAI-compatible completions API).
- **NVIDIA NIM** — embeddings via the `nvidia/nemotron-3-embed-1b` retrieval model.
- **Google Gemini** — fallback provider for text generation.
- **PyMuPDF** — PDF text extraction.

---

## Getting Started

### 1. Prerequisites

- Python 3.10+
- A MongoDB instance (local or Atlas)
- An NVIDIA API key for embeddings (the Kilo free models need no key)

### 2. Installation

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill it in:

| Variable | Purpose | Default |
| --- | --- | --- |
| `MONGO_URI` | MongoDB connection string | — (required) |
| `JWT_SECRET_KEY` | Secret used to sign access tokens | — (required) |
| `ALGORITHM` | Token signature algorithm | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime | `30` |
| `KILO_API_BASE` | Kilo gateway — **all text generation** | `https://api.kilo.ai/api/gateway` |
| `KILO_API_KEY` | Optional; the free models work without it | — |
| `KILO_MODELS` | Comma-separated models, tried in order | `poolside/laguna-s-2.1:free,…` |
| `KILO_TIMEOUT` | Per-request timeout (seconds) | `120` |
| `NVIDIA_API_KEY` | NVIDIA NIM — **all embeddings** | — (required for uploads) |
| `NVIDIA_EMBEDDING_BASE` | NIM base URL | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_EMBEDDING_MODEL` | Embedding model | `nvidia/nemotron-3-embed-1b` |
| `GEMINI_API_KEY` | Gemini — fallback text generation | — |
| `GEMINI_API_KEY_2` | Gemini — second fallback key | — |
| `GEMINI_MODELS` | Gemini fallback models, tried in order | `gemini-2.5-flash,gemini-3.8-flash,…` |
| `YOUTUBE_API_KEY` | YouTube Data API — video-resource retrieval | — |
| `GROQ_API_KEY` | Optional — only used by optional integrations | — |
| `CHROMA_DB_DIR` | Where the vector store is written | `./chroma_db` |
| `DATABASE_NAME` | MongoDB database name | `dev_clash_db` |

**Provider layout.** The Kilo gateway serves the text generation; it has no
embedding endpoint, so vectors come from NVIDIA NIM. Gemini is only a
fallback. When a provider rate-limits a request the app moves on to the next
model or key rather than failing.

The embedding model is a retrieval model: stored text is embedded as a
`passage` and the search text as a `query`. Mixing those up measurably
degrades retrieval quality.

The service raises on start-up if `MONGO_URI` or `GEMINI_API_KEY` is missing
from the environment, so set them before the first run.

### 4. Running the Server

```bash
uvicorn app.main:app --reload --port 8000
```

The API is then live on `http://localhost:8000`.

---

## Folder Structure

```text
backend/
├── app/
│   ├── main.py               FastAPI app, CORS, router registration, health check
│   ├── core/
│   │   ├── config.py         Environment loading (pydantic-settings)
│   │   ├── constants.py      Platform branding, neutral level/subject lists, search sanitising
│   │   ├── database.py       Motor client lifecycle and `get_database()`
│   │   ├── dependencies.py   Authenticated-user dependency
│   │   └── security.py       Password hashing and JWT creation/verification
│   ├── models/               Pydantic schemas
│   │   ├── user.py           User, registration, profile and token schemas
│   │   ├── syllabus.py       Subject / module / topic and roadmap schemas
│   │   ├── quiz.py           Quiz, attempt and recommendation schemas
│   │   ├── srs.py            Spaced repetition record schemas
│   │   ├── doubt.py          Mentor-question schemas
│   │   ├── activity.py       Activity log schemas
│   │   └── common.py         Shared response helpers
│   ├── routes/               HTTP routers
│   │   ├── auth.py           Authentication and profile
│   │   ├── syllabus.py       Course tracker
│   │   ├── vault.py          Resource Library (router prefix `/library`)
│   │   ├── practice_test.py  Self-assessment sessions
│   │   ├── quiz.py           Practice sets and recommendations
│   │   ├── doubt.py          Mentor question handling
│   │   ├── arena.py          Live Practice Arena (WebSocket)
│   │   ├── mentor.py         Mentor stats, roster and alerts
│   │   ├── srs.py            Spaced repetition curves
│   │   ├── planner.py        Daily study planner
│   │   ├── dashboard.py      Dashboard metrics
│   │   └── adaptive.py       Weakness detection
│   ├── services/             Business logic
│   │   ├── llm.py            Provider calls and PDF topic extraction
│   │   ├── tutor.py          Answer generation, Socratic mode, mentor feedback
│   │   ├── rag.py            PDF chunking, embedding and vector-store access
│   │   ├── course.py         Course tracker read/write helpers
│   │   ├── arena.py          Live match orchestration and scoring
│   │   ├── planner_llm.py    Daily plan generation
│   │   └── youtube.py        Video-resource retrieval
│   ├── utils/
│   │   ├── activity.py       Activity logging
│   │   ├── elo.py            Rating maths for live matches
│   │   └── srs.py            SM-2 scheduling
│   └── schemas/              Shared schema package
├── scripts/                  One-off maintenance utilities
├── chroma_db/                Persistent vector store (default location)
└── requirements.txt
```

---

## API Endpoint Groups

All protected routes expect a bearer token: `Authorization: Bearer <access_token>`.

### Authentication — `/auth`

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account. Body: `username`, `email`, `password`, and optionally `grade_level`, `academic_goal`, `active_subjects`. |
| `POST` | `/auth/login` | Exchange email and password for a JWT. |
| `GET` | `/auth/me` | Current profile: `grade_level`, `academic_goal`, `active_subjects`, `target_date`, `master_syllabus_id`. |
| `PATCH` | `/auth/profile` | Update `grade_level`, `academic_goal`, `active_subjects` or `target_date`. |

### Course Tracker — `/syllabus`

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/syllabus/upload` | Multipart upload: `file` (PDF) + `title`. Parsed into subject → module → topic. |
| `GET` | `/syllabus/my-roadmap` | The current learner's course tree with completion state. |
| `POST` | `/syllabus/subjects` | Add a subject. Body: `subject_name`, optional `module_name`. |
| `POST` | `/syllabus/subjects/{subject_name}/modules` | Add a module. Body: `module_name`. |
| `POST` | `/syllabus/subjects/{subject_name}/modules/{module_name}/topics` | Add a topic. Body: `topic_name`. |
| `PATCH` | `/syllabus/topic` | Toggle completion. Body: `subject_name`, `module_name`, `topic_name`, `is_completed`. |
| `DELETE` | `/syllabus/subjects/{subject_name}` | Remove a subject and everything under it. |

### Resource Library — `/library`

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/library/upload` | Multipart upload: `file` (PDF) + `subject`. Chunks, embeds and indexes the document. |
| `POST` | `/library/ask` | Ask a question about your documents. Body: `question`, `active_doc_ids`, `socratic_mode`. |
| `POST` | `/library/generate-practice` | Generate practice questions from a text block. |
| `GET` | `/library/documents` | List the documents the learner has uploaded. |
| `POST` | `/library/scratchpad` | Save a scratchpad entry. |
| `GET` | `/library/scratchpad` | Read back scratchpad entries. |

### Self-Assessment — `/practice-test`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/practice-test/generate/{user_id}` | Build a practice test for a learner. |
| `POST` | `/practice-test/submit` | Submit answers; every miss is written to the spaced repetition store. |

### Practice Sets — `/quiz`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/quiz/recommendations` | Suggested topics, ranked by need. |
| `POST` | `/quiz/generate` | Generate a practice set for a topic. |
| `POST` | `/quiz/submit` | Submit a completed set. |
| `GET` | `/quiz/daily` | The daily practice selection. |

### Live Practice Arena — `/ws`

- `WS /ws/arena?token=<access_token>` — live match channel for 1v1 and bot matches.

### Planner, Dashboard, Revision, Mentor, Adaptive

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/planner/daily` | The day's plan. Action types: `resource_study`, `practice_arena`, `practice_test`, `revision`. |
| `GET` | `/dashboard/metrics` | Overall progress metrics for the dashboard. |
| `GET` | `/srs/curves` | Retention and review-schedule curves. |
| `POST` | `/doubt/approach` | Send a question to the mentor. |
| `GET` | `/adaptive/weaknesses` | Detected weak topics. |
| `GET` | `/mentor/stats` | Mentor overview statistics. |
| `GET` | `/mentor/roster` | Learner roster with progress. |
| `GET` | `/mentor/alerts` | Intervention alerts. |
| `GET` | `/` | Health check. |

---

## MongoDB Collections

The default database is `dev_clash_db` (`DATABASE_NAME` in `app/core/config.py`).

| Collection | Contents |
| --- | --- |
| `users` | Accounts, profile fields, `grade_level`, `academic_goal`, `active_subjects`, `target_date`, `master_syllabus_id`, uploaded-document list, match rating. |
| `syllabuses` | Course trees: `subjects → modules → topics`, each topic with `is_completed`. |
| `quizzes` | Generated practice sets. |
| `quiz_attempts` | Submitted practice sets with per-question results. |
| `mistake_logs` | Individual wrong answers, used for mentor feedback and weak-topic detection. |
| `srs_records` | SM-2 review schedules per topic. |
| `activity_logs` | Study activity timeline that drives the planner and dashboard. |
| `resource_sources` | Index of uploaded documents with their subject and source name. |
| `user_topics` | The topic set extracted from a learner's own documents. |
| `source_topics` | Topics extracted per uploaded document. |
| `library_chat_logs` | Question-and-answer history for the Resource Library. |

The vector store lives separately in ChromaDB (`CHROMA_DB_DIR`, default
`./chroma_db`) under the collection `study_resources`, and holds only the
documents a learner uploaded.

---

## Maintenance Scripts

Run these from the `backend/` directory.

```bash
# Migrate MongoDB from the older schema to the generic schema
python -m scripts.migrate_general_hub            # dry run
python -m scripts.migrate_general_hub --apply    # write the changes

# Clean the vector store of legacy, pre-seeded content
python -m scripts.purge_legacy_vector_store            # dry run
python -m scripts.purge_legacy_vector_store --apply    # drop the collection

# Rebuild the vector collection from recovered chunk metadata
python -m scripts.rebuild_resource_library --chunks recovered_chunks.json
```

---

## Branding

`app/core/constants.py` holds `APP_NAME` and `APP_TAGLINE`. They feed the FastAPI
title, the health-check response and generated content, so the platform name can be
changed in one place.
