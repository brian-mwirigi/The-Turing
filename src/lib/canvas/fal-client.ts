/**
 * fal.ai client wrapper for the Turing-Complete Canvas.
 *
 * Handles:
 *   - Florence-2 open-vocabulary detection
 *   - LTX-2.3 video extension
 *   - Veo 3.1 hero moments
 *   - fal.storage.upload for client-captured mp4 blobs
 *
 * Single credential: process.env.FAL_KEY.
 * If absent, every call returns deterministic mock/demo data so the
 * hackathon demo always works offline.
 *
 * Credit-saving knobs (for testing with ~100 credits):
 *   FAL_CHEAP=1              → cheaper LTX extend + skip Florence (use mock boxes)
 *   FAL_EXTEND_MODEL=...     → override extend endpoint
 *   FAL_EXTEND_DURATION=2    → seconds to generate (cheap path only; default 2)
 *   FAL_MOCK_DETECT=1        → never call Florence (free click testing)
 *   FAL_SKIP_VEO=1           → summon_operator falls through to LTX / demo
 */

import { fal } from "@fal-ai/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DetectedObject, NormalizedBBox, SemanticRole } from "./types";

// ============================================================================
// Configuration
// ============================================================================

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";

/** Pitch-day + cheap-test extend (same schema; cheap just shortens the clip). */
const EXTEND_MODEL_QUALITY = "fal-ai/ltx-2.3-quality/extend-video";
/**
 * Partner "duration" extend — needs ≥73 source frames and is flaky/slow on
 * long seeds. Only used if FAL_EXTEND_MODEL points here explicitly.
 */
const EXTEND_MODEL_DURATION = "fal-ai/ltx-2.3/extend-video";

const cheapMode = () =>
  String(process.env.FAL_CHEAP ?? "").toLowerCase() === "1" ||
  String(process.env.FAL_CHEAP ?? "").toLowerCase() === "true";

const mockDetect = () =>
  cheapMode() ||
  String(process.env.FAL_MOCK_DETECT ?? "").toLowerCase() === "1" ||
  String(process.env.FAL_MOCK_DETECT ?? "").toLowerCase() === "true";

export const skipVeo = () =>
  cheapMode() ||
  String(process.env.FAL_SKIP_VEO ?? "").toLowerCase() === "1" ||
  String(process.env.FAL_SKIP_VEO ?? "").toLowerCase() === "true";

/** Skip LLM entirely (surfaces + rewrite). Catalog / planBranch only. */
export const skipLlm = () =>
  String(process.env.FAL_SKIP_LLM ?? "").toLowerCase() === "1" ||
  String(process.env.FAL_SKIP_LLM ?? "").toLowerCase() === "true";

/**
 * Skip prompt-rewrite LLM only. FAL_CHEAP still authors surfaces via LLM so
 * buttons track the current branch, but skips the rewrite call to save tokens.
 */
export const skipPromptRewrite = () => cheapMode() || skipLlm();

export const isCheapMode = () => cheapMode();

function extendModel() {
  // Default BOTH modes to the quality endpoint — reliable schema.
  // Override with FAL_EXTEND_MODEL=fal-ai/ltx-2.3/extend-video if you want.
  return process.env.FAL_EXTEND_MODEL || EXTEND_MODEL_QUALITY;
}

function usesDurationApi(model: string) {
  return model === EXTEND_MODEL_DURATION || model.includes("/ltx-2.3/extend-video");
}

export const isLiveMode = () => FAL_KEY.length > 0;

let _registered = false;
function ensureRegistered() {
  if (_registered) return;
  if (FAL_KEY) {
    fal.config({ credentials: FAL_KEY });
  }
  _registered = true;
}

/**
 * The discovery vocabulary we feed to Florence-2. Open-vocabulary detection
 * lets us ask for the exact semantic categories our scene model uses, so the
 * orchestrator can map bboxes ↦ SemanticRole without a second model call.
 */
const FLORENCE_VOCAB =
  "film reels, steenbeck flatbed editor, splice block, bolex camera, tripod, " +
  "typewriter, mug of coffee, wall intercom, light shaft, window";

// Map Florence-2 label substrings → SemanticRole for the cutting room scene.
function labelToRole(label: string): SemanticRole {
  const l = label.toLowerCase();
  if (/reel|steenbeck|splice|flatbed|film/.test(l)) return "film_source";
  if (/bolex|camera|tripod|lens/.test(l)) return "camera_asset";
  if (/typewriter|paper|note|page|carriage/.test(l)) return "manuscript";
  if (/mug|coffee|cup|saucer/.test(l)) return "artifact_unset";
  if (/intercom|speaker|panel|console|desk/.test(l)) return "operator_interface";
  if (/light|shaft|beam|window|sun/.test(l)) return "vfx_element";
  if (/ocean|coast|sea|view/.test(l)) return "scene_extern";
  return "unknown";
}

// ============================================================================
// Florence-2 detection
// ============================================================================

/** Raw Florence-2 bbox shape as documented at the live endpoint. */
interface FlorenceBBox {
  x: number; // absolute pixels, top-left
  y: number;
  w: number;
  h: number;
  label: string;
}
interface FlorenceResponse {
  results?: { bboxes?: FlorenceBBox[] };
  image?: { width?: number; height?: number };
}

/**
 * Run Florence-2 open-vocabulary detection on a frame.
 *
 * In live mode, calls fal-ai/florence-2-large/open-vocabulary-detection.
 * The endpoint returns bboxes in absolute pixel coords plus the processed
 * image dimensions, so we normalize here (x/width, y/height) for the frontend.
 *
 * In demo mode, returns deterministic mock detections that match the
 * procedural scene (so the click-on-rack → "Server Rack 7-A" mapping works).
 */
export async function detectObjects(
  frameBase64: string,
  sceneId = "cutting_room_7"
): Promise<DetectedObject[]> {
  ensureRegistered();

  // DEMO / CHEAP TEST — fixed hotspots, $0 detection cost
  if (!isLiveMode() || mockDetect()) {
    return getMockDetections(sceneId);
  }

  // LIVE MODE
  try {
    const image_url = frameBase64.startsWith("data:")
      ? frameBase64
      : `data:image/jpeg;base64,${frameBase64}`;
    const result = (await fal.subscribe(
      "fal-ai/florence-2-large/open-vocabulary-detection",
      {
        input: {
          image_url,
          text_input: FLORENCE_VOCAB,
        },
        logs: false,
      }
    )) as unknown;
    const wrapper = result as { data?: FlorenceResponse };
    const data: FlorenceResponse = wrapper.data ?? (result as FlorenceResponse);
    return parseFlorenceResponse(data);
  } catch (err) {
    console.error("[fal-client] Florence-2 error, falling back to mock:", err);
    return getMockDetections(sceneId);
  }
}

/**
 * Parse the documented Florence-2 response shape:
 *   { results: { bboxes: [{ x, y, w, h, label }] }, image: { width, height } }
 *
 * x,y are top-left in absolute pixels; w,h are dimensions. We normalize via
 * the processed image's width/height so the server stays authoritative on
 * pixel↦norm mapping (we never trust client capture dims for detection).
 */
export function parseFlorenceResponse(data: FlorenceResponse): DetectedObject[] {
  const bboxes = data?.results?.bboxes ?? [];
  const imgW = data?.image?.width;
  const imgH = data?.image?.height;

  const out: DetectedObject[] = [];
  bboxes.forEach((b, i) => {
    if (b == null || typeof b.x !== "number") return;
    // If the endpoint didn't return image dims, we infer from the largest bbox
    // coordinate pair as a last-resort heuristic.
    const maxX = b.x + b.w;
    const maxY = b.y + b.h;
    const normW = imgW ?? Math.max(maxX, 1);
    const normH = imgH ?? Math.max(maxY, 1);
    const x1 = clamp01(b.x / normW);
    const y1 = clamp01(b.y / normH);
    const x2 = clamp01(maxX / normW);
    const y2 = clamp01(maxY / normH);
    if (x2 <= x1 || y2 <= y1) return;
    const label = (b.label ?? `object_${i}`).trim() || `object_${i}`;
    out.push({
      id: `obj_${i}_${Date.now()}`,
      label,
      bbox: { x1, y1, x2, y2 },
      confidence: 0.9,
      semanticRole: labelToRole(label),
    });
  });
  return out;
}

// ============================================================================
// fal.storage upload (for client-captured mp4)
// ============================================================================

/**
 * Upload a Blob to fal storage, returning a public URL usable as
 * `video_url` for the extend-video endpoint.
 *
 * In demo mode, returns "" — callers should then fall back to demo assets.
 */
export async function uploadVideoBlob(blob: Blob): Promise<string> {
  ensureRegistered();
  if (!isLiveMode()) return "";
  try {
    const mime = (blob.type || "video/mp4").split(";")[0] || "video/mp4";
    const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : "bin";
    const file = new File([blob], `capture-${Date.now()}.${ext}`, { type: mime });
    return await fal.storage.upload(file);
  } catch (err) {
    console.error("[fal-client] storage.upload error:", err);
    return "";
  }
}

/** True when the client capture is likely unusable as an LTX seed (Chrome → WebM). */
function isUsableMp4Seed(blob: Blob | null | undefined): boolean {
  if (!blob || blob.size < 8_000) return false;
  const t = (blob.type || "").toLowerCase();
  // LTX extend is picky — WebM/VP8/VP9 captures routinely 422.
  if (t.includes("webm") || t.includes("vp8") || t.includes("vp9")) return false;
  return t.includes("mp4") || t.includes("quicktime") || t === "" || t === "application/octet-stream";
}

/** Cache so we don't re-upload on every click. */
let _roomSeedUrl: string | null = null;

/**
 * Upload a short ambient seed (room_seed.mp4 ≈4s / 96 frames, else room_loop).
 * MediaRecorder clips are ~7–10 frames — LTX rejects those with 422.
 */
export async function uploadRoomLoopSeed(): Promise<string> {
  ensureRegistered();
  if (!isLiveMode()) return "";
  if (_roomSeedUrl) return _roomSeedUrl;
  try {
    const canvasDir = path.join(process.cwd(), "public", "canvas");
    const seedPath = path.join(canvasDir, "room_seed.mp4");
    const loopPath = path.join(canvasDir, "room_loop.mp4");
    const { existsSync } = await import("node:fs");
    const filePath = existsSync(seedPath) ? seedPath : loopPath;
    const buf = await readFile(filePath);
    const name = path.basename(filePath);
    const file = new File([buf], name, { type: "video/mp4" });
    const url = await fal.storage.upload(file);
    _roomSeedUrl = url;
    console.log(`[fal-client] seeded extend from ${name} (${(buf.length / 1024).toFixed(0)} KiB)`);
    return url;
  } catch (err) {
    console.error("[fal-client] room seed upload failed:", err);
    return "";
  }
}

/**
 * Resolve a fal-hosted video_url for extend-video.
 * Always prefer the pre-baked room seed — client captures are too short.
 */
export async function resolveExtendSeed(_blob: Blob | null | undefined): Promise<string> {
  console.log("[fal-client] extend seed: room_seed/room_loop (captures are <73 frames)");
  return uploadRoomLoopSeed();
}

// ============================================================================
// LTX-2.3 video extension (true video → video)
// ============================================================================

/**
 * Budget caps documented on the extend-video endpoint:
 *   480p-class ≈ 20s, 720p-class ≈ 11s, 1080p-class ≈ 5s.
 * We request ~25 frames (~1s) of new content on top of a 1s context overlap,
 * which keeps us well under budget at any resolution and keeps interactive
 * latency in the triple-digit-second range (masked by slow-mo).
 */
export interface ExtendVideoParams {
  videoUrl: string;
  prompt: string;
  numFrames?: number;
  numContextFrames?: number;
  /** 1.0 = lock overlap to source (default for pitch). Lower = more rewrite freedom. */
  videoStrength?: number;
  negativePrompt?: string;
  /** Cutaways may turn this on; locked room beats keep it off. */
  enablePromptExpansion?: boolean;
}
export interface GeneratedVideo {
  url: string;
  durationSec: number;
  prompt: string;
}

const LTX_DEFAULT_NUM_FRAMES = 25;
const LTX_DEFAULT_CONTEXT_FRAMES = 17; // snapped to 8k+1 by server (17 = 2*8+1)

/**
 * Generate a video chunk using LTX extend-video.
 *
 * Pitch: `fal-ai/ltx-2.3-quality/extend-video`
 * Test:  `FAL_CHEAP=1` → `fal-ai/ltx-2.3/extend-video` (~$0.10/s, short duration)
 */
export async function extendVideo(params: ExtendVideoParams): Promise<GeneratedVideo> {
  ensureRegistered();

  const model = extendModel();
  const durationApi = usesDurationApi(model);
  const cheapDuration = Math.min(
    20,
    Math.max(2, Number(process.env.FAL_EXTEND_DURATION ?? 2)),
  );
  // num_frames includes context — new motion ≈ (num_frames - context) / fps
  // Cheap: enough NEW frames (~3s) that the seek-past-seed cut actually reads.
  const numFrames = params.numFrames ?? (cheapMode() ? 97 : 121);
  // ~25 context frames + strength 0.8: enough overlap for continuity without
  // locking the extend into near-static (1.0 / heavy context was freezing motion).
  const numContextFrames =
    params.numContextFrames ?? (cheapMode() ? 17 : 25);

  // DEMO MODE
  if (!isLiveMode()) {
    await new Promise((r) => setTimeout(r, 200));
    return { url: "", prompt: params.prompt, durationSec: numFrames / 24 };
  }

  // Soft cap — was 600 and silently cut off FRAME_LOCK after MOVES.
  const prompt =
    params.prompt.length > 1400 ? `${params.prompt.slice(0, 1397)}…` : params.prompt;

  try {
    const input = durationApi
      ? {
          video_url: params.videoUrl,
          prompt,
          duration: cheapDuration,
          mode: "end" as const,
          context: 1,
        }
      : {
          prompt,
          video_url: params.videoUrl,
          num_frames: numFrames,
          // More context overlap = harder for the model to invent a new room mid-extend
          num_context_frames: numContextFrames,
          extend_direction: "forward",
          resolution: cheapMode() ? "landscape_16_9" : "auto",
          match_input_fps: true,
          frames_per_second: 24,
          // API default 1.0 locks overlap to source (near-static). 0.8 lets motion through.
          video_strength:
            params.videoStrength ?? (cheapMode() ? 0.55 : 0.8),
          guidance_scale: cheapMode() ? 5 : 1.5,
          num_inference_steps: cheapMode() ? 16 : 20,
          generate_audio: !cheapMode(),
          video_quality: cheapMode() ? "medium" : "high",
          // Expansion invents lamps/fog/new walls — off for locked room beats.
          enable_prompt_expansion: params.enablePromptExpansion ?? false,
          ...(params.negativePrompt
            ? { negative_prompt: params.negativePrompt }
            : {}),
        };

    console.log(
      `[fal-client] extend via ${model}${durationApi ? ` (${cheapDuration}s)` : ` frames=${numFrames}`} seed=${params.videoUrl.slice(0, 72)}…`,
    );
    const result = (await fal.subscribe(model, {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs?.length) {
          const last = update.logs[update.logs.length - 1]?.message;
          if (last) console.log(`[fal-client] ltx: ${last}`);
        }
      },
    })) as unknown as {
      data?: { video?: { url?: string; duration?: number }; prompt?: string };
    } | { video?: { url?: string; duration?: number }; prompt?: string };
    const data = (result as { data?: { video?: { url?: string; duration?: number }; prompt?: string } })
      .data ?? (result as { video?: { url?: string; duration?: number }; prompt?: string });
    const video = data.video;
    const url = (video?.url as string | undefined) ?? "";
    const fallbackDur = durationApi ? cheapDuration : (numFrames - numContextFrames) / 24;
    const durationSec = typeof video?.duration === "number" ? video.duration : fallbackDur;
    if (url) console.log(`[fal-client] extend OK → ${url.slice(0, 80)}…`);
    return { url, prompt: data.prompt ?? prompt, durationSec };
  } catch (err) {
    const body =
      err && typeof err === "object" && "body" in err
        ? JSON.stringify((err as { body: unknown }).body)
        : "";
    console.error("[fal-client] LTX extend-video error:", err);
    if (body) console.error("[fal-client] LTX 422 body:", body);
    return { url: "", prompt, durationSec: durationApi ? cheapDuration : numFrames / 24 };
  }
}

// ============================================================================
// Veo 3.1 hero moment (image → video)
// ============================================================================

export interface VeoHeroParams {
  imageUrl: string; // base64 data URI or hosted URL
  prompt: string;
  negativePrompt?: string;
  duration?: "4s" | "6s" | "8s";
  aspectRatio?: "16:9" | "9:16" | "auto";
  resolution?: "720p" | "1080p"; // "4k" is documented but the client lib omits it
  generateAudio?: boolean;
  /** Default: full Veo 3.1 (not fast) — hero needs the quality. */
  useFast?: boolean;
}

/**
 * Resolve a fal-hosted image URL for Veo.
 * Data URIs often 422 on veo3.1/fast — upload to fal.storage first.
 */
async function resolveVeoImageUrl(imageUrl: string): Promise<string> {
  if (!imageUrl.startsWith("data:")) return imageUrl;
  const m = /^data:([^;]+);base64,(.+)$/s.exec(imageUrl);
  if (!m) throw new Error("Veo seed: invalid data URI");
  const mime = m[1] || "image/jpeg";
  const buf = Buffer.from(m[2]!, "base64");
  const ext = mime.includes("png") ? "png" : "jpg";
  const file = new File([buf], `veo-seed-${Date.now()}.${ext}`, { type: mime });
  const url = await fal.storage.upload(file);
  console.log(`[fal-client] Veo seed uploaded (${(buf.length / 1024).toFixed(0)} KiB)`);
  return url;
}

/**
 * Generate a "hero" cinematic moment from a seed image using Veo 3.1 fast.
 * Used for the `summon_operator` action: highest-fidelity arc beat.
 */
export async function generateVeoHero(params: VeoHeroParams): Promise<GeneratedVideo> {
  ensureRegistered();

  const durSecMap = { "4s": 4, "6s": 6, "8s": 8 } as const;
  const durationSec = durSecMap[params.duration ?? "8s"];

  // Hard guard — never hit Veo while FAL_CHEAP / FAL_SKIP_VEO is on.
  // There is no "cheap Veo" endpoint; skipping must mean zero Veo calls.
  if (skipVeo()) {
    console.warn(
      "[fal-client] generateVeoHero blocked (FAL_CHEAP / FAL_SKIP_VEO) — no Veo bill",
    );
    return { url: "", prompt: params.prompt, durationSec };
  }

  // DEMO MODE
  if (!isLiveMode()) {
    await new Promise((r) => setTimeout(r, 200));
    return { url: "", prompt: params.prompt, durationSec };
  }

  try {
    const imageUrl = await resolveVeoImageUrl(params.imageUrl);
    // Full Veo 3.1 for the hero (not fast) — fast reads plastic on faces.
    // Prefer 16:9 + hosted URL — data URI / aspect "auto" has 422'd in practice.
    const endpoint = params.useFast
      ? "fal-ai/veo3.1/fast/image-to-video"
      : "fal-ai/veo3.1/image-to-video";
    console.log(`[fal-client] Veo hero → ${endpoint}`);
    const result = (await fal.subscribe(endpoint, {
      input: {
        prompt: params.prompt,
        image_url: imageUrl,
        duration: params.duration ?? "8s",
        aspect_ratio: params.aspectRatio ?? "16:9",
        resolution: params.resolution ?? "720p",
        generate_audio: params.generateAudio ?? true,
        auto_fix: true,
        safety_tolerance: "5",
        ...(params.negativePrompt
          ? { negative_prompt: params.negativePrompt }
          : {}),
      },
      logs: false,
    })) as unknown;
    const wrapper = result as { data?: { video?: { url?: string }; prompt?: string } };
    const data = wrapper.data ?? (result as { video?: { url?: string }; prompt?: string });
    const video = data.video;
    const url = (video?.url as string | undefined) ?? "";
    return { url, prompt: data.prompt ?? params.prompt, durationSec };
  } catch (err) {
    const body = (err as { body?: unknown })?.body;
    console.error(
      "[fal-client] Veo 3.1 error:",
      body ? JSON.stringify(body, null, 2) : err,
    );
    throw err;
  }
}

/** Upload poster.jpg (or a room_seed frame) for Veo / demo hero generation. */
export async function uploadVeoSeedStill(): Promise<string> {
  ensureRegistered();
  if (!isLiveMode()) return "";
  const canvasDir = path.join(process.cwd(), "public", "canvas");
  const poster = path.join(canvasDir, "poster.jpg");
  const { existsSync } = await import("node:fs");
  if (!existsSync(poster)) {
    throw new Error("poster.jpg missing — needed as Veo seed still");
  }
  const buf = await readFile(poster);
  const file = new File([buf], "poster.jpg", { type: "image/jpeg" });
  const url = await fal.storage.upload(file);
  console.log(`[fal-client] Veo poster seed ${(buf.length / 1024).toFixed(0)} KiB → ${url.slice(0, 60)}…`);
  return url;
}

// ============================================================================
// Helpers
// ============================================================================

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 1);
}

// ============================================================================
// Mock detections (demo mode)
// ============================================================================

/**
 * Returns mock detections matching the procedural demo scene.
 * Coordinates must match the Python script in scripts/generate_demo_assets.py.
 */
function getMockDetections(sceneId: string): DetectedObject[] {
  const base: Array<[string, string, NormalizedBBox, SemanticRole]> = [
    [
      "steenbeck_reels",
      "Steenbeck Flatbed",
      { x1: 0.06, y1: 0.42, x2: 0.46, y2: 0.86 },
      "film_source",
    ],
    [
      "bolex_tripod",
      "Bolex on Tripod",
      { x1: 0.62, y1: 0.18, x2: 0.86, y2: 0.72 },
      "camera_asset",
    ],
    [
      "typewriter_note",
      "Royal Typewriter",
      { x1: 0.4, y1: 0.3, x2: 0.66, y2: 0.62 },
      "manuscript",
    ],
    [
      "cold_coffee",
      "Cold Coffee",
      { x1: 0.5, y1: 0.66, x2: 0.6, y2: 0.78 },
      "artifact_unset",
    ],
    [
      "wall_intercom",
      "Wall Intercom",
      { x1: 0.84, y1: 0.08, x2: 0.97, y2: 0.3 },
      "operator_interface",
    ],
    [
      "light_shaft",
      "Light Shaft",
      { x1: 0.2, y1: 0.04, x2: 0.4, y2: 0.4 },
      "vfx_element",
    ],
    [
      "window_ocean",
      "Window, Pacific",
      { x1: 0.86, y1: 0.32, x2: 1, y2: 0.66 },
      "scene_extern",
    ],
  ];
  return base.map(([id, label, bbox, role]) => ({
    id: `${id}_${sceneId}`,
    label,
    bbox,
    confidence: 0.94,
    semanticRole: role,
  }));
}
