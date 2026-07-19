/**
 * POST /api/canvas/orchestrate
 *
 * Receives:  { frame, click, currentBranch, sceneId }
 * Returns:   { detections, detectedObject, a2ui, suggestedBranch, live, timings }
 *
 * Pipeline:
 *   1. Florence-2 detects every object in the frame
 *   2. Geometry hit-tests the click → topmost matching bbox
 *   3. If hit: LLM authors an A2UI surface for that object
 *      (falls back to SURFACE_CATALOG on schema failure / no FAL_KEY)
 *   4. Build the A2UI message + suggested branch
 */

import { NextRequest, NextResponse } from "next/server";
import { detectObjects, isLiveMode, skipLlm } from "@/lib/canvas/fal-client";
import {
  buildSurfaceMessage,
  findClickedObject,
} from "@/lib/canvas/orchestrator";
import { generateSurface, isLlmLive } from "@/lib/canvas/llm-orchestrator";
import type { OrchestrateRequest, OrchestrateResponse } from "@/lib/canvas/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as OrchestrateRequest;
    if (!body.frame || !body.click) {
      return NextResponse.json({ error: "frame and click are required" }, { status: 400 });
    }

    const t0 = Date.now();
    const sceneId = body.sceneId ?? "cutting_room_7";

    // 1. Florence-2 detection (live or demo fallback)
    const detections = await detectObjects(body.frame, sceneId);
    const tDetect = Date.now();

    // 2. Hit-test the click coordinate against all detections
    const detected = findClickedObject(body.click, detections);
    const tHit = Date.now();

    if (!detected) {
      return NextResponse.json({
        detections,
        detectedObject: null,
        a2ui: { nonce: makeNonce(), operations: [{ kind: "clear" }] },
        live: isLiveMode(),
        llm: isLlmLive(),
        timings: {
          detectionMs: tDetect - t0,
          orchestrationMs: tHit - t0,
          totalMs: tHit - t0,
        },
      });
    }

    // 3. LLM-authored surface (with deterministic catalog fallback)
    let surfaceSpec:
      | { root: import("@/lib/canvas/types").A2UIComponent; reason?: string; suggestedBranch?: import("@/lib/canvas/types").BranchId }
      | undefined;

    const objectStates = body.objectStates ?? {};
    const role = detected.semanticRole ?? "unknown";
    const objectState = objectStates[role];

    // LLM surfaces (unless FAL_SKIP_LLM). Thread object state so menus aren't static.
    if (isLlmLive() && !skipLlm()) {
      const llmResult = await generateSurface({
        object: detected,
        branch: body.currentBranch,
        objectState,
        objectStates: objectStates as Record<string, string>,
      });
      if (llmResult.ok && llmResult.surface) {
        // The LLM is permitted to suggest the next branch through the surface's
        // `suggestedBranch` hint (read defensively; if it's not a valid
        // BranchId it's just ignored in favour of the deterministic catalog).
        const suggestedRaw = (llmResult.surface as { suggestedBranch?: string }).suggestedBranch;
        const VALID_BRANCHES: import("@/lib/canvas/types").BranchId[] = [
          "taking", "splice", "roll_take", "cut_take", "continue_page",
          "scratch_line", "sign_off", "warm_grade", "cold_grade", "bleach_grade",
          "page_studio", "summon_operator", "recover", "burn", "rewind",
          "advance_clock", "extend_establish", "cutto_interior", "neutral",
        ];
        const suggestedBranch = (VALID_BRANCHES as string[]).includes(suggestedRaw ?? "")
          ? (suggestedRaw as import("@/lib/canvas/types").BranchId)
          : undefined;
        surfaceSpec = {
          root: llmResult.surface.root,
          reason: llmResult.surface.reason,
          suggestedBranch,
        };
      }
    }

    // 4. Build the A2UI message — injects deterministic static action first
    const branch = (body.currentBranch as import("@/lib/canvas/types").BranchId) || "taking";
    const { a2ui, suggestedBranch } = buildSurfaceMessage(
      detected,
      surfaceSpec,
      branch,
      objectStates,
    );
    const tOrch = Date.now();

    const response: OrchestrateResponse = {
      detections,
      detectedObject: detected,
      a2ui,
      suggestedBranch,
      timings: {
        detectionMs: tDetect - t0,
        orchestrationMs: tOrch - tDetect,
        totalMs: tOrch - t0,
      },
    };

    return NextResponse.json({ ...response, live: isLiveMode(), llm: isLlmLive() });
  } catch (err) {
    console.error("[orchestrate] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}

function makeNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
