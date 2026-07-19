/**
 * gen-room.ts — generate the FilmGate ambient room loop via fal (once).
 *
 * Output: public/canvas/room_loop.mp4
 * Also trims a short room_seed.mp4 (≥73 frames) for LTX extend-video.
 *
 * Usage:
 *   bun run gen:room
 *
 * Requires FAL_KEY.
 */

import { fal } from "@fal-ai/client";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
const MODEL = process.env.FAL_ROOM_MODEL || "fal-ai/ltx-2.3-quality/text-to-video";
const STORAGE_DIR = path.join(process.cwd(), "public", "canvas");
const FPS = 24;
const NUM_FRAMES = 241; // ~10s @ 24fps (8k+1)

const PROMPT =
  "16mm cutting room, 1974. Long vertical shaft of afternoon light from a high window, " +
  "dust drifting slowly through the beam. A Steenbeck flatbed film editor on a wooden desk, " +
  "two reels still. A Bolex H16 on a tripod, lens cap off. A Royal typewriter with a half-finished " +
  "page. A cold mug of coffee. A green-illuminated wall intercom. A tall narrow window onto a grey " +
  "Pacific coast at low tide. Camera locked, gentle ambient drift only, no people, no hard cuts. " +
  "Cinematic, 16mm grain, anamorphic flare, warm amber grade.";

async function run() {
  if (!FAL_KEY) {
    console.error("[gen:room] FAL_KEY required.");
    process.exit(1);
  }
  fal.config({ credentials: FAL_KEY });
  await mkdir(STORAGE_DIR, { recursive: true });
  console.log(`[gen:room] model: ${MODEL}`);
  console.log(`[gen:room] submitting room_loop.mp4 (${NUM_FRAMES} frames ≈ ${(NUM_FRAMES / FPS).toFixed(1)}s)…`);

  const raw = await fal.subscribe(MODEL, {
    input: {
      prompt: PROMPT,
      num_frames: NUM_FRAMES,
      resolution: "landscape_16_9",
      frames_per_second: FPS,
      num_inference_steps: Number(process.env.FAL_ROOM_STEPS ?? 20),
      generate_audio: false,
      enable_prompt_expansion: true,
      video_quality: "high",
      negative_prompt:
        "people, faces, figures, fast motion, camera moves, zoom, pan, tilt, text, watermark",
    },
    logs: true,
  });

  const data =
    (raw as { data?: { video?: { url?: string } } }).data ??
    (raw as { video?: { url?: string } });
  const url = data?.video?.url;
  if (!url) {
    console.error("[gen:room] no video returned");
    process.exit(1);
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`[gen:room] download failed: HTTP ${resp.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(new Uint8Array(await resp.arrayBuffer()));
  const loopPath = path.join(STORAGE_DIR, "room_loop.mp4");
  if (existsSync(loopPath)) await rm(loopPath, { force: true });
  await writeFile(loopPath, buf);
  console.log(`[gen:room] wrote ${loopPath} (${(buf.length / 1024).toFixed(0)} KiB)`);

  // Short seed for LTX extend (≥73 frames).
  const seedPath = path.join(STORAGE_DIR, "room_seed.mp4");
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      loopPath,
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      seedPath,
    ]);
    console.log(`[gen:room] wrote ${seedPath}`);
  } catch (err) {
    console.warn("[gen:room] ffmpeg seed trim failed — keep existing room_seed if any:", err);
  }

  console.log("[gen:room] done");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
