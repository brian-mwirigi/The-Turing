/**
 * gen-demo-clips.ts — SEQUENTIAL chained extend through the pitch-reel arc.
 *
 * Continuity rule (the whole point of extend-video):
 *   seed = room_seed.mp4          // clip 1 only
 *   for each action in PITCH_DEMO_CLIPS:
 *     result = extend(seed, prompt)
 *     save(result)
 *     seed = result               // <-- next input is this output
 *
 * ONE intentional chain break (hard scene cut):
 *   rewind → extend_establish  (seed = rewind; cutaway to Pacific)
 *   cutto_interior             (seed = rewind again — NOT Pacific)
 *     LTX has end_image_url, but that morphs coast→room; for a hard cut
 *     we re-seed from the last interior instead. Forgivable: already a cut.
 *   page_studio ← cutto_interior output (chain resumes)
 *
 * Never parallelize. Never seed every clip from room_seed.
 *
 * Usage (FAL_CHEAP must be OFF):
 *   bun run gen:demo -- --test3              # clips 1–3 — verify chaining
 *   bun run gen:demo -- --chain              # resume from chain-state.json (or start)
 *   bun run gen:demo -- --chain --restart    # force full arc from advance_clock
 *   bun run gen:demo -- --chain --from splice  # explicit resume at splice
 *   bun run gen:demo -- advance_clock        # single step (seed = prior arc clip or room)
 *
 * Output:
 *   public/canvas/demo/<id>.mp4
 *   public/canvas/demo/room_ref_before_cutaway.jpg  # last frame of rewind
 *   public/canvas/demo/session-log.jsonl
 *   public/canvas/demo/manifest.json
 *   public/canvas/demo/chain-state.json
 */

import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fal } from "@fal-ai/client";
import {
  extendVideo,
  generateVeoHero,
  isCheapMode,
  isLiveMode,
  skipVeo,
  uploadRoomLoopSeed,
  uploadVideoBlob,
} from "../src/lib/canvas/fal-client";
import { planBranchForAction } from "../src/lib/canvas/orchestrator";
import {
  assembleExtendPrompt,
  LTX_NEGATIVE_PROMPT,
  VEO_NEGATIVE_PROMPT,
} from "../src/lib/canvas/extend-prompts";
import { PITCH_DEMO_CLIPS, PITCH_REEL } from "../src/lib/canvas/pitch-reel";
import type { UserAction } from "../src/lib/canvas/types";

const execFileAsync = promisify(execFile);

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
const OUT_DIR = path.join(process.cwd(), "public", "canvas", "demo");
/** Full fal stitch (seed+tail) — used when resuming the chain. */
const CHAIN_DIR = path.join(OUT_DIR, "chain");
const LOG_PATH = path.join(OUT_DIR, "session-log.jsonl");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");
const CHAIN_STATE_PATH = path.join(OUT_DIR, "chain-state.json");

/**
 * fal extend returns prior seed + ~3s new motion. Watching from t=0 looks "hung".
 * Preview files keep only the new beat (+ tiny overlap).
 */
const PREVIEW_TAIL_SEC = 4.2;

/** Pitch-reel order = generation order. */
const ARC = PITCH_DEMO_CLIPS;

/** Last interior before Pacific cutaway — cutto_interior re-seeds from here. */
const LAST_INTERIOR_ID = "rewind";
const CUTAWAY_ID = "extend_establish";
const CUTBACK_ID = "cutto_interior";
const ROOM_REF_PATH = path.join(
  process.cwd(),
  "public",
  "canvas",
  "demo",
  "room_ref_before_cutaway.jpg",
);

async function logEvent(event: Record<string, unknown>) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + "\n";
  await appendFile(LOG_PATH, line, "utf8");
  console.log(`[log] ${event.kind ?? "event"} → ${event.id ?? ""}`);
}

async function downloadMp4(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed HTTP ${res.status}`);
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  await writeFile(dest, buf);
  return buf.length;
}

/** Write preview = last PREVIEW_TAIL_SEC of full stitch (where the effect actually is). */
async function writePreviewTail(fullPath: string, previewPath: string) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-sseof",
    `-${PREVIEW_TAIL_SEC}`,
    "-i",
    fullPath,
    "-c",
    "copy",
    previewPath,
  ]);
}

function buildPrompt(actionId: string): { branch: string; prompt: string; hero: boolean } {
  const action: UserAction = {
    actionId,
    label: actionId,
    semanticRole: "unknown",
  };
  const { branch, promptSuffix } = planBranchForAction(action);
  const beat = promptSuffix.replace(/^[\s—-]+/, "").trim();
  const hero = actionId === "summon_operator" || branch === "summon_operator";
  const prompt = assembleExtendPrompt(
    beat,
    hero ? "summon_operator" : branch,
    actionId,
  );
  return { branch, prompt, hero };
}

/** Upload a local mp4 so it can seed the next extend. */
async function uploadLocalMp4(localPath: string): Promise<string> {
  const buf = await readFile(localPath);
  const blob = new Blob([buf], { type: "video/mp4" });
  const url = await uploadVideoBlob(blob);
  if (!url) throw new Error(`upload failed: ${localPath}`);
  console.log(
    `[gen:demo] uploaded local seed ${path.basename(localPath)} → ${url.slice(0, 72)}…`,
  );
  return url;
}

/** Extract last frame of a local mp4 to `dest` (JPEG). */
async function extractLastFrame(videoPath: string, dest: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-sseof",
    "-0.3",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    dest,
  ]);
}

/** Last frame of previous clip → Veo image seed (continuity into hero). */
async function uploadLastFrameAsImage(videoPath: string): Promise<string> {
  const tmp = path.join(OUT_DIR, `_veo_seed_${Date.now()}.jpg`);
  await extractLastFrame(videoPath, tmp);
  const buf = await readFile(tmp);
  const file = new File([buf], "veo-chain-seed.jpg", { type: "image/jpeg" });
  const url = await fal.storage.upload(file);
  console.log(
    `[gen:demo] Veo seed frame from ${path.basename(videoPath)} → ${url.slice(0, 72)}…`,
  );
  return url;
}

/** Save last-interior still for cutback / edit reference. */
async function saveRoomRefBeforeCutaway(videoPath: string): Promise<void> {
  await extractLastFrame(videoPath, ROOM_REF_PATH);
  console.log(`[gen:demo] saved room ref (pre-cutaway) → ${ROOM_REF_PATH}`);
}

async function saveChainState(state: Record<string, unknown>) {
  await writeFile(CHAIN_STATE_PATH, JSON.stringify(state, null, 2));
}

async function generateOne(
  actionId: string,
  seedVideoUrl: string,
  prevLocalPath: string | null,
): Promise<{ actionId: string; branch: string; hero: boolean; falUrl: string; localPath: string; ms: number; seedUsed: string }> {
  const { branch, prompt, hero } = buildPrompt(actionId);
  const chainFile = path.join(CHAIN_DIR, `${actionId}.mp4`);
  const previewFile = path.join(OUT_DIR, `${actionId}.mp4`);
  console.log("\n════════════════════════════════════════");
  console.log(
    `[gen:demo] CHAIN → ${actionId} (branch=${branch}${hero ? ", Veo" : ", LTX"})`,
  );
  console.log(`[gen:demo] seed ← ${seedVideoUrl.slice(0, 88)}…`);
  console.log("════════════════════════════════════════");

  await logEvent({
    kind: "submit",
    id: actionId,
    branch,
    hero,
    prompt,
    seedVideoUrl,
    chained: true,
  });

  const t0 = Date.now();
  let falUrl = "";

  if (hero) {
    if (skipVeo()) {
      throw new Error("Veo blocked — unset FAL_CHEAP / FAL_SKIP_VEO for hero");
    }
    // Continuity: last frame of prior clip, not the static poster.
    if (!prevLocalPath || !existsSync(prevLocalPath)) {
      throw new Error("summon_operator needs previous chained clip on disk for Veo seed frame");
    }
    const imageUrl = await uploadLastFrameAsImage(prevLocalPath);
    const result = await generateVeoHero({
      imageUrl,
      prompt,
      negativePrompt: VEO_NEGATIVE_PROMPT,
      duration: "8s",
      aspectRatio: "16:9",
      resolution: "1080p",
      generateAudio: true,
      useFast: false,
    });
    falUrl = result.url;
  } else {
    const isCutaway = actionId === CUTAWAY_ID;
    const result = await extendVideo({
      videoUrl: seedVideoUrl,
      prompt,
      // Cutaway must leave the room; everything else must not invent a new one.
      videoStrength: isCutaway ? 0.7 : 0.96,
      enablePromptExpansion: isCutaway,
      negativePrompt: isCutaway
        ? "desk, Steenbeck, typewriter, interior, room, fog blobs"
        : LTX_NEGATIVE_PROMPT,
    });
    falUrl = result.url;
  }

  const ms = Date.now() - t0;
  if (!falUrl) {
    await logEvent({ kind: "fail", id: actionId, branch, ms, error: "empty url" });
    throw new Error(`${actionId}: fal returned empty url`);
  }

  await mkdir(CHAIN_DIR, { recursive: true });
  const bytes = await downloadMp4(falUrl, chainFile);
  // Veo is already a self-contained beat — no seed-head hang. LTX needs a tail trim.
  if (hero) {
    await writeFile(previewFile, await readFile(chainFile));
  } else {
    await writePreviewTail(chainFile, previewFile);
  }
  const previewBytes = (await readFile(previewFile)).length;
  await logEvent({
    kind: "ok",
    id: actionId,
    branch,
    hero,
    ms,
    bytes,
    previewBytes,
    falUrl,
    seedVideoUrl,
    localPath: `public/canvas/demo/${actionId}.mp4`,
    chainPath: `public/canvas/demo/chain/${actionId}.mp4`,
    chained: true,
  });
  console.log(
    `[gen:demo] wrote chain ${path.basename(chainFile)} (${(bytes / 1024).toFixed(0)} KiB) in ${(ms / 1000).toFixed(1)}s`,
  );
  console.log(
    `[gen:demo] preview (last ${PREVIEW_TAIL_SEC}s) → ${path.basename(previewFile)} — watch THIS, not the hung seed head`,
  );
  console.log(`[gen:demo] next seed ← this fal output`);
  return {
    actionId,
    branch,
    hero,
    falUrl,
    localPath: chainFile, // resume / room-ref always use full stitch
    previewPath: previewFile,
    ms,
    seedUsed: seedVideoUrl,
  };
}

function printArcStatus() {
  for (const b of PITCH_REEL) {
    const mark = existsSync(path.join(OUT_DIR, `${b.actionId}.mp4`)) ? "✓" : "·";
    console.error(
      `  ${mark} ${String(b.n).padStart(2)}. ${b.actionId.padEnd(18)} ${b.vo ?? "—silence—"}  [${b.hold}]`,
    );
  }
}

async function run() {
  if (!FAL_KEY) {
    console.error("[gen:demo] FAL_KEY required");
    process.exit(1);
  }
  if (!isLiveMode()) {
    console.error("[gen:demo] not in live mode");
    process.exit(1);
  }
  if (isCheapMode()) {
    console.error(
      "[gen:demo] FAL_CHEAP is on — comment it out in .env for full-quality pitch clips, then re-run.",
    );
    process.exit(1);
  }

  fal.config({ credentials: FAL_KEY });
  await mkdir(OUT_DIR, { recursive: true });

  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const wantTest3 = argv.includes("--test3");
  const wantRestart = argv.includes("--restart");
  const wantChain = argv.includes("--chain") || wantTest3;
  const fromIdx = argv.indexOf("--from");
  const fromId = fromIdx >= 0 ? argv[fromIdx + 1] : undefined;
  const ids = argv.filter(
    (a, i) =>
      !a.startsWith("--") &&
      !(fromIdx >= 0 && (i === fromIdx || i === fromIdx + 1)),
  );

  if (!wantChain && ids.length === 0) {
    console.error("[gen:demo] SEQUENTIAL CHAIN mode — arc order = generation order");
    console.error("  bun run gen:demo -- --test3             # clips 1–3, verify continuity");
    console.error("  bun run gen:demo -- --chain             # resume from chain-state (safe)");
    console.error("  bun run gen:demo -- --chain --restart   # redo full arc from clip 1");
    console.error("  bun run gen:demo -- --chain --from splice");
    console.error("  bun run gen:demo -- advance_clock       # single step (seeds from prior)");
    console.error("");
    printArcStatus();
    process.exit(1);
  }

  // Resolve queue in ARC order (never shuffle).
  let queue: string[];
  if (wantTest3) {
    queue = ARC.slice(0, 3); // advance_clock → roll_take → continue_page
  } else if (wantChain) {
    let start = 0;
    if (fromId) {
      const i = ARC.indexOf(fromId as (typeof ARC)[number]);
      if (i < 0) {
        console.error(`[gen:demo] --from ${fromId} not in arc`);
        process.exit(1);
      }
      // Resume AT fromId (regenerate it and everything after)
      start = i;
    } else if (!wantRestart && existsSync(CHAIN_STATE_PATH)) {
      // Default --chain: resume AFTER last successful chained beat (don't burn credits).
      try {
        const st = JSON.parse(await readFile(CHAIN_STATE_PATH, "utf8")) as {
          lastActionId?: string;
          index?: number;
        };
        const last = st.lastActionId ?? "";
        const li = ARC.indexOf(last as (typeof ARC)[number]);
        if (li >= 0 && li < ARC.length - 1) {
          start = li + 1;
          console.log(
            `[gen:demo] resuming after ${last} (chain-state) → next is ${ARC[start]}`,
          );
          console.log(
            `[gen:demo] (use --restart to redo from advance_clock, or --from ${last} to regen ${last}+)`,
          );
        } else if (li === ARC.length - 1) {
          console.log("[gen:demo] chain-state says arc complete — nothing to do");
          console.log("  use --restart to regenerate the full chain");
          process.exit(0);
        }
      } catch {
        /* ignore bad state; start from 0 */
      }
    }
    queue = ARC.slice(start);
  } else {
    // Single id — must be in arc; run just that step with prior as seed
    const id = ids[0]!;
    if (!ARC.includes(id as (typeof ARC)[number])) {
      console.error(`[gen:demo] ${id} not in pitch arc`);
      process.exit(1);
    }
    queue = [id];
  }

  console.log(`[gen:demo] CHAINED queue (${queue.length}): ${queue.join(" → ")}`);
  console.log(`[gen:demo] each seed = previous fal output (clip 1 = room_seed)`);
  console.log(
    `[gen:demo] cutback exception: ${CUTBACK_ID} re-seeds from ${LAST_INTERIOR_ID}, not ${CUTAWAY_ID}`,
  );
  console.log(`[gen:demo] log: ${LOG_PATH}`);

  await logEvent({ kind: "session_start", queue, mode: "chain" });

  // Bootstrap seed for the first item in the queue.
  const firstId = queue[0]!;
  const firstArcIndex = ARC.indexOf(firstId as (typeof ARC)[number]);
  let seedVideoUrl: string;
  let prevLocalPath: string | null = null;

  /** Held across the Pacific cutaway so cutto_interior can re-enter the real room. */
  let lastInteriorFalUrl: string | null = null;
  let lastInteriorLocalPath: string | null = null;

  if (firstArcIndex <= 0) {
    console.log("[gen:demo] uploading room_seed (arc start)…");
    seedVideoUrl = await uploadRoomLoopSeed();
    if (!seedVideoUrl) {
      console.error("[gen:demo] room seed upload failed");
      process.exit(1);
    }
  } else {
    // Special resume: cutto_interior must seed from rewind, not extend_establish.
    const priorId =
      firstId === CUTBACK_ID
        ? LAST_INTERIOR_ID
        : ARC[firstArcIndex - 1]!;
    const priorChain = path.join(CHAIN_DIR, `${priorId}.mp4`);
    const priorPreview = path.join(OUT_DIR, `${priorId}.mp4`);
    const priorPath = existsSync(priorChain) ? priorChain : priorPreview;
    if (!existsSync(priorPath)) {
      console.error(
        `[gen:demo] cannot start at ${firstId} — missing prior clip ${priorId}.mp4`,
      );
      console.error("  run earlier beats first, or start from --test3 / beginning");
      process.exit(1);
    }
    console.log(
      `[gen:demo] resume: seed from ${path.relative(process.cwd(), priorPath)} (full stitch preferred)`,
    );
    seedVideoUrl = await uploadLocalMp4(priorPath);
    prevLocalPath = priorPath;
    if (priorId === LAST_INTERIOR_ID || firstId === CUTBACK_ID) {
      lastInteriorFalUrl = seedVideoUrl;
      lastInteriorLocalPath = priorPath;
    }
  }

  // If we already have rewind on disk (resume mid-arc past it), preload interior hold.
  const rewindPath = path.join(OUT_DIR, `${LAST_INTERIOR_ID}.mp4`);
  if (!lastInteriorFalUrl && existsSync(rewindPath) && firstArcIndex > ARC.indexOf(LAST_INTERIOR_ID)) {
    lastInteriorLocalPath = rewindPath;
    lastInteriorFalUrl = await uploadLocalMp4(rewindPath);
    console.log(`[gen:demo] preloaded last-interior hold from ${LAST_INTERIOR_ID}.mp4`);
  }

  await logEvent({ kind: "seed", falUrl: seedVideoUrl, forAction: firstId });

  const manifest: Array<Record<string, unknown>> = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    try {
      // Hard-cut exception: never seed the cutback from the Pacific clip.
      let stepSeed = seedVideoUrl;
      let stepPrevLocal = prevLocalPath;
      if (id === CUTBACK_ID) {
        if (!lastInteriorFalUrl || !lastInteriorLocalPath) {
          throw new Error(
            `${CUTBACK_ID} needs ${LAST_INTERIOR_ID} fal/local hold — run through rewind first`,
          );
        }
        stepSeed = lastInteriorFalUrl;
        stepPrevLocal = lastInteriorLocalPath;
        console.log(
          `[gen:demo] CUTBACK: seeding from last interior (${LAST_INTERIOR_ID}), not ${CUTAWAY_ID}`,
        );
      }

      const entry = await generateOne(id, stepSeed, stepPrevLocal);
      manifest.push({
        ...entry,
        seedException: id === CUTBACK_ID ? "last_interior" : undefined,
      });

      // Hold room state at the last interior before cutaway.
      if (id === LAST_INTERIOR_ID) {
        lastInteriorFalUrl = entry.falUrl;
        lastInteriorLocalPath = entry.localPath;
        await saveRoomRefBeforeCutaway(entry.localPath);
        await logEvent({
          kind: "room_ref",
          id,
          falUrl: lastInteriorFalUrl,
          localStill: "public/canvas/demo/room_ref_before_cutaway.jpg",
        });
      }

      // Thread output → next input (cutaway still updates seed so logs stay honest;
      // cutback ignores it and uses lastInterior*).
      seedVideoUrl = entry.falUrl;
      prevLocalPath = entry.localPath;

      await saveChainState({
        lastActionId: id,
        lastFalUrl: seedVideoUrl,
        lastInteriorFalUrl,
        lastInteriorId: LAST_INTERIOR_ID,
        index: ARC.indexOf(id as (typeof ARC)[number]),
      });

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[gen:demo] ${id} FAILED — chain STOPPED (downstream would be wrong seed):`, msg);
      await logEvent({ kind: "fail", id, error: msg, chainStopped: true });
      await writeFile(
        MANIFEST_PATH,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            mode: "chain",
            abortedAt: id,
            clips: manifest,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
  }

  await writeFile(
    MANIFEST_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), mode: "chain", clips: manifest },
      null,
      2,
    ),
  );
  await logEvent({ kind: "session_end", ok: manifest.length, total: queue.length, mode: "chain" });
  console.log(`\n[gen:demo] chained done — ${manifest.length}/${queue.length}`);
  console.log(`[gen:demo] manifest: ${MANIFEST_PATH}`);
  if (wantTest3) {
    console.log(
      "[gen:demo] TEST3 complete — watch advance_clock → roll_take → continue_page.",
    );
    console.log(
      "  If clip 3 shows effects of 1+2, run: bun run gen:demo -- --chain --from splice",
    );
    console.log("  (or --chain from the start to redo the full arc)");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
