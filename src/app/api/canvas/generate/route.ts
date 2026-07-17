/**
 * POST /api/canvas/generate
 *
 * Receives (multipart/form-data):
 *   - action            : JSON-encoded UserAction
 *   - currentBranch     : BranchId string
 *   - lastFrameVideo    : Blob (recent ~2s captured via MediaRecorder)
 *   - lastFrame         : base64 JPEG data URI (seed for Veo hero, Florence-2)
 *   - sceneId           : string
 *
 * Returns (JSON):
 *   { chunk, branch, updatedPrompt, live, fallback, timings }
 *
 * Branch logic:
 *   - summon_operator / branch=veo31  → Veo 3.1 image-to-video (seed: lastFrame)
 *   - everything else                  → LTX-2.3 extend-video (seed: uploaded mp4)
 *
 * In demo mode (no FAL_KEY) we wait briefly to show the slow-mo latency mask,
 * then return the pre-rendered procedural asset for the chosen branch.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  extendVideo,
  generateVeoHero,
  isLiveMode,
  uploadVideoBlob,
} from "@/lib/canvas/fal-client";
import { planBranchForAction } from "@/lib/canvas/orchestrator";
import { rewriteExtendPrompt } from "@/lib/canvas/llm-orchestrator";
import type {
  BranchId,
  GenerateResponse,
  UserAction,
  VideoSource,
} from "@/lib/canvas/types";

export const runtime = "nodejs";
export const maxDuration = 300; // Veo 3.1 / LTX-2.3 can take a few minutes

const DEMO_BRANCH_URLS: Record<BranchId, string> = {
  main: "/canvas/scene_main.mp4",
  alert: "/canvas/branch_alert.mp4",
  reboot: "/canvas/branch_reboot.mp4",
  neutral: "/canvas/branch_neutral.mp4",
  veo31: "/canvas/branch_reboot.mp4", // procedural stand-in
};

const BASE_PROMPT =
  "Cinematic sci-fi server room interior, dark ambiance with cyan accent lighting, " +
  "server racks with blinking LEDs, perspective floor grid, volumetric dust particles, " +
  "film grain, 35mm anamorphic lens, high detail";

const VEO_HERO_BASE_PROMPT =
  "Cinematic sci-fi hero shot of a server room operator responding to a critical fault. " +
  "A uniformed operator enters frame with commanding urgency, emergency red lighting pulses across the room, " +
  "ambient LEDs strobe, volumetric dust, 35mm anamorphic, shallow depth of field, dramatic push-in, film grain. ";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const actionJson = form.get("action");
    const currentBranch = (form.get("currentBranch") as string | null) ?? "main";
    const sceneId = (form.get("sceneId") as string | null) ?? "main";
    const lastFrame = (form.get("lastFrame") as string | null) ?? undefined;
    const lastFrameVideo = form.get("lastFrameVideo") as File | null;

    if (!actionJson) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    let action: UserAction;
    try {
      action = JSON.parse(actionJson as string) as UserAction;
    } catch {
      return NextResponse.json({ error: "action must be valid JSON" }, { status: 400 });
    }

    const t0 = Date.now();

    // ----------------------------------------------------------------
    // Step 2 — LLM rewrite (with deterministic fallback)
    // ----------------------------------------------------------------
    let branch: BranchId;
    let promptSuffix: string;
    let rewriteOk = false;
    if (isLiveMode()) {
      const r = await rewriteExtendPrompt({ action, currentBranch });
      if (r.ok && r.branch && r.promptSuffix) {
        branch = r.branch;
        promptSuffix = r.promptSuffix;
        rewriteOk = true;
      } else {
        const fb = planBranchForAction(action);
        branch = fb.branch;
        promptSuffix = fb.promptSuffix;
      }
    } else {
      const fb = planBranchForAction(action);
      branch = fb.branch;
      promptSuffix = fb.promptSuffix;
    }

    const isHero = branch === "veo31" || action.actionId === "summon_operator";
    const updatedPrompt = isHero
      ? `${VEO_HERO_BASE_PROMPT}${promptSuffix.startsWith(" —") ? promptSuffix : " — " + promptSuffix}`
      : `${BASE_PROMPT}${promptSuffix}`;

    // ----------------------------------------------------------------
    // DEMO MODE: return the pre-rendered procedural asset
    // ----------------------------------------------------------------
    if (!isLiveMode()) {
      // Simulate generation latency to demonstrate the slow-mo masking
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
      const url = DEMO_BRANCH_URLS[branch];
      const source: VideoSource = isHero ? "veo31" : "demo";
      const chunk = {
        id: `chunk_demo_${Date.now()}`,
        url,
        source,
        prompt: updatedPrompt,
        branch,
        durationSec: 6,
        queuedAt: Date.now(),
      };
      return NextResponse.json({
        chunk,
        branch,
        updatedPrompt,
        rewriteOk,
        live: false,
        timings: {
          queueMs: 50,
          generationMs: Date.now() - t0 - 50,
          totalMs: Date.now() - t0,
        },
      } satisfies GenerateResponse & { rewriteOk: boolean; live: boolean });
    }

    // ----------------------------------------------------------------
    // LIVE MODE — Veo 3.1 hero
    // ----------------------------------------------------------------
    if (isHero) {
      if (!lastFrame) {
        return NextResponse.json({ error: "lastFrame is required for Veo hero" }, { status: 400 });
      }
      const r = await generateVeoHero({
        imageUrl: lastFrame,
        prompt: updatedPrompt,
        duration: "8s",
        aspectRatio: "16:9",
        resolution: "720p",
        generateAudio: true,
      });
      if (r.url) {
        return NextResponse.json({
          chunk: {
            id: `chunk_veo_${Date.now()}`,
            url: r.url,
            source: "veo31" as VideoSource,
            prompt: r.prompt,
            branch,
            durationSec: r.durationSec,
            queuedAt: Date.now(),
          },
          branch,
          updatedPrompt,
          rewriteOk,
          live: true,
          timings: {
            queueMs: 0,
            generationMs: Date.now() - t0,
            totalMs: Date.now() - t0,
          },
        } satisfies GenerateResponse & { rewriteOk: boolean; live: boolean });
      }
      // Veo returned empty — fall back to demo clip for this branch
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
        rewriteOk,
        live: false,
        fallback: true,
        timings: { queueMs: 0, generationMs: Date.now() - t0, totalMs: Date.now() - t0 },
      });
    }

    // ----------------------------------------------------------------
    // LIVE MODE — LTX-2.3 extend-video (true video → video)
    // ----------------------------------------------------------------
    if (!lastFrameVideo) {
      return NextResponse.json(
        { error: "lastFrameVideo (mp4 blob) is required for live extend-video" },
        { status: 400 }
      );
    }
    const videoUrl = await uploadVideoBlob(lastFrameVideo);
    if (!videoUrl) {
      // Storage upload failed — fall back to demo clip
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
        rewriteOk,
        live: false,
        fallback: true,
        timings: { queueMs: 0, generationMs: Date.now() - t0, totalMs: Date.now() - t0 },
      });
    }

    const tUpload = Date.now();
    const result = await extendVideo({ videoUrl, prompt: updatedPrompt });
    if (!result.url) {
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
        rewriteOk,
        live: false,
        fallback: true,
        timings: {
          queueMs: tUpload - t0,
          generationMs: Date.now() - tUpload,
          totalMs: Date.now() - t0,
        },
      });
    }

    return NextResponse.json({
      chunk: {
        id: `chunk_ltx_${Date.now()}`,
        url: result.url,
        source: "ltx23" as VideoSource,
        prompt: result.prompt,
        branch,
        durationSec: result.durationSec,
        queuedAt: Date.now(),
      },
      branch,
      updatedPrompt,
      rewriteOk,
      live: true,
      timings: {
        queueMs: tUpload - t0,
        generationMs: Date.now() - tUpload,
        totalMs: Date.now() - t0,
      },
    } satisfies GenerateResponse & { rewriteOk: boolean; live: boolean });
  } catch (err) {
    console.error("[generate] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
