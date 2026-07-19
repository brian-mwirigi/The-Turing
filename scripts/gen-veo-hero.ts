/**
 * gen-veo-hero.ts — pre-roll the `summon_operator` hero beat once.
 *
 * The single Veo 3.1 character beat reserved for the demo. 8s of Imogen
 * walking in, setting her mug down where the cold coffee was, and addressing
 * the inheritor on camera. 30–90s wall-time to generate, $0.05–$0.50 — but
 * it is the one shot where every eye in the room is on the seam, so we
 * pre-roll it once and ship the file. The orchestrator returns this URL
 * when `FAL_USE_PREROLL=1` (default) for summon_operator, so demo day
 * never touches the live Veo endpoint.
 *
 * Output:
 *   public/canvas/breath_hero.mp4         (local copy, used as fallback seed)
 *   public/canvas/veo_hero_preroll.json    { url, prompt, durationSec, generatedAt,
 *                                            seedImage: optional local path }
 *
 * Usage:
 *   bun run gen:veo-hero
 *
 * If you want the seed image to match a specific frame at boot (so the
 * hero beat continues exactly from where the click happened), set
 *   HERO_SEED_FRAME=path/to/frame.jpg
 * otherwise Veo is given the textual hero prompt only.
 *
 * Requires FAL_KEY.
 */

import { fal } from "@fal-ai/client";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { VEO_HERO_PROMPT } from "../src/lib/canvas/extend-prompts";

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
const MODEL = "fal-ai/veo3.1/fast/image-to-video";
const STORAGE_DIR = path.join(process.cwd(), "public", "canvas");
const HERO_FILE = path.join(STORAGE_DIR, "breath_hero.mp4");
const PREROLL_JSON = path.join(STORAGE_DIR, "veo_hero_preroll.json");

/** Keep in sync with canvas pitch hero — path-earned dialogue, not "the room chose you." */
const HERO_PROMPT = VEO_HERO_PROMPT;

// Boot frame reference image (used as seed image-to-video if provided).
const DEFAULT_SEED_FRAME = path.join(STORAGE_DIR, "poster.jpg");

interface GenResult {
  video?: { url?: string } | null;
}

async function run() {
  if (!FAL_KEY) {
    console.error("[gen:veo-hero] FAL_KEY required.");
    process.exit(1);
  }
  fal.config({ credentials: FAL_KEY });
  await mkdir(STORAGE_DIR, { recursive: true });

  // Seed image: prefer HERO_SEED_FRAME if set & exists, fall back to poster.jpg.
  const seedFrameArg = process.env.HERO_SEED_FRAME;
  const seedFrame = seedFrameArg && existsSync(seedFrameArg)
    ? seedFrameArg
    : existsSync(DEFAULT_SEED_FRAME)
      ? DEFAULT_SEED_FRAME
      : null;

  if (!seedFrame) {
    console.warn("[gen:veo-hero] no seed frame available — using text-to-video semantics (image_url omitted).");
  } else {
    console.log(`[gen:veo-hero] seeding from ${seedFrame}`);
  }

  // If the fal image_input must be a hosted URL, upload the seed to fal.storage.
  // (Veo's image-to-video accepts both a URL and a base64 data URI.)
  let imageUrl: string | undefined;
  if (seedFrame) {
    try {
      const buf = await readFile(seedFrame);
      const file = new File([buf], path.basename(seedFrame), { type: "image/jpeg" });
      imageUrl = await fal.storage.upload(file);
      console.log(`[gen:veo-hero] seed uploaded → ${imageUrl.slice(0, 80)}…`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gen:veo-hero] upload failed (${msg}); continuing without a seed.`);
    }
  }

  const input: Record<string, unknown> = {
    prompt: HERO_PROMPT,
    duration: "8s",
    aspect_ratio: "16:9",
    resolution: "720p",
    generate_audio: true,
  };
  if (imageUrl) input.image_url = imageUrl;

  console.log(`[gen:veo-hero] submitting to ${MODEL} (image-to-video: ${imageUrl ? "yes" : "no"})…`);
  let result: GenResult;
  try {
    result = (await fal.subscribe(MODEL, { input, logs: false })) as GenResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[gen:veo-hero] Veo subscribe failed: ${msg}`);
    process.exit(1);
  }

  const url = result?.video?.url;
  if (!url) {
    console.error("[gen:veo-hero] no video returned.");
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  console.log(`[gen:veo-hero] generated: ${url}`);

  // Persist the URL into a small JSON. The orchestrator reads this on
  // summon_operator when FAL_USE_PREROLL=1 (default), bypassing live Veo.
  const payload = {
    url,
    prompt: HERO_PROMPT,
    durationSec: 8,
    duration: "8s",
    branch: "summon_operator",
    source: "veo31",
    seedImage: seedFrame ?? null,
    generatedAt: new Date().toISOString(),
    model: MODEL,
  };

  // Also download a local copy as backup. The orchestrator prefers the
  // hosted URL because crossorigin/canvas-capture requires same-origin, but
  // if the URL goes 404 the local file is what we fall back to.
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const buf = Buffer.from(await resp.blob().then((b) => b.arrayBuffer()));
      if (existsSync(HERO_FILE)) await rm(HERO_FILE, { force: true });
      await writeFile(HERO_FILE, buf);
      payload.url = `/canvas/${path.basename(HERO_FILE)}`; // prefer same-origin local file
      console.log(`[gen:veo-hero] local copy written: ${HERO_FILE} (${(buf.length / 1024).toFixed(0)} KiB)`);
    } else {
      console.warn(`[gen:veo-hero] local download returned ${resp.status}; keeping hosted URL`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[gen:veo-hero] local download failed (${msg}); keeping hosted URL`);
  }

  if (existsSync(PREROLL_JSON)) {
    const before = statSync(PREROLL_JSON);
    await rm(PREROLL_JSON, { force: true });
    console.log(`[gen:veo-hero] replaced prior preroll.json (was ${(before.size / 1024).toFixed(0)} KiB)`);
  }
  await writeFile(PREROLL_JSON, JSON.stringify(payload, null, 2));
  console.log(`[gen:veo-hero] wrote ${PREROLL_JSON}`);
  console.log("[gen:veo-hero] done. The orchestrator now returns this for summon_operator.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
