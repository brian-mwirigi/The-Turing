/**
 * POST /api/canvas/orchestrate
 *
 * Receives:
 *   { frame, click, currentBranch, sceneId }
 *
 * Returns:
 *   { detectedObject, a2ui, suggestedBranch, timings }
 *
 * This endpoint:
 *   1. Calls Florence-2 (via fal-client) to detect objects in the clicked frame
 *   2. Finds the object under the click coordinate
 *   3. Generates an A2UI message describing the surface to render
 */

import { NextRequest, NextResponse } from "next/server";
import { detectObjects, isLiveMode } from "@/lib/canvas/fal-client";
import { orchestrate } from "@/lib/canvas/orchestrator";
import type { OrchestrateRequest } from "@/lib/canvas/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as OrchestrateRequest;
    if (!body.frame || !body.click) {
      return NextResponse.json({ error: "frame and click are required" }, { status: 400 });
    }

    const t0 = Date.now();
    const sceneId = body.sceneId ?? "main";

    // 1. Run Florence-2 detection
    const detections = await detectObjects(body.frame, sceneId);
    const tDetect = Date.now();

    // 2. Orchestrate: pick the object under the click, build the A2UI surface
    const result = orchestrate(
      { ...body, sceneId },
      detections.map((d) => ({
        ...d,
        semanticRole: d.semanticRole ?? "unknown",
      }))
    );
    const tOrch = Date.now();

    return NextResponse.json({
      ...result,
      live: isLiveMode(),
      timings: {
        detectionMs: tDetect - t0,
        orchestrationMs: tOrch - tDetect,
        totalMs: tOrch - t0,
      },
    });
  } catch (err) {
    console.error("[orchestrate] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
