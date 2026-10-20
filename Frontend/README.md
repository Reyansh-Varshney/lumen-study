# Lumen — Frontend

The React single-page app for **Lumen**, a general-purpose study platform for
any subject or academic level.

---

## Stack

| Package | Purpose |
| --- | --- |
| **React 19** | UI runtime |
| **Vite** | Dev server, bundler and build pipeline |
| **Tailwind CSS** | Utility-first styling |
| **Framer Motion** | Page and component animation |
| **Recharts** | Progress charts (retention curves, activity) |
| **lucide-react** | Icon set |
| **react-router-dom** | Client-side routing |
| **axios** | API client with an auth interceptor |
| **@vladmandic/face-api** | Client-side face detection for focus mode |
| **react-pdf** | In-browser PDF preview |
| **reactflow** / **react-force-graph-2d** | Roadmap and concept-map views |
| **react-hot-toast** | Toast notifications |
| **react-markdown** | Renders AI-generated Markdown answers |

---

## Getting Started

### Install

```bash
cd Frontend
npm install
```

### Development server

```bash
npm run dev
```

Serves the app at `http://localhost:5173` with hot module replacement. The backend
must be running on `http://localhost:8000` — see `src/api/axios.js` for the base
URL and the bearer-token interceptor.

### Build for production

```bash
npm run build
```

Outputs to `dist/`.

### Lint

```bash
npm run lint
```

`src/__lintbase__/` holds a frozen copy of pages that still report issues; it is
kept as a reference point rather than edited.

### Preview a production build

```bash
npm run preview
```

---

## Branding

The visible name comes from `src/constants/branding.js`:

```js
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Lumen';
export const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE || 'Your AI study companion';
export const APP_DESCRIPTION = import.meta.env.VITE_APP_DESCRIPTION || 'An AI-powered study hub for any subject — map your course, learn from your own material, and revise on schedule.';
```

To rebrand the app, create `Frontend/.env` and set the values you want:

```env
VITE_APP_NAME=Lumen
VITE_APP_TAGLINE=Your AI study companion
VITE_APP_DESCRIPTION=An AI-powered study hub for any subject — map your course, learn from your own material, and revise on schedule.
```

The defaults are used when a variable is missing, so partial overrides are fine.

---

## Routes

| Route | Page |
| --- | --- |
| `/` | Dashboard — progress metrics and the daily plan |
| `/library` | Resource Library — upload documents, ask questions with citations, scratchpad |
| `/quiz` | Practice sets — generate, work through and submit a set |
| `/arena` | Practice Arena — live 1v1 or vs-bot matches |
| `/mentor` | AI Mentor — feedback on wrong reasoning, cohort stats, video resources |
| `/revision` | Revision engine — spaced repetition queue and retention curves |
| `/practice` | Self-assessment with focus mode (full-page, no sidebar) |
| `/auth` | Sign in / register |

Older bookmark paths for the previous route names redirect to their current
equivalents, so old links keep working. All routes except `/auth` require a token
in `localStorage` and otherwise send you to `/auth`.

---

## Face-API Models

Focus mode runs face detection entirely in the browser, so the model weights must
be served from `public/models/`. The required files are already committed:

- `tiny_face_detector_model.bin` (+ manifest)
- `ssd_mobilenetv1_model.bin` (+ manifest)
- `face_landmark_68_model.bin` and `face_landmark_68_tiny_model.bin` (+ manifests)
- `face_expression_model.bin` (+ manifest)
- `face_recognition_model.bin` (+ manifest)
- `age_gender_model.bin` (+ manifest)

If they are ever missing, copy them from the installed package:

```powershell
Copy-Item node_modules\@vladmandic\face-api\model\* public\models\
```
