# The Turing-Complete Canvas

Most generative video demos hand you a finished painting and ask you to watch.

This one hands you the brush.

A hallucinated sci-fi server room streams like an infinite film. Click a rack,
a console, a sparking node — and the frame stops being footage. A control panel
materializes over the object. You choose. The next clip is generated to make
your choice *visible*: sparks die, lights flood red, an operator walks into
frame. Video stops being an MP4. It becomes a spatial operating system.

Built for the **fal × Sequoia Developer Track** as a working prototype of
batch-size-1 software — interfaces that exist only for the intent you just had.

> Full strategic thesis: [`PLAYBOOK.md`](./PLAYBOOK.md)

---

## The loop

One interaction. No menus. No dashboard.

1. **Boot** — a cinematic server room streams through a double-buffered
   `<video>` pair that crossfades into what feels like infinite playback.
2. **Click** — Florence-2 maps every semantic object in the frame to a
   normalized bounding box. A hit-test finds what you meant.
3. **Surface** — an LLM authors an A2UI panel (declarative JSON → real UI)
   anchored to that object. Playback drops to 0.15×. Latency becomes slow-mo.
4. **Act** — you press a control. A second LLM rewrite stamps your action into
   the continuation prompt. The client grabs ~2s of live video via
   `MediaRecorder` and:
   - most actions → **LTX-2.3 extend-video** (true video→video branch)
   - `summon_operator` → **Veo 3.1** (8s cinematic hero beat from a still)
5. **Crossfade** — the new chunk takes the primary buffer. Speed snaps back.
   The world you chose is now the world you see.

---

## Two modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **DEMO** | `FAL_KEY` unset | Mock detections, procedural mp4s, catalog surfaces. Fully offline. |
| **LIVE** | `FAL_KEY` set | Real Florence-2, LLM surfaces, LTX extend-video, Veo 3.1 heroes. |

Live still falls back to demo assets if a fal call fails — so a venue Wi-Fi
outage cannot kill the pitch.

---

## Quick start

```bash
bun install

cp .env.example .env   # optional: set FAL_KEY for LIVE mode

bun run dev            # http://localhost:3000
```

No key? You still get the full click → panel → branch loop on procedural
assets. The brush works either way.

---

## fal.ai stack

One key. Four capabilities.

| Capability | Endpoint | Role |
|------------|----------|------|
| Detection | `fal-ai/florence-2-large/open-vocabulary-detection` | Click → object → bbox |
| Continuation | `fal-ai/ltx-2.3-quality/extend-video` | Video→video branch, seam locked |
| Hero | `fal-ai/veo3.1/fast/image-to-video` | Operator arrival, 8s 16:9 |
| LLM | fal OpenRouter (`Authorization: Key ${FAL_KEY}`) | A2UI JSON + prompt rewrite |

**LLM step 1 — surface.** Object + branch → Zod-validated A2UI tree. Fail →
`SURFACE_CATALOG` fallback.

**LLM step 2 — persistence.** Action + branch → `{ branch, promptSuffix }` so
the next clip *shows* what you did. Fail → `planBranchForAction`.

---

## Project layout

```
src/
├─ app/
│  ├─ page.tsx                          # Boot, overlays, surface mount
│  └─ api/canvas/
│     ├─ orchestrate/route.ts           # frame+click → Florence-2 + LLM surface
│     └─ generate/route.ts              # mp4+jpg → extend-video or Veo hero
├─ components/canvas/
│  ├─ DoubleBufferedVideo.tsx           # Crossfade engine
│  ├─ BoundingBoxOverlay.tsx            # Click layer + hover reticle
│  ├─ A2UISurfaceRenderer.tsx           # A2UI JSON → React
│  ├─ HUDOverlay.tsx                    # Telemetry / mode badge
│  └─ IntroOverlay.tsx                  # First-15s hook
├─ hooks/
│  └─ use-canvas-orchestrator.ts        # Frame + clip capture, both endpoints
└─ lib/canvas/
   ├─ fal-client.ts                     # Florence-2, extend, Veo, upload
   ├─ llm-orchestrator.ts               # Two-step LLM + Zod
   ├─ orchestrator.ts                   # Geometry + catalog fallback
   ├─ store.ts                          # Buffers, branch, slow-mo
   └─ types.ts

public/canvas/                          # Demo mp4s + scene_objects.json
scripts/generate_demo_assets.py         # Offline procedural generator
```

---

## Interaction map

| User action | Branch | Path |
|-------------|--------|------|
| Click empty space | — | `clear` A2UI op |
| Click `faulty_asset` | `alert` | reboot / trigger_alert / isolate |
| Click `operator_interface` | `neutral` | continue / standby / summon_operator |
| Click `hvac_component` | `neutral` | lower_temp / boost_fan |
| Click `security_node` | `alert` | lockdown / review_logs |
| Action `summon_operator` | `veo31` | Veo 3.1 hero, JPEG seed |
| Any other action | LLM-chosen | LTX-2.3 extend-video, mp4 seed |

`summon_operator` is the flagship contrast: LTX for rapid environmental
branching, Veo for the irreplaceable human beat. That gap *is* the demo.

---

## Implementation notes

- **Normalize on the server.** Florence-2 returns absolute px + image dims;
  the client never guesses capture size.
- **Seed LTX with real mp4, not a JPEG.** ~2s `MediaRecorder` capture → fal
  storage → extend-video. Video→video, as the playbook demands.
- **`video_strength: 1` + `num_context_frames: 17`** lock the seam; the
  frontend crossfades over 0.45s.
- **Degrade everywhere.** Bad LLM JSON → catalog. Empty URL → demo mp4.
  No key → full interactive mock.
- **Latency is cinema.** Click → 0.15×. Commit → 1.0×. The wait is the beat.

---

## Environment

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `FAL_KEY` | LIVE mode | — | Florence-2, LTX, Veo, storage, LLM |
| `FAL_LLM_MODEL` | no | `google/gemini-2.5-flash` | OpenRouter model via fal |
| `DATABASE_URL` | scaffold only | `file:./dev.db` | Prisma leftover; canvas ignores it |

---

## Credits

Built on fal for the fal × Sequoia Developer Track. Demo assets from
`scripts/generate_demo_assets.py`. Architecture from `PLAYBOOK.md`. Every live
call has a deterministic fallback so the stage never goes black.

---

Everyone else is shipping a painting.

We're giving you the brush — and asking you to paint.
