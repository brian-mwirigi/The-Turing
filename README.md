# The Turing-Complete Canvas

A generative video stream that behaves like a software interface. Click any
object in a hallucinated sci-fi server room → a contextual control panel
materializes over the video → the narrative branches into a new clip that
visibly reflects your action. Built for the **fal × Sequoia Developer Track**
hackathon as a working prototype of "batch size 1" spatial software.

> See [`PLAYBOOK.md`](./PLAYBOOK.md) for the full strategic + architectural
> thesis. This README documents the shipped implementation.

---

## What it does

A single continuous interaction loop:

1. **Boot** — a cinematic server-room scene streams via a double-buffered
   `<video>` pair that crossfades to feel like an infinite stream.
2. **Click** — the user clicks any object in the frame. Florence-2
   open-vocabulary detection maps every visible semantic object to a
   normalized bounding box; a hit-test picks the topmost bbox under the
   cursor.
3. **Surface** — an LLM (via fal's OpenRouter OpenAI-compatible proxy) authors
   an A2UI surface — a declarative JSON component tree — that the client
   renders as a translucent control panel anchored next to the object. The
   playback rate decelerates to 0.15× (slow-mo) so the upcoming video
   generation latency hides behind the user's reading time.
4. **Act** — the user picks a button in the surface. A second LLM call
   rewrites the cinematic continuation prompt to reflect the action (state
   persistence). The client captures the most recent ~2 s of the live video
   as an mp4 via `MediaRecorder`, uploads it to fal storage, and:
   - for most actions → **LTX-2.3 quality extend-video** generates a true
     video→video continuation that locks its seam to the source clip;
   - for `summon_operator` → **Veo 3.1 fast image-to-video** generates an 8 s
     16:9 cinematic hero beat from a JPEG frame.
5. **Crossfade** — the generated chunk replaces the primary buffer and the
   video seamlessly returns to normal speed.

---

## Two modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **DEMO** | `FAL_KEY` unset | Florence-2 returns mock detections matching `public/canvas/scene_objects.json`; video branching serves the pre-rendered procedural mp4s in `public/canvas/`; A2UI surfaces come from the deterministic `SURFACE_CATALOG`; a small artificial delay exercises the slow-mo mask. Fully offline. |
| **LIVE** | `FAL_KEY` set | Real Florence-2 detection, LLM-authored A2UI surfaces, LTX-2.3 extend-video from captured mp4, Veo 3.1 hero moments. |

Live mode still gracefully degrades to demo assets whenever a fal call fails
or returns an empty URL — useful at the presentation venue where Wi-Fi or
rate-limits may bite.

---

## fal.ai integration

A single `FAL_KEY` unlocks everything. Three production endpoints, one
OpenRouter LLM proxy:

| Capability | Endpoint | Used for |
|------------|----------|----------|
| Zero-shot detection | `fal-ai/florence-2-large/open-vocabulary-detection` | Per-click object→bbox mapping. Output bboxes are absolute px; the server normalizes via the response's `image.width/height`. |
| Video continuation | `fal-ai/ltx-2.3-quality/extend-video` | True video→video branching. `extend_direction: forward`, `video_strength: 1` locks the seam. Inputs: an mp4 uploaded via `fal.storage.upload` + an LLM-rewritten prompt. |
| Hero moments | `fal-ai/veo3.1/fast/image-to-video` | 8 s 16:9 cinematic operator-arrival beat for the `summon_operator` action. Seed is a JPEG capture of the current frame. |
| LLM | `https://fal.run/openrouter/router/openai/v1` (`Authorization: Key ${FAL_KEY}`) | Two-step orchestration: A2UI surface JSON generation + extend-video prompt rewrite. Default model `google/gemini-2.5-flash`. |

### Two-step LLM pipeline

1. **Surface generation** — given the clicked object + current branch, the
   LLM emits a Zod-validated A2UI surface JSON (panel/header/text/metric/
   button/toggle/alert/divider/code). On any failure the deterministic
   `SURFACE_CATALOG` in `orchestrator.ts` supplies the fallback panel.
2. **Prompt rewrite** — given the chosen action + current branch, the LLM
   emits `{ branch, promptSuffix }` describing the visible cinematic
   continuation. Falls back to `planBranchForAction` (which includes the
   `summon_operator → veo31` hero).

---

## Project layout

```
src/
├─ app/
│  ├─ page.tsx                          # Boot, overlay layering, surface mount
│  └─ api/canvas/
│     ├─ orchestrate/route.ts           # POST frame+click → Florence-2 + LLM surface
│     └─ generate/route.ts              # multipart (mp4+jpg) → extend-video or Veo hero
├─ components/canvas/
│  ├─ DoubleBufferedVideo.tsx           # Primary/secondary crossfade engine
│  ├─ BoundingBoxOverlay.tsx            # Invisible clickable layer + hover reticle
│  ├─ A2UISurfaceRenderer.tsx           # A2UI JSON → React (faithful op-model)
│  ├─ HUDOverlay.tsx                    # Telemetry, action log, mode badge
│  └─ IntroOverlay.tsx                  # First-15s hook + boot button
├─ hooks/
│  └─ use-canvas-orchestrator.ts        # Frame capture (jpg), clip capture (mp4), 2 endpoints
└─ lib/canvas/
   ├─ fal-client.ts                     # Florence-2 + extendVideo + Veo hero + storage upload
   ├─ llm-orchestrator.ts               # Two-step LLM (surface + rewrite) w/ Zod
   ├─ orchestrator.ts                   # Geometry + deterministic catalog fallback
   ├─ store.ts                          # Zustand: buffers, branch, surfaces, slow-mo
   └─ types.ts                          # A2UI / detection / generation types

public/canvas/
├─ scene_main.mp4 + branch_*.mp4        # Procedural demo assets (fallback)
└─ scene_objects.json                   # Demo detections (fallback)

scripts/generate_demo_assets.py         # Procedural mp4 generator (offline fallback only)
.env.example                            # FAL_KEY + FAL_LLM_MODEL docs
```

---

## Quick start

```bash
# 1. Install
bun install

# 2. (Optional) enable live mode
cp .env.example .env
#  edit .env and paste your fal.ai key into FAL_KEY

# 3. Run
bun run dev          # http://localhost:3000

# 4. Lint / typecheck / build
bun run lint
bunx tsc --noEmit
bun run build
```

Without `FAL_KEY`, the app boots straight into DEMO mode and the full
interaction loop is exercisable on the procedural assets.

---

## Interaction map (developer reference)

| User action | Server branch | Server path |
|-------------|---------------|-------------|
| Click anywhere (no bbox) | — | `clear` A2UI op |
| Click `faulty_asset` (rack) | `alert` | panel → reboot / trigger_alert / isolate buttons |
| Click `operator_interface` | `neutral` | panel → continue / standby / (summon_operator if LLM emits it) |
| Click `hvac_component` | `neutral` | panel → lower_temp / boost_fan |
| Click `security_node` | `alert` | panel → lockdown / review_logs |
| Action `summon_operator` | `veo31` | Veo 3.1 image-to-video, 8s 16:9 720p, JPEG seed |
| Any other action | LLM-chosen | LTX-2.3 extend-video, mp4 seed + rewritten prompt |

The `summon_operator` action (operator arrives in frame, hero beat) is the
flagship demonstration of the Veo 3.1 premium-tier contrast against LTX's
rapid environmental branching — the centerpiece of the "Turing-Complete
Canvas as OS" narrative for judge day.

---

## Key implementation notes

- **Coordinate normalization lives on the server.** Florence-2 returns
  bboxes as absolute pixels plus the processed `image.width/height`; we
  normalize there so the client never has to guess the capture dims.
- **A real mp4 (not a JPEG) seeds LTX extend-video.** The client captures
  ~2 s of the live `<video>` via `MediaRecorder` and uploads the blob to
  fal storage; the server hands the hosted URL to extend-video. This is
  the truest implementation of the PLAYBOOK's video→video branching.
- **`video_strength: 1` + `num_context_frames: 17`** lock the LTX seam to
  the source for a visually continuous crossfade; the double-buffered
  frontend then transitions between chunks over 0.45 s.
- **Graceful degradation everywhere.** LLM schema-validation failure →
  catalog surface. Empty video URL → demo branch mp4. No `FAL_KEY` →
  entire pipeline mocked but fully interactive.
- **Latency as a cinematic feature.** On click, playback drops to 0.15×
  (slow-mo) so the A2UI panel reads during the seconds-long generation
  call; on commit, playback snaps back to 1.0×.

---

## Environment

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `FAL_KEY` | for LIVE mode | — | Unlocks Florence-2, LTX-2.3, Veo 3.1, fal storage, and the LLM proxy. |
| `FAL_LLM_MODEL` | no | `google/gemini-2.5-flash` | Any model served by the fal OpenRouter proxy. |
| `DATABASE_URL` | scaffold only | `file:./dev.db` | Required by the scaffold's Prisma schema; the canvas itself does not touch it. |

---

## Credits & disclaimers

Built atop the fal platform for the fal × Sequoia Developer Track
hackathon. Procedural demo assets generated via
`scripts/generate_demo_assets.py`. The shipped app is the rebuilt,
production-wiring of the original architectural sketch in `PLAYBOOK.md`;
all fal calls use live, documented endpoints with deterministic fallback
so the demo never crashes on stage.
