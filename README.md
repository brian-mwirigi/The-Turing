# The Turing-Complete Canvas

*A filmmaker died mid-edit of the only film she ever cared about. Her cutting room was left as it was. You don't watch it - you finish it.*

One streaming hallucination, one agent, one continuation model. The film stock is the file system.

---

## What it does

You walk in through a black title card. A 1974 cutting room rises on a curved projection surface that parallax-tracks your eye, the projector humming at floor level. No HUD. No chrome. The room is paused — the coffee is cold, the reels are still, the typewriter has the carriage mid-return on an unfinished line.

1. You click anything in the frame.
2. A lens-focus ring settles over the object. Florence-2 mapped it.
3. A thin slate strip prints onto the glass — the agent wrote your UI as if you were using the desk itself: splice deck, take control, note editor, grade desk, studio desk.
4. You pick an edit. The room extends the actual film from your choice. LTX-2.3 for rapid branching. Veo 3.1 reserved for the one moment she comes back.
5. Two seconds later the crossfade takes you to the consequence, the projector never breaking its drone.

The room remembers every grade you pick, every line you type, every frame you splice — that's the temporal-persistence-of-state thesis the playbook demands. The interface is the subject matter; there is no wrapper.

---

## Two modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **DEMO** | `FAL_KEY` unset | Mock detections mapped to cutting-room objects + pre-rendered mp4s from `public/canvas/` + deterministic slate catalog + an artificial latency pause to exercise the slow-mo mask. Fully offline. |
| **LIVE** | `FAL_KEY` set | Real Florence-2 detection on `fal-ai/florence-2-large/open-vocabulary-detection`. LLM-authored A2UI slates via fal's OpenRouter OpenAI-compatible proxy (`google/gemini-2.5-flash` by default). LTX-2.3 quality extend-video from the last ~2s of captured mp4. Veo 3.1 image-to-video reserved exclusively for the `summon_operator` hero beat (Imogen returns). All gracefully fall back to demo assets when any endpoint returns empty. |

---

## fal.ai integration

A single `FAL_KEY` opens the cutting room.

| Capability | Endpoint | See it |
|------------|----------|-------|
| Zero-shot detection | `fal-ai/florence-2-large/open-vocabulary-detection` | Click anything in the frame — Florence sends absolute-pixel bboxes + the server normalizes via `image.width/height` to the cutting-room seven-object map. |
| Video continuation | `fal-ai/ltx-2.3-quality/extend-video` | Your captured ~2s mp4 gets uploaded to `fal.storage.upload`, then extended forward (seam locked at `video_strength=1`). Every editing branch except summon_operator flows through this. |
| Hero moment | `fal-ai/veo3.1/fast/image-to-video` | The `summon_operator` action — a JPEG of the current frame seeds 8s of cinematic 4K character dialogue at 16:9. Fires exactly once per demo. |
| LLM | `https://fal.run/openrouter/router/openai/v1` | Two-step: (1) author a Zod-validated A2UI slate JSON for the clicked object in the register of a film-desk annotation, (2) rewrite the extend-video prompt so the next clip visibly reflects your edit. Falls back to the deterministic `SURFACE_CATALOG` in `orchestrator.ts` on any failure. |

---

## Creative bible

See `STORYLINE.md` for the full narrative: logline, characters, branch narrative, the object map, and the closing shot. The TL;DR:

- **Setting:** Cutting Room 7, 1974 — a Steenbeck flatbed, a Bolex on a tripod, a Royal typewriter with an unfinished line, a cold mug of coffee, a green-lit wall intercom, a long vertical light shaft, and a tall window onto a grey Pacific coast.
- **Object map (`public/canvas/scene_objects.json`):** seven clickable objects mapped to seven semantic roles.
- **Branches (stateful):** `taking` (boot, null hypothesis) → `splice` / `roll_take` / `cut_take` / `continue_page` / `sign_off` / `warm_grade` / `cold_grade` / `bleach_grade` / `page_studio` / `recover` / `burn` / `rewind` / `advance_clock` / `extend_establish` / `cutto_interior` → and one reserved Veo hero beat: `summon_operator`.
- **Closing:** the room still running, the reel still on the cut you left it, the title card returning inverted. *You did not watch this film. You kept it.*

---

## Demo assets (`public/canvas/`)

| File | Used as | Tracked? |
|------|---------|----------|
| `room_loop.mp4` / `room_seed.mp4` | ambient boot + LTX seed | yes |
| `intro.mp4` / `poster.jpg` | title / poster | yes |
| `voices/*.mp3` | pre-baked ghost VO stems | yes |
| `demo/session-log.jsonl` | fal usage audit (prompts, URLs, timings) | yes |
| `demo/*.mp4`, `demo/chain/` | generated pitch-reel / chain clips | **no** (gitignored — local only) |

---

## Project layout

```
src/
├─ app/
│  ├─ page.tsx                       # Mounts the sphere, reticle, & slate strip
│  └─ api/canvas/
│     ├─ orchestrate/route.ts        # Florence-2 + LLM slate
│     └─ generate/route.ts           # multipart (mp4+jpg) → extend-video or Veo hero
├─ components/canvas/
│  ├─ SphericalProjection.tsx        # Parallax-tracking projection surface
│  ├─ DoubleBufferedVideo.tsx        # Crossfade engine
│  ├─ BoundingBoxOverlay.tsx         # Cinemascope focus-ring reticle
│  ├─ A2UISurfaceRenderer.tsx        # Slate/subtitle strip (A2UI-faithful)
│  ├─ IntroOverlay.tsx               # Cinematic fade-in with aperture-ring invitation
│  └─ AmbientProjector.tsx           # Web Audio API 41/87 Hz low drone
├─ hooks/
│  └─ use-canvas-orchestrator.ts     # Frame + mp4 capture, POST orchestrator/generate
└─ lib/canvas/
   ├─ fal-client.ts                  # Florence-2 + extendVideo + Veo hero + storage upload
   ├─ llm-orchestrator.ts            # Two-step LLM (slate + rewrite), Zod-validated
   ├─ orchestrator.ts                # Geometry hit-test + slate catalog fallback
   ├─ store.ts                       # Zustand — buffers, branch, surfaces, slow-mo
   └─ types.ts                       # Core A2UI + detection + generation types
public/canvas/
   ├─ scene_objects.json             # Cutting-room object map + base prompt
   ├─ scene_main.mp4, branch_*.mp4   # Demo footage slots (swap with real assets)
   └─ poster.jpg
```

---

## Quick start

```bash
bun install                 # one dep list, one runtime
# (Add FAL_KEY to .env for live mode)
bun run dev                 # http://localhost:3000
bunx tsc --noEmit           # zero errors
bun run lint                # exit 0
bun run build
```

Without `FAL_KEY`, the app boots straight into DEMO mode and the full interaction loop is exercisable, including the slow-mo latency mask and the pre-rolled cutting-room footage.

---

## Environment

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `FAL_KEY` | for LIVE | — | Unlocks all fal.ai endpoints + the LLM proxy. |
| `FAL_LLM_MODEL` | no | `google/gemini-2.5-flash` | Any model served by the fal OpenRouter proxy. |
| `DATABASE_URL` | scaffold | `file:./dev.db` | Required by scaffold's Prisma; the canvas doesn't touch it. |

---

## Notes

- **Coordinate normalization lives on the server.** Florence-2 returns absolute-pixel bboxes + the processed `image.width/height`; the server normalizes so the client never guesses capture dimensions.
- **A real mp4 seeds extend-video.** The client captures ~2s via `MediaRecorder`, uploads the blob to `fal.storage`, and the server hands the hosted URL to extend-video — true video-to-video branching.
- **Graceful degradation everywhere.** LLM Zod failure → catalog slate. Empty video URL → demo branch mp4. No `FAL_KEY` → entire pipeline mocked but the spherical projection, drone, and interactive gesture all stay live.
- **Veo 3.1 fires exactly once per demo.** Restrained by design — reserve the most expensive shot for the most emotional beat. Demo mode reuses the splice clip so the curve still survives offline.
- The spherical parallax tilts ±4°/±16px on cursor drift. The ambient drone runs at 41 Hz with an 87 Hz harmonic, fading in over 1.2s; the projector never stops until the tab closes.
- **fal usage session log.** Batch generation / pitch-reel fal calls append to `public/canvas/demo/session-log.jsonl` (prompts, fal URLs, timings, success/fail). That log is tracked in git for audit / submission packs. Generated chain mp4s under `public/canvas/demo/` (and `demo/chain/`) are gitignored — regenerate locally with `bun run gen:demo`.

---

## Future work

- **Scene-tied TTS / VO.** Generate or stream voice lines as each scene/branch lands (not only pre-baked ElevenLabs stems), so new LTX/Veo continuations get matching ghost VO without a separate recording pass.
- **Dispatch agents.** Spin up verification agents that walk the click → detect → slate → generate loop end-to-end (and smoke-check fal endpoints / fallbacks) so regressions surface before a live pitch.