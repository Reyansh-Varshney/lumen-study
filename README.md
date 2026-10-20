# Lumen

> Your AI study companion

> **An AI-powered study hub for any subject — map your course, learn from your own material, and revise on schedule.**

[![Built with React](https://img.shields.io/badge/Built_with-React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![Powered by FastAPI](https://img.shields.io/badge/Powered_by-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![AI by Kilo](https://img.shields.io/badge/AI_by-Kilo-F55036?style=for-the-badge&logo=opencode&logoColor=white)](https://kilo.ai/)
[![Embeddings by NVIDIA](https://img.shields.io/badge/Embeddings_by-NVIDIA-76B900?style=for-the-badge&logo=nvidia&logoColor=white)](https://build.nvidia.com)
[![Database MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)

---

## 🌟 The Vision

Most study tools assume you are chasing one specific credential. Lumen does not.
It assumes only that you are learning something, that your material is yours, and that
your attention is finite.

So the platform is built around four ideas: a **map** of what you are studying, a
**library** of the material you already own, a **practice room** where you can work
under time pressure, and a **revision loop** that schedules review based on how fast
you are actually forgetting. The AI sits underneath all four — generating questions
from your notes, explaining why a line of reasoning failed, and finding clean
teaching material on the web — but the learning model stays yours.

Nothing is hard-coded to a single subject or level. Bring a maths syllabus, a law
reading list, a language grammar, or a professional certification outline, and the
platform reshapes around it.

## ✨ Key Features

### 🗂️ 1. Course Tracker — Subject → Module → Topic

- **PDF import:** upload a syllabus or course outline and it is parsed into a clean
  `Subject → Module → Topic` tree you can work from immediately.
- **Manual control:** add subjects, add modules, add topics, mark a topic complete,
  or remove a whole subject — the tracker is always editable by hand.
- **Roadmap view:** see the entire course at a glance, drill into any subject, and
  watch your own completion percentage grow.
- **Any subject, any level:** the tracker knows nothing about a fixed subject list,
  so the structure follows your material.

### 📚 2. Resource Library — learn from your own documents

- **Upload notes, textbooks and syllabus PDFs.** Every page is extracted, chunked
  and embedded into a shared vector store, tagged to the subject you choose.
- **Ask questions with citations.** Answers are grounded in your own uploaded
  material and point back to the source passages they came from.
- **Socratic mode.** Instead of handing over the answer, the tutor asks you
  questions and guides you to it yourself.
- **Generate practice from your notes.** Turn any passage in your scratchpad or
  library into question-and-answer pairs you can drill on.
- **Scratchpad.** A quick capture area for fragments, formulas and notes that you
  can turn into a practice set on demand.

### ⚔️ 3. Practice Arena — live, timed, by subject

- Play a live 1v1 match against another learner, or against the built-in bot.
- Matches are **matched by subject**, so you are only ever fighting on material you
  actually care about.
- Timed rounds with a running score, so the pressure is real without the stakes
  being artificial.
- A live scoreboard and chat channel over a WebSocket connection, with results fed
  straight into your progress data.

### 🎯 4. Self-Assessment with focus mode

- Generate a timed practice test from your course, then work through it in a calm,
  distraction-free screen.
- **Focus mode** keeps you in the zone: fullscreen is enforced, tab switches are
  detected, and a lightweight camera-based check confirms you are still present.
- A tolerance window means a brief glance away is forgiven; sustained inattention
  is flagged and the session is closed out.
- Every question, your answer, and the reasoning behind it is captured for review
  afterwards.

### 🧠 5. Spaced Repetition (SM-2) Revision Engine

- Every mistake you make — in a live match, a practice set, or a library
  question — is written into a spaced repetition store.
- The **SM-2 algorithm** schedules each item at the moment you are about to forget
  it, so review effort is spent where it actually pays off.
- The revision screen shows your retention curve, your due queue and your streak,
  and the schedule reshapes itself as you answer.

### 🤝 6. AI Mentor

- A **supportive academic mentor** that meets you where your reasoning broke, not
  just where the answer differed. It explains *why* a step failed.
- **Targeted feedback on wrong reasoning:** each incorrect answer is fed back
  through the mentor, which diagnoses the misconception and suggests a better
  approach.
- **Clean video-resource retrieval:** when you need a worked explanation, the
  mentor searches for teaching material and returns it with search noise, hype
  and clickbait stripped out.
- Cohort stats, a learner roster and intervention alerts for anyone running the
  platform for a group.

### 🗓️ 7. Daily study planner that reacts to the forgetting curve

- Each morning the planner builds a concrete schedule for the day from your
  tracker, your due review items and your recent activity.
- Planned blocks are typed: `resource_study`, `practice_arena`, `practice_test`
  or `revision` — so a session is always a *specific* action, not a vague nudge.
- The plan shifts as the forgetting curve moves: an item scheduled for tomorrow
  can slide forward into today the moment it starts to decay.
- The dashboard surfaces the same plan, so what you intend to study and what you
  actually did stay in sync.

---

## 🏗️ System Architecture

- **Frontend:** React 19 + Vite + Tailwind CSS, with Framer Motion for motion and
  Recharts for progress visualisations.
- **Backend:** Python FastAPI for asynchronous AI processing and data routing.
- **Database:** MongoDB via the Motor async driver.
- **Vector store:** ChromaDB, holding only the documents a learner uploaded.
- **AI routing:**
  - **Kilo gateway** — all text generation: tutoring, mentor feedback, question
    sets, daily planning and document structuring. Free models are tried in
    order until one answers.
  - **NVIDIA NIM** — embeddings for the resource library, using the
    `nvidia/nemotron-3-embed-1b` retrieval model.
  - **Google Gemini** — a fallback provider, used only when Kilo cannot serve
    a request.
- **Realtime:** a WebSocket channel at `ws://localhost:8000/ws/arena` powers the
  live Practice Arena.

### Repository layout

```text
.
├── backend/          FastAPI service, ChromaDB store, maintenance scripts
├── Frontend/         React + Vite single-page app
├── extension/        "Lumen Focus" Chrome extension (Manifest V3)
└── README.md
```

---

## 🚀 Local Installation & Setup

### Prerequisites

- Node.js (v18+)
- Python (3.10+)
- MongoDB (local instance or Atlas URI)

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/your-repo-name.git
cd your-repo-name
```

### 2. Backend Setup (FastAPI)

Open a terminal and go to the `backend/` folder:

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env              # Windows: Copy-Item .env.example .env
```

**Configure your `.env` file:**

```env
MONGO_URI=mongodb://localhost:27017
JWT_SECRET_KEY=your_strong_secret_here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Text generation (the free models need no key)
KILO_API_BASE=https://api.kilo.ai/api/gateway
KILO_MODELS=poolside/laguna-s-2.1:free,poolside/laguna-xs-2.1:free,minimax/minimax-m3.1-flash:free

# Embeddings
NVIDIA_API_KEY=your_nvidia_key_here
NVIDIA_EMBEDDING_MODEL=nvidia/nemotron-3-embed-1b

# Optional fallbacks
GEMINI_API_KEY=your_gemini_key_here
YOUTUBE_API_KEY=your_youtube_key_here
```

**Start the server:**

```bash
uvicorn app.main:app --reload --port 8000
```

The API is then available at `http://localhost:8000`, with interactive docs at
`http://localhost:8000/docs`. The backend refuses to boot if `MONGO_URI` or
`GEMINI_API_KEY` is missing, so set them before the first run.

### 3. Frontend Setup (React / Vite)

Open a second terminal and go to the `Frontend/` folder (note the capital **F**):

```bash
cd Frontend

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app is served at `http://localhost:5173` and talks to the backend at
`http://localhost:8000` (see `Frontend/src/api/axios.js`).

### 4. Face-API Models Configuration

The face-detection weights used by focus mode are **not** committed — they add
~13 MB to the repository. Copy them from the installed package after
`npm install`:

```powershell
Copy-Item Frontend\node_modules\@vladmandic\face-api\model\* Frontend\public\models\
```

Focus mode degrades gracefully if the weights are missing: the session simply
skips the camera check.

### 5. Chrome Extension — "Lumen Focus"

A Manifest V3 extension that strips YouTube of its recommendation rail, Shorts,
comments and home feed, so lectures stay lectures. It pairs with the Lumen
platform but also works completely on its own. See
[`extension/README.md`](extension/README.md) for the full toggle list.

```text
chrome://extensions → Developer mode → Load unpacked → select the extension/ folder
```

Toggle it anywhere on YouTube with **Alt+P**.

---

## 🔧 Environment Variables

The backend reads its configuration from `backend/.env` (see
[`backend/.env.example`](backend/.env.example)).

### AI providers

| Variable | Purpose | Default |
| --- | --- | --- |
| `KILO_API_BASE` | Kilo gateway base URL — used for **all text generation** | `https://api.kilo.ai/api/gateway` |
| `KILO_API_KEY` | Optional. The free models answer without a key; a key only raises the rate limit | — |
| `KILO_MODELS` | Comma-separated model ids, tried in order until one answers | `poolside/laguna-s-2.1:free,poolside/laguna-xs-2.1:free,minimax/minimax-m3.1-flash:free,nvidia/nemotron-3.5-lightning:free` |
| `KILO_TIMEOUT` | Per-request timeout (seconds) | `120` |
| `NVIDIA_API_KEY` | NVIDIA NIM — used for **embeddings** (the gateway serves no embedding model) | — (required for uploads) |
| `NVIDIA_EMBEDDING_BASE` | NIM base URL | `https://integrate.api.nvidia.com/v1` |
| `NVIDIA_EMBEDDING_MODEL` | Embedding model | `nvidia/nemotron-3-embed-1b` |
| `GEMINI_API_KEY` | Gemini — **fallback** text generation only | — |
| `GEMINI_API_KEY_2` | Gemini — second fallback key | — |
| `GEMINI_MODELS` | Gemini fallback models, tried in order | `gemini-2.5-flash,gemini-3.8-flash,…` |
| `YOUTUBE_API_KEY` | YouTube Data API — video-resource retrieval | — |

> **Why two providers?** The Kilo gateway has no embedding endpoint, so vectors
> come from NVIDIA NIM while all text generation goes through Kilo. Gemini is
> kept purely as a fallback, so a rate-limited provider never takes the app
> down — the request simply moves to the next model or key.

The embedding model is a *retrieval* model: stored text is tagged `passage`
and the search text is tagged `query`. Do not mix those up — it measurably
changes retrieval quality.

### Application

| Variable | Purpose | Default |
| --- | --- | --- |
| `MONGO_URI` | MongoDB connection string | — (required) |
| `JWT_SECRET_KEY` | Secret used to sign access tokens | — (required) |
| `ALGORITHM` | Token signature algorithm | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime | `30` |
| `GROQ_API_KEY` | Optional — only used by optional integrations | — |
| `CHROMA_DB_DIR` | Where the vector store is written | `./chroma_db` |
| `DATABASE_NAME` | MongoDB database name | `dev_clash_db` |

The frontend talks to the backend over plain HTTP during development; the CORS
allow-list in `backend/app/main.py` covers `localhost:5173` and `localhost:5174`.

---

## 🧰 Maintenance Scripts

The `backend/scripts/` folder holds three one-off utilities. Run them from the
`backend/` directory so they can find your `.env`.

**1. Migrate the database to the generic schema**

```bash
python -m scripts.migrate_general_hub            # dry run, prints a preview
python -m scripts.migrate_general_hub --apply    # writes the changes
```

Rewrites the MongoDB documents from the older, subject-specific layout into the
current one: the old track fields are replaced by a neutral `active_subjects`
list, a `grade_level` is filled in when missing, the embedded document array is
renamed, the flat chapter list is converted into the `subjects → modules → topics`
hierarchy, legacy collections are renamed, and records still carrying subject-
specific packaging are removed. The dry run is always safe — it only reports.

**2. Purge the legacy vector collection**

```bash
python -m scripts.purge_legacy_vector_store            # dry run
python -m scripts.purge_legacy_vector_store --apply    # drops the collection
```

Reports every collection and document currently in the ChromaDB store, copies your
own uploads into the current `study_resources` collection, then drops the old
seeded collection so nothing pre-bundled survives.

**3. Rebuild the resource library from recovered chunks**

```bash
python -m scripts.rebuild_resource_library --chunks recovered_chunks.json
```

Re-embeds recovered chunk metadata with the same embedding model the app uses and
writes it back into `study_resources` with clean, subject-aware metadata.

---

## 🧪 Tests

Two suites live in `backend/tests/`. Both run against a live MongoDB, and the
web-app suite also needs the dev servers running.

**1. API tests (pytest)** — the learner profile, the
`Subject → Module → Topic` tracker, concurrency, and the dashboard/planner.

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest tests/test_general_hub.py -v
```

**2. Provider tests (pytest)** — the Kilo gateway for text generation and
NVIDIA NIM for embeddings. They skip themselves when a provider is
unreachable, so the suite stays green offline.

```bash
python -m pytest tests/test_providers.py -v
```

**3. End-to-end web-app tests (Playwright)** — drives a real Chromium browser
through sign-up, onboarding, tracker CRUD, a document upload, every route, and
the legacy redirects, while collecting console errors.

```bash
cd backend
pip install playwright
python -m playwright install chromium

# start the servers first
cd backend  && uvicorn app.main:app --reload --port 8000
cd Frontend && npm run dev

# then, from backend/
python tests/test_webapp.py
```

Screenshots are written to a temp folder — set `SHOT_DIR` to change the location.

> **Run one server per port.** A second `uvicorn` on port 8000 will silently
> share the port with the first one, and requests get split between the two
> processes — which looks exactly like a data-loss bug in the tracker.

---

## 🏷️ Platform Name Is Configurable

The visible name of the platform is not hard-coded in one place.

- **Frontend:** `Frontend/src/constants/branding.js` reads `VITE_APP_NAME`,
  `VITE_APP_TAGLINE` and `VITE_APP_DESCRIPTION`. Set them in a `Frontend/.env`
  file (or your shell) to rebrand the whole app.
- **Backend:** `backend/app/core/constants.py` holds `APP_NAME` and `APP_TAGLINE`,
  which feed the FastAPI title, the health-check response and generated content.

---

## 🧠 Challenges We Ran Into (Hackathon Realities)

- **The WASM Bundler War:** we first tried to build the focus engine on WebGazer.js,
  but modern Vite bundlers clashed violently with Google's MediaPipe WASM binaries
  and threw continuous 404s. We pivoted to `@vladmandic/face-api`, trading exact
  pupil tracking for highly accurate head-pose detection, which integrated cleanly
  with React.
- **Audio-Video Synchronization:** making a generated `.mp3` pause, play and seek
  in step with a third-party YouTube iframe required custom React `useRef` hooks
  that tether the HTML5 audio clock to the iframe's progress events.
- **Vector-store rescue:** the seeded legacy collection was a binary b-tree on disk.
  We wrote a SQLite carver to recover chunk metadata, then rebuilt the collection
  cleanly with `scripts/rebuild_resource_library.py`.
- **Provider rotation:** the free tiers we lean on are rate limited per model,
  so every request walks a list of models and keys until one answers.

---

## 🏅 Credits

_Built as an open study companion. Contributions welcome._
