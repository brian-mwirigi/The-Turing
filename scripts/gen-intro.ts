/**
 * gen-intro.ts — generate the TitlePlate *landing background* via fal.
 *
 * This is NOT a separate "intro film" that plays before the desk loads.
 * The TitlePlate plays `/canvas/intro.mp4` muted + looped BEHIND the title
 * typography — a background plate, occupying the same slot poster.jpg
 * would otherwise fill. On click, the whole TitlePlate fades away and
 * boots the live Diorama/FilmGate. So this script just seeds that plate.
 *
 * Default: fal-ai/ltx-2.3-quality/text-to-video (fast, ~6s, environmentally
 * still — exactly what a "room waiting" background wants).
 * Override: set GEN_INTRO_MODEL=fal-ai/veo3.1/fast/text-to-video for a slow
 * push-in with native audio (longer + pricier).
 *
 * Output: public/canvas/intro.mp4 (overwrites any prior intro).
 *
 * Usage (from repo root):
 *   bun run gen:intro
 *   GEN_INTRO_MODEL=fal-ai/veo3.1/fast/text-to-video bun run gen:intro
 *
 * Requires FAL_KEY in the environment.
 */

import { fal } from "@fal-ai/client";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
const MODEL = process.env.GEN_INTRO_MODEL || "fal-ai/ltx-2.3-quality/text-to-video";

const OUT_DIR = path.join(process.cwd(), "public", "canvas");
const OUT_FILE = path.join(OUT_DIR, "intro.mp4");

// The intro background is the same room the runtime serves as the booted
// frame — same world as the cutting room we'd branch into. This prompt is
// identical to scene_objects.json's base_prompt, so when the title plate
// crossfades into the live diorama the seam is invisible.
const PROMPT =
  "16mm cutting room, 1974, long vertical light shaft from a high window, " +
  "dust drifting slowly through the beam, a Steenbeck flatbed film editor on " +
  "a wooden desk, sleeves of 16mm film hanging from the ceiling, a Royal " +
  "typewriter with a half-finished page, a cold mug of coffee, a green-" +
  "illuminated wall intercom, a Bolex on a tripod in the corner with the " +
  "lens cap off, window onto a grey Pacific coast, everything paused and " +
  "waiting, cinematic, 24fps, organic grain, anamorphic flare, no people, " +
  "ambient hum";

interface GenResult {
  video?: { url?: string } | null;
}

async function run() {
  if (!FAL_KEY) {
    console.error("[gen:intro] FAL_KEY is required.");
    console.error("Add it to .env (see .env.example), or pass it inline:");
    console.error("  FAL_KEY=fk_xxx bun run gen:intro");
    process.exit(1);
  }

  fal.config({ credentials: FAL_KEY });

  console.log(`[gen:intro] submitting to ${MODEL}…`);
  const input: Record<string, unknown> = { prompt: PROMPT };
  // LTX-2.3-quality text-to-video params (kept conservative for cost + the
  // quiet aesthetic). Override via GEN_INTRO_* envs if you want to tune.
  if (MODEL.includes("ltx")) {
    input.aspect_ratio = "16:9";
    input.resolution = "720p";
    input.duration = String(process.env.GEN_INTRO_DURATION ?? "6s");
    input.frames_per_second = Number(process.env.GEN_INTRO_FPS ?? 24);
    input.negative_prompt =
      process.env.GEN_INTRO_NEG ?? "people, faces, motion blur, text, watermark, hud, ui";
    input.num_inference_steps = Number(process.env.GEN_INTRO_STEPS ?? 30);
    input.generate_audio = String(process.env.GEN_INTRO_AUDIO ?? "true").toLowerCase() === "true";
  } else if (MODEL.includes("veo")) {
    input.duration = String(process.env.GEN_INTRO_DURATION ?? "8s");
    input.aspect_ratio = "16:9";
    input.resolution = process.env.GEN_INTRO_RESOLUTION ?? "720p";
    input.generate_audio = String(process.env.GEN_INTRO_AUDIO ?? "true").toLowerCase() === "true";
  }

  let result: GenResult;
  try {
    result = (await fal.subscribe(MODEL, { input, logs: false })) as GenResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gen:intro] fal subscribe failed: ${msg}`);
    process.exit(1);
  }

  const url = result?.video?.url;
  if (!url) {
    console.error("[gen:intro] fal returned no video URL.");
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(`[gen:intro] generated: ${url}`);

  await mkdir(OUT_DIR, { recursive: true });

  console.log("[gen:intro] downloading to public/canvas/intro.mp4…");
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`[gen:intro] download failed: HTTP ${resp.status}`);
    process.exit(1);
  }
  const blob = await resp.blob();
  const buf = Buffer.from(await blob.arrayBuffer());

  if (existsSync(OUT_FILE)) await rm(OUT_FILE, { force: true });
  await writeFile(OUT_FILE, buf);
  console.log(`[gen:intro] wrote ${OUT_FILE} (${(buf.length / 1024).toFixed(0)} KiB)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
