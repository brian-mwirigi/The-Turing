# The Turing-Complete Canvas

*A filmmaker died mid-edit of the only film she ever cared about. Her cutting room was left as it was. Your job is to finish it.*

One streaming hallucination, one agent, one continuation model. The film stock is the file system.

---

## What it does

You walk in through a black title card. A 1974 cutting room fills the frame on a slight diorama tilt, the projector humming at floor level. No HUD. No chrome. The room is paused — the coffee is cold, the reels are still, the typewriter has the carriage mid-return on an unfinished line.

1. You click anything in the frame.
2. A lens-focus ring settles over the object. Florence-2 mapped it.
3. A thin slate strip prints onto the glass — the agent wrote your UI as if you were using the desk itself: splice deck, take control, note editor, grade desk, studio desk.
4. You pick an edit. The room extends the actual film from your choice. LTX-2.3 for rapid branching. Veo 3.1 reserved for the one moment she comes back.
5. Two seconds later the crossfade takes you to the consequence, the projector never breaking its drone.

The room remembers every grade you pick, every line you type, every frame you splice. The interface is the subject matter; there is no wrapper.

---

## The demo film (what you will see)

A short cut of the pitch reel — four beats, one continuous room, no menu chrome:

1. **Burn.** On the Steenbeck, the leader catches. A thin grey wisp. Ghost VO: *She burned three reels the week before she died. Never said why.*
2. **Recover.** A double-exposed ghost folds through the same desk and resolves. *Salvaged. Barely.*
3. **Summon.** The door opens. Imogen walks in — Veo lip-sync owns the line: *You burned the leader. You let it sit cold. And still you came back.*
4. **Cut.** The Bolex lens cap snaps shut. The room freezes. The film ends the way film ends.

You do not watch a trailer. You click the desk that made it.

---

## Live architecture

With `FAL_KEY` set: real Florence-2 detection on `fal-ai/florence-2-large/open-vocabulary-detection`. LLM-authored A2UI slates via fal's OpenRouter OpenAI-compatible proxy (`google/gemini-2.5-flash` by default). LTX-2.3 quality extend-video seeded from `public/canvas/room_seed.mp4` (true video→video continuation). Veo 3.1 image-to-video reserved exclusively for the `summon_operator` hero beat (Imogen returns).

---

## fal.ai integration

A single `FAL_KEY` opens the cutting room.

| Capability | Endpoint | See it |
|------------|----------|-------|
| Zero-shot detection | `fal-ai/florence-2-large/open-vocabulary-detection` | Click anything in the frame — Florence sends absolute-pixel bboxes + the server normalizes via `image.width/height` to the cutting-room seven-object map. |
| Video continuation | `fal-ai/ltx-2.3-quality/extend-video` | Server uploads `room_seed.mp4` (or the warmed fal.storage URL) and extends forward. Every editing branch except summon_operator flows through this. |
| Hero moment | `fal-ai/veo3.1/image-to-video` | The `summon_operator` action — a JPEG still of the current frame seeds 8s of cinematic character dialogue at 16:9. Fires exactly once per demo. |
| LLM | `https://fal.run/openrouter/router/openai/v1` | Two-step: (1) author a Zod-validated A2UI slate JSON for the clicked object in the register of a film-desk annotation, (2) rewrite the extend-video prompt so the next clip visibly reflects your edit. Falls back to the deterministic `SURFACE_CATALOG` in `orchestrator.ts` on any failure. |

### fal session logs

Batch generation / pitch-reel runs append prompts, fal media URLs, timings, and success/fail to a JSONL audit trail:

- **In-repo path:** [`public/canvas/demo/session-log.jsonl`](./public/canvas/demo/session-log.jsonl)
- **On GitHub:** [blob view](https://github.com/brian-mwirigi/The-Turing/blob/main/public/canvas/demo/session-log.jsonl) · [raw](https://raw.githubusercontent.com/brian-mwirigi/The-Turing/main/public/canvas/demo/session-log.jsonl)

Generated chain mp4s under `public/canvas/demo/` (and `demo/chain/`) stay gitignored — regenerate locally with `bun run gen:demo`.

---

## Creative bible (TL;DR)

- **Setting:** Cutting Room 7, 1974 — a Steenbeck flatbed, a Bolex on a tripod, a Royal typewriter with an unfinished line, a cold mug of coffee, a green-lit wall intercom, a long vertical light shaft, and a tall window onto a grey Pacific coast.
- **Object map (`public/canvas/scene_objects.json`):** seven clickable objects mapped to seven semantic roles.
- **Branches (stateful):** `taking` → `splice` / `roll_take` / `cut_take` / `continue_page` / `sign_off` / `warm_grade` / `cold_grade` / `bleach_grade` / `page_studio` / `recover` / `burn` / `rewind` / `advance_clock` / `extend_establish` / `cutto_interior` → and one reserved Veo hero beat: `summon_operator`.
- **Closing:** the room still running, the reel still on the cut you left it. *You did not watch this film. You kept it.*

---

## Demo assets (`public/canvas/`)

| File | Used as | Tracked? |
|------|---------|----------|
| `room_loop.mp4` / `room_seed.mp4` | ambient boot + LTX seed | yes |
| `intro.mp4` / `poster.jpg` | title / poster | yes |
| `voices/*.mp3` | pre-baked ghost VO stems | yes |
| [`demo/session-log.jsonl`](./public/canvas/demo/session-log.jsonl) | fal usage audit (prompts, URLs, timings) | yes |
| `demo/*.mp4`, `demo/chain/` | generated pitch-reel / chain clips | **no** (gitignored — local only) |

---

## Project layout

```
src/
├─ app/
│  ├─ page.tsx                       # Mounts diorama, reticle, & slate strip
│  └─ api/canvas/
│     ├─ orchestrate/route.ts        # Florence-2 + LLM slate
│     ├─ generate/route.ts           # multipart (mp4+jpg) → extend-video or Veo hero
│     └─ seed/route.ts               # warm fal.storage room seed
├─ components/canvas/
│  ├─ FilmGate.tsx                   # Double-buffered crossfade player
│  ├─ FilmSlate.tsx                  # A2UI slate strip
│  ├─ RiverReticle.tsx               # Focus-ring reticle
│  └─ TitlePlate.tsx / Diorama.tsx   # Intro + projection surface
├─ hooks/
│  └─ use-canvas-orchestrator.ts     # Frame capture, POST orchestrator/generate
└─ lib/canvas/
   ├─ fal-client.ts                  # Florence-2 + extendVideo + Veo hero + storage upload
   ├─ llm-orchestrator.ts            # Two-step LLM (slate + rewrite), Zod-validated
   ├─ orchestrator.ts                # Geometry hit-test + slate catalog fallback
   ├─ store.ts                       # Zustand — buffers, branch, surfaces, slow-mo
   └─ types.ts                       # Core A2UI + detection + generation types
public/canvas/
   ├─ scene_objects.json             # Cutting-room object map + base prompt
   ├─ room_loop.mp4 / room_seed.mp4  # Ambient + LTX seed
   ├─ demo/session-log.jsonl         # fal usage audit (tracked)
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

Add `FAL_KEY` to `.env`, then open `http://localhost:3000`.

---

## Environment

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `FAL_KEY` | for LIVE | — | Unlocks all fal.ai endpoints + the LLM proxy. |
| `FAL_LLM_MODEL` | no | `google/gemini-2.5-flash` | Any model served by the fal OpenRouter proxy. |
| `FAL_CHEAP` | no | unset | Credit saver — mock detect, short LTX, skip Veo/rewrite. Keep off for pitch. |
| `DATABASE_URL` | scaffold | `file:./dev.db` | Required by scaffold's Prisma; the canvas doesn't touch it. |

---

## Notes

- **Coordinate normalization lives on the server.** Florence-2 returns absolute-pixel bboxes + the processed `image.width/height`; the server normalizes so the client never guesses capture dimensions.
- **LTX seeds from `room_seed.mp4`.** The server uploads the baked ambient seed to `fal.storage` and extends it — true video-to-video branching without relying on short MediaRecorder captures.
- **Graceful degradation everywhere.** LLM Zod failure → catalog slate. Empty video URL → `room_loop.mp4`. Florence failure → mock cutting-room hotspots so clicks still open a slate.
- **Veo 3.1 fires exactly once per demo.** Restrained by design — reserve the most expensive shot for the most emotional beat.
- **Known limitation (frame capture after remote cuts).** `FilmGate` prefers CORS-fetch → `blob:` rehost so canvas capture stays clean. If fal CDN blocks that fetch, playback still works but `drawImage` can taint; Florence then falls back to mocks and Veo may lack a fresh still. We have not treated this as a live refactor target — LTX clicks stay reliable via `room_seed`; prefer summon early or after a clean ambient frame if you notice it.
- The diorama tilts slightly with cursor drift. The ambient drone runs at 41 Hz with an 87 Hz harmonic; the projector never stops until the tab closes.

---

## Future work

- **Scene-tied TTS / VO.** Generate or stream voice lines as each scene/branch lands (not only pre-baked ElevenLabs stems), so new LTX/Veo continuations get matching ghost VO without a separate recording pass.
- **Dispatch agents.** Spin up verification agents that walk the click → detect → slate → generate loop end-to-end (and smoke-check fal endpoints / fallbacks) so regressions surface before a live pitch.
