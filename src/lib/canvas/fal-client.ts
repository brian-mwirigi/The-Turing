/**
 * fal.ai client wrapper for the Turing-Complete Canvas.
 *
 * Handles:
 *   - Florence-2 zero-shot object detection (via fal-ai/models/florence-2)
 *   - LTX-2.3 image-to-video extension (via fal-ai/ltx-2.3/image-to-video/fast)
 *
 * CRITICAL IMPLEMENTATION NOTES (from architectural de-risking):
 *
 * 1. FLORENCE-2 COORDINATE NORMALIZATION
 *      Florence-2 returns bounding box coordinates as integers in [0, 999]
 *      (i.e. absolute floats scaled by 1000). We divide by 1000 to recover
 *      normalized 0..1 coordinates, which the frontend then multiplies by
 *      the rendered pixel dimensions of the <video> element.
 *
 * 2. LTX-2.3 DIMENSION CONSTRAINTS
 *      Width and height must be divisible by 32. The total frame count must
 *      equal (n * 8) + 1. We compute these explicitly before submitting.
 *
 * 3. LTX-2.3 CONTEXT WINDOW
 *      The `context` parameter (seconds of input video to use as baseline)
 *      is hardcoded to 1.5s — enough for optical flow, low enough to keep
 *      latency in the interactive horizon.
 *
 * 4. ARTIFACT AMPLIFICATION
 *      Heavily compressed intermediate frames get amplified by the diffusion
 *      model. We send raw base64 JPEGs at high quality (q=95) rather than
 *      compressed URLs.
 *
 * 5. DEMO FALLBACK
 *      If FAL_KEY is not set, every call returns deterministic mock data so
 *      the demo always works. The presence of FAL_KEY enables live mode.
 */

import { fal } from "@fal-ai/client";
import type { DetectedObject, NormalizedBBox, SemanticRole } from "./types";

// ============================================================================
// Configuration
// ============================================================================

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";

// LTX-2.3 hard architectural constraints
const LTX_DIM_DIVISOR = 32;
const LTX_FRAME_FORMULA = (n: number) => n * 8 + 1;
const LTX_CONTEXT_SECONDS = 1.5;
const LTX_DEFAULT_DURATION_SEC = 6; // 6s @ 24fps = 145 frames; n=18 -> 8*18+1 = 145 ✓
const LTX_FPS = 24;

export const isLiveMode = () => FAL_KEY.length > 0;

let _registered = false;
function ensureRegistered() {
  if (_registered) return;
  if (FAL_KEY) {
    fal.config({ credentials: FAL_KEY });
  }
  _registered = true;
}

// ============================================================================
// Florence-2 detection
// ============================================================================

/**
 * Parse Florence-2's text-based coordinate output.
 *
 * Florence-2 emits coordinates like "<loc_012><loc_234><loc_567><loc_789>"
 * where each <loc_XXX> is an integer in [0, 999] representing a normalized
 * float scaled by 1000. The four values are (y1, x1, y2, x2) for the bbox.
 *
 * Returns normalized 0..1 bounding box.
 */
export function parseFlorenceCoords(raw: string): NormalizedBBox | null {
  const matches = raw.match(/<loc_(\d+)>/g);
  if (!matches || matches.length < 4) return null;
  const nums = matches.slice(0, 4).map((m) => parseInt(m.replace("<loc_", "").replace(">", ""), 10) / 1000);
  // Florence-2 emits (y1, x1, y2, x2); we normalize to (x1, y1, x2, y2)
  const [y1, x1, y2, x2] = nums;
  return {
    x1: Math.min(Math.max(x1, 0), 1),
    y1: Math.min(Math.max(y1, 0), 1),
    x2: Math.min(Math.max(x2, 0), 1),
    y2: Math.min(Math.max(y2, 0), 1),
  };
}

interface FlorenceRawResult {
  raw_text: string;
  bboxes: NormalizedBBox[];
  labels: string[];
}

/**
 * Run Florence-2 object detection on a frame.
 * In live mode, calls fal-ai/models/florence-2.
 * In demo mode, returns deterministic mock detections that match the
 * procedural scene (so the click-on-rack → "Server Rack 7-A" mapping works).
 */
export async function detectObjects(
  frameBase64: string,
  sceneId: string = "main"
): Promise<DetectedObject[]> {
  ensureRegistered();

  // ------------------------------------------------------------------
  // DEMO MODE: return mock objects matching the procedural scene
  // ------------------------------------------------------------------
  if (!isLiveMode()) {
    return getMockDetections(sceneId);
  }

  // ------------------------------------------------------------------
  // LIVE MODE: call fal-ai/florence-2
  // ------------------------------------------------------------------
  try {
    const result = await fal.subscribe("fal-ai/models/florence-2", {
      input: {
        image_url: frameBase64.startsWith("data:")
          ? frameBase64
          : `data:image/jpeg;base64,${frameBase64}`,
        // Open vocabulary phrase grounding: detect server racks, terminals, vents
        task: "open_vocabulary_detection",
        text_input: "server rack, control terminal, cooling vent, sparking rack",
        max_new_tokens: 512,
      },
      logs: false,
    });

    const data = (result as { data?: unknown }).data ?? result;
    return parseFlorenceResponse(data);
  } catch (err) {
    console.error("[fal-client] Florence-2 error, falling back to mock:", err);
    return getMockDetections(sceneId);
  }
}

function parseFlorenceResponse(data: unknown): DetectedObject[] {
  // The exact response shape varies; we defensively extract any bbox-like structure.
  const obj = data as Record<string, unknown>;
  const rawText = (obj.generated_text ?? obj.output ?? "") as string;
  // Also try structured fields if present
  const boxes = (obj.bboxes ?? obj.boxes ?? []) as unknown[];
  const labels = (obj.labels ?? obj.bbox_labels ?? []) as string[];

  const out: DetectedObject[] = [];

  if (boxes.length > 0) {
    boxes.forEach((b, i) => {
      const arr = Array.isArray(b) ? (b as number[]) : null;
      if (!arr || arr.length < 4) return;
      const [y1, x1, y2, x2] = arr;
      out.push({
        id: `obj_${i}_${Date.now()}`,
        label: (labels[i] as string) ?? `object_${i}`,
        bbox: { x1, y1, x2, y2 },
        confidence: 0.9,
      });
    });
  }

  // Fallback: parse the raw text for <loc_XXX> sequences
  if (out.length === 0 && rawText) {
    const labelMatches = rawText.match(/([A-Za-z0-9 _-]+)(?=<loc_|$)/g) ?? [];
    const bboxMatches = rawText.match(/(?:<loc_\d+>){4}/g) ?? [];
    bboxMatches.forEach((bboxStr, i) => {
      const bbox = parseFlorenceCoords(bboxStr);
      if (!bbox) return;
      out.push({
        id: `obj_${i}_${Date.now()}`,
        label: (labelMatches[i] ?? `object_${i}`).trim(),
        bbox,
        confidence: 0.85,
      });
    });
  }

  return out;
}

// ============================================================================
// LTX-2.3 video extension
// ============================================================================

/**
 * Compute LTX-2.3-compatible parameters.
 *
 * Rules:
 *   - width, height must be divisible by 32
 *   - num_frames must equal n*8 + 1
 *
 * Default: 768x512, 145 frames (n=18) at 24fps = 6.04s
 */
export function computeLtxParams(width: number, height: number, durationSec: number) {
  // Snap to nearest multiple of 32
  const w = Math.floor(width / LTX_DIM_DIVISOR) * LTX_DIM_DIVISOR;
  const h = Math.floor(height / LTX_DIM_DIVISOR) * LTX_DIM_DIVISOR;
  // Compute n so that frames = n*8 + 1 ~= durationSec * fps
  const targetFrames = Math.round(durationSec * LTX_FPS);
  const n = Math.max(1, Math.round((targetFrames - 1) / 8));
  const numFrames = LTX_FRAME_FORMULA(n);
  return {
    width: w,
    height: h,
    numFrames,
    fps: LTX_FPS,
    contextSeconds: LTX_CONTEXT_SECONDS,
    durationSec: numFrames / LTX_FPS,
  };
}

/**
 * Generate a video chunk using LTX-2.3 image-to-video extension.
 *
 * @param seedFrame Base64 JPEG of the last frame (high quality to avoid
 *                  artifact amplification)
 * @param prompt    Text prompt with appended state changes
 * @returns         Video URL (fal-hosted or data URI)
 */
export async function generateVideoChunk(
  seedFrame: string,
  prompt: string
): Promise<{ url: string; prompt: string; durationSec: number }> {
  ensureRegistered();

  const params = computeLtxParams(768, 512, LTX_DEFAULT_DURATION_SEC);

  if (!isLiveMode()) {
    // Demo mode: just wait a bit to simulate generation, return null so caller
    // picks the appropriate demo asset.
    await new Promise((r) => setTimeout(r, 200));
    return { url: "", prompt, durationSec: params.durationSec };
  }

  try {
    const result = await fal.subscribe("fal-ai/ltx-2.3/image-to-video/fast", {
      input: {
        image_url: seedFrame.startsWith("data:")
          ? seedFrame
          : `data:image/jpeg;base64,${seedFrame}`,
        prompt,
        // Strict LTX-2.3 constraints
        num_frames: params.numFrames,
        fps: params.fps,
        width: params.width,
        height: params.height,
        context_seconds: params.contextSeconds,
        // Keep guidance low for continuity, high enough for prompt adherence
        guidance_scale: 1.0,
        num_inference_steps: 30,
      },
      logs: false,
    });

    const data = (result as { data?: Record<string, unknown> }).data ?? (result as Record<string, unknown>);
    const videoUrl = (data.video ?? data.url ?? data.output) as { url?: string } | string | undefined;
    const url = typeof videoUrl === "string" ? videoUrl : videoUrl?.url ?? "";
    return { url, prompt, durationSec: params.durationSec };
  } catch (err) {
    console.error("[fal-client] LTX-2.3 error:", err);
    throw err;
  }
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
      { x1: 0.18, y1: 0.20, x2: 0.42, y2: 0.85 },
      "faulty_asset",
    ],
    [
      "terminal_1",
      "Control Terminal",
      { x1: 0.55, y1: 0.30, x2: 0.92, y2: 0.78 },
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
