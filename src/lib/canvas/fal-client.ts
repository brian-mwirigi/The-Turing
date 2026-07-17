/**
 * fal.ai client wrapper for the Turing-Complete Canvas.
 *
 * Handles:
 *   - Florence-2 open-vocabulary detection
 *     (fal-ai/florence-2-large/open-vocabulary-detection)
 *   - LTX-2.3 video extension (fal-ai/ltx-2.3-quality/extend-video)
 *   - Veo 3.1 hero moments (fal-ai/veo3.1/fast/image-to-video)
 *   - fal.storage.upload for client-captured mp4 blobs
 *
 * Single credential: process.env.FAL_KEY.
 * If absent, every call returns deterministic mock/demo data so the
 * hackathon demo always works offline.
 */

import { fal } from "@fal-ai/client";
import type { DetectedObject, NormalizedBBox, SemanticRole } from "./types";

// ============================================================================
// Configuration
// ============================================================================

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";

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
  "server rack, computer rack, control terminal, console, operator desk, " +
  "cooling vent, air vent, hvac duct";

// Map Florence-2 label substrings → SemanticRole.
function labelToRole(label: string): SemanticRole {
  const l = label.toLowerCase();
  if (/rack|server|cabinet|chassis/.test(l)) return "faulty_asset";
  if (/terminal|console|desk|screen|monitor|operator/.test(l)) return "operator_interface";
  if (/vent|cool|hvac|duct|fan/.test(l)) return "hvac_component";
  if (/security|door|lock/.test(l)) return "security_node";
  if (/stream|cable|wire|pipe/.test(l)) return "data_stream";
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
  sceneId = "main"
): Promise<DetectedObject[]> {
  ensureRegistered();

  // DEMO MODE
  if (!isLiveMode()) {
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
    const file = new File([blob], `capture-${Date.now()}.mp4`, { type: blob.type || "video/mp4" });
    return await fal.storage.upload(file);
  } catch (err) {
    console.error("[fal-client] storage.upload error:", err);
    return "";
  }
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
}
export interface GeneratedVideo {
  url: string;
  durationSec: number;
  prompt: string;
}

const LTX_DEFAULT_NUM_FRAMES = 25;
const LTX_DEFAULT_CONTEXT_FRAMES = 17; // snapped to 8k+1 by server (17 = 2*8+1)

/**
 * Generate a video chunk using LTX-2.3 quality extend-video.
 *
 * @param params.videoUrl  URL of the source video (recent clip captured client-side
 *                         and uploaded via `uploadVideoBlob`).
 * @param params.prompt    Text prompt describing how the scene should continue.
 */
export async function extendVideo(params: ExtendVideoParams): Promise<GeneratedVideo> {
  ensureRegistered();

  const numFrames = params.numFrames ?? LTX_DEFAULT_NUM_FRAMES;
  const numContextFrames = params.numContextFrames ?? LTX_DEFAULT_CONTEXT_FRAMES;

  // DEMO MODE
  if (!isLiveMode()) {
    await new Promise((r) => setTimeout(r, 200));
    return { url: "", prompt: params.prompt, durationSec: numFrames / 24 };
  }

  try {
    const result = (await fal.subscribe("fal-ai/ltx-2.3-quality/extend-video", {
      input: {
        prompt: params.prompt,
        video_url: params.videoUrl,
        num_frames: numFrames,
        num_context_frames: numContextFrames,
        extend_direction: "forward",
        resolution: "auto",
        match_input_fps: true,
        frames_per_second: 24,
        video_strength: 1, // lock the seam to the source for a seamless crossfade
        guidance_scale: 1,
        num_inference_steps: 18,
        generate_audio: true,
        video_quality: "high",
      },
      logs: false,
    })) as unknown as {
      data?: { video?: { url?: string; duration?: number }; prompt?: string };
    } | { video?: { url?: string; duration?: number }; prompt?: string };
    const data = (result as { data?: { video?: { url?: string; duration?: number }; prompt?: string } })
      .data ?? (result as { video?: { url?: string; duration?: number }; prompt?: string });
    const video = data.video;
    const url = (video?.url as string | undefined) ?? "";
    const durationSec = typeof video?.duration === "number" ? video.duration : numFrames / 24;
    return { url, prompt: data.prompt ?? params.prompt, durationSec };
  } catch (err) {
    console.error("[fal-client] LTX-2.3 extend-video error:", err);
    throw err;
  }
}

// ============================================================================
// Veo 3.1 hero moment (image → video)
// ============================================================================

export interface VeoHeroParams {
  imageUrl: string; // base64 data URI or hosted URL
  prompt: string;
  duration?: "4s" | "6s" | "8s";
  aspectRatio?: "16:9" | "9:16" | "auto";
  resolution?: "720p" | "1080p"; // "4k" is documented but the client lib omits it
  generateAudio?: boolean;
}

/**
 * Generate a "hero" cinematic moment from a seed image using Veo 3.1 fast.
 * Used for the `summon_operator` action: highest-fidelity arc beat in the
 * branching story — operator intervenes, room transforms, etc.
 */
export async function generateVeoHero(params: VeoHeroParams): Promise<GeneratedVideo> {
  ensureRegistered();

  const durSecMap = { "4s": 4, "6s": 6, "8s": 8 } as const;
  const durationSec = durSecMap[params.duration ?? "8s"];

  // DEMO MODE
  if (!isLiveMode()) {
    await new Promise((r) => setTimeout(r, 200));
    return { url: "", prompt: params.prompt, durationSec };
  }

  try {
    const imageUrl = params.imageUrl.startsWith("data:")
      ? params.imageUrl
      : params.imageUrl;
    const result = (await fal.subscribe("fal-ai/veo3.1/fast/image-to-video", {
      input: {
        prompt: params.prompt,
        image_url: imageUrl,
        duration: params.duration ?? "8s",
        aspect_ratio: params.aspectRatio ?? "auto",
        resolution: params.resolution ?? "720p",
        generate_audio: params.generateAudio ?? true,
      },
      logs: false,
    })) as unknown;
    const wrapper = result as { data?: { video?: { url?: string }; prompt?: string } };
    const data = wrapper.data ?? (result as { video?: { url?: string }; prompt?: string });
    const video = data.video;
    const url = (video?.url as string | undefined) ?? "";
    return { url, prompt: data.prompt ?? params.prompt, durationSec };
  } catch (err) {
    console.error("[fal-client] Veo 3.1 error:", err);
    throw err;
  }
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
      "rack_7a",
      "Server Rack 7-A",
      { x1: 0.18, y1: 0.2, x2: 0.42, y2: 0.85 },
      "faulty_asset",
    ],
    [
      "terminal_1",
      "Control Terminal",
      { x1: 0.55, y1: 0.3, x2: 0.92, y2: 0.78 },
      "operator_interface",
    ],
    [
      "vent_1",
      "Cooling Vent",
      { x1: 0.44, y1: 0.05, x2: 0.62, y2: 0.18 },
      "hvac_component",
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
