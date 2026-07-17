/**
 * POST /api/canvas/generate
 *
 * Receives:
 *   { action, currentBranch, lastFrame, sceneId }
 *
 * Returns:
 *   { chunk, branch, updatedPrompt, timings }
 *
 * This endpoint:
 *   1. Plans the target branch + prompt suffix from the user's action
 *   2. Builds the final prompt (state persistence: action → prompt)
 *   3. Calls LTX-2.3 to generate the next video chunk
 *   4. Returns the video URL (or demo asset URL in demo mode)
 */

import { NextRequest, NextResponse } from "next/server";
import { generateVideoChunk, isLiveMode } from "@/lib/canvas/fal-client";
import { planBranchForAction } from "@/lib/canvas/orchestrator";
import type { GenerateRequest, GenerateResponse } from "@/lib/canvas/types";

export const runtime = "nodejs";
export const maxDuration = 300; // LTX-2.3 can take a while

// Demo branch asset URLs (mirrors store.ts)
const DEMO_BRANCH_URLS = {
  main: "/canvas/scene_main.mp4",
  alert: "/canvas/branch_alert.mp4",
  reboot: "/canvas/branch_reboot.mp4",
  neutral: "/canvas/branch_neutral.mp4",
} as const;

const BASE_PROMPT =
  "Cinematic sci-fi server room interior, dark ambiance with cyan accent lighting, " +
  "server racks with blinking LEDs, perspective floor grid, volumetric dust particles, " +
  "film grain, 35mm anamorphic lens, high detail";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateRequest;
    if (!body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const t0 = Date.now();
    const { branch, promptSuffix } = planBranchForAction(body.action);
    const updatedPrompt = `${BASE_PROMPT}${promptSuffix}`;

    // ------------------------------------------------------------------
    // DEMO MODE: return the pre-rendered procedural asset
    // ------------------------------------------------------------------
    if (!isLiveMode()) {
      // Simulate generation latency to demonstrate the slow-mo masking
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
      const url = DEMO_BRANCH_URLS[branch];
      return NextResponse.json({
        chunk: {
          id: `chunk_demo_${Date.now()}`,
          url,
          source: "demo",
          prompt: updatedPrompt,
          branch,
          durationSec: 6,
          queuedAt: Date.now(),
        },
        branch,
        updatedPrompt,
        live: false,
        timings: {
          queueMs: 50,
          generationMs: Date.now() - t0 - 50,
          totalMs: Date.now() - t0,
        },
      } satisfies GenerateResponse & { live: boolean });
    }

    // ------------------------------------------------------------------
    // LIVE MODE: call LTX-2.3 image-to-video extension
    // ------------------------------------------------------------------
    const seedFrame = body.lastFrame ?? "";
    if (!seedFrame) {
      return NextResponse.json({ error: "lastFrame is required in live mode" }, { status: 400 });
    }

    const result = await generateVideoChunk(seedFrame, updatedPrompt);
    if (!result.url) {
      // LTX returned empty — fall back to demo
      return NextResponse.json({
        chunk: {
          id: `chunk_fb_${Date.now()}`,
          url: DEMO_BRANCH_URLS[branch],
          source: "demo",
          prompt: updatedPrompt,
          branch,
          durationSec: 6,
          queuedAt: Date.now(),
        },
        branch,
        updatedPrompt,
        live: false,
        fallback: true,
        timings: {
          queueMs: 0,
          generationMs: Date.now() - t0,
          totalMs: Date.now() - t0,
        },
      });
    }

    return NextResponse.json({
      chunk: {
        id: `chunk_ltx_${Date.now()}`,
        url: result.url,
        source: "ltx23",
        prompt: updatedPrompt,
        branch,
        durationSec: result.durationSec,
        queuedAt: Date.now(),
      },
      branch,
      updatedPrompt,
      live: true,
      timings: {
        queueMs: 0,
        generationMs: Date.now() - t0,
        totalMs: Date.now() - t0,
      },
    } satisfies GenerateResponse & { live: boolean });
  } catch (err) {
    console.error("[generate] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
