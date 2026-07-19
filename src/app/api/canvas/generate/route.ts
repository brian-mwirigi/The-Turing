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
  resolveExtendSeed,
  skipPromptRewrite,
  skipVeo,
} from "@/lib/canvas/fal-client";
import { planBranchForAction } from "@/lib/canvas/orchestrator";
import {
  assembleExtendPrompt,
  LTX_NEGATIVE_PROMPT,
  VEO_NEGATIVE_PROMPT,
} from "@/lib/canvas/extend-prompts";
import { rewriteExtendPrompt } from "@/lib/canvas/llm-orchestrator";
import { DEMO_BRANCH_URLS } from "@/lib/canvas/store";
import type {
  BranchId,
  GenerateResponse,
  UserAction,
  VideoSource,
} from "@/lib/canvas/types";

export const runtime = "nodejs";
export const maxDuration = 300; // Veo 3.1 / LTX-2.3 can take a few minutes

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const actionJson = form.get("action");
    const currentBranch = (form.get("currentBranch") as string | null) ?? "taking";
    const sceneId = (form.get("sceneId") as string | null) ?? "cutting_room_7";
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
    // FAL_CHEAP / FAL_SKIP_LLM → skip rewrite LLM (saves ~1–3s + tokens)
    if (isLiveMode() && !skipPromptRewrite()) {
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

    const isHero = branch === "summon_operator" || action.actionId === "summon_operator";
    // [action] + [cine base] + [lock] — or full cutaway/hero string.
    const beat = promptSuffix.replace(/^[\s—-]+/, "").trim();
    const updatedPrompt = assembleExtendPrompt(
      beat,
      isHero ? "summon_operator" : branch,
      action.actionId,
    );

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
    // Gate is strict: skipVeo() (FAL_CHEAP / FAL_SKIP_VEO) → never call Veo.
    // Fall through to LTX extend below. No alternate/cheap Veo model id.
    // ----------------------------------------------------------------
    if (isHero) {
      if (skipVeo()) {
        console.log(
          "[generate] summon_operator → LTX path (Veo skipped: FAL_CHEAP / FAL_SKIP_VEO)",
        );
      } else {
        if (!lastFrame) {
          return NextResponse.json(
            { error: "lastFrame is required for Veo hero" },
            { status: 400 },
          );
        }
        const r = await generateVeoHero({
          imageUrl: lastFrame,
          prompt: updatedPrompt,
          negativePrompt: VEO_NEGATIVE_PROMPT,
          duration: "8s",
          aspectRatio: "16:9",
          resolution: "1080p",
          generateAudio: true,
          useFast: false,
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
    }

    // ----------------------------------------------------------------
    // LIVE MODE — LTX extend-video (also used when Veo is skipped)
    // Seed: real MP4 capture when available; else room_loop.mp4 (Chrome
    // MediaRecorder usually emits WebM, which LTX rejects with 422).
    // ----------------------------------------------------------------
    const videoUrl = await resolveExtendSeed(lastFrameVideo);
    if (!videoUrl) {
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
    const isCutaway = branch === "extend_establish";
    const result = await extendVideo({
      videoUrl,
      prompt: updatedPrompt,
      videoStrength: isCutaway ? 0.7 : 0.8,
      enablePromptExpansion: isCutaway,
      negativePrompt: isCutaway
        ? "desk, Steenbeck, typewriter, interior, room, fog blobs"
        : LTX_NEGATIVE_PROMPT,
    });
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
    // Never hard-fail the UI mid-demo — fall back to the ambient loop.
    return NextResponse.json({
      chunk: {
        id: `chunk_fb_${Date.now()}`,
        url: DEMO_BRANCH_URLS.taking,
        source: "demo",
        prompt: "fallback after generate error",
        branch: "taking",
        durationSec: 6,
        queuedAt: Date.now(),
      },
      branch: "taking",
      updatedPrompt: "fallback after generate error",
      live: false,
      fallback: true,
      error: err instanceof Error ? err.message : "unknown error",
      timings: { queueMs: 0, generationMs: 0, totalMs: Date.now() },
    });
  }
}
