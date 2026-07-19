/**
 * Zustand store for the Turing-Complete Canvas.
 *
 * Ambient film is `room_loop.mp4`. Live LTX/Veo cuts override it when generate
 * returns a URL; demo / fallback branches reuse the same ambient loop.
 */

import { create } from "zustand";
import type {
  A2UISurface,
  BranchId,
  DetectedObject,
  OrchestrateResponse,
  SemanticRole,
  VideoChunk,
} from "./types";

/**
 * Map a committed branch → which object role it touched + a short state tag
 * for the next surface-generation call ("clicked film_source, state: burning").
 */
/** Keep tags aligned with `object-state-machine` so phase resolve stays crisp. */
const BRANCH_OBJECT_STATE: Partial<
  Record<BranchId, { role: SemanticRole; state: string }>
> = {
  splice: { role: "film_source", state: "reels_running — splice live, join held" },
  recover: { role: "film_source", state: "ghost_take — reels_running under a second exposure" },
  burn: { role: "film_source", state: "leader_burnt — join lost, smoke in the shaft" },
  roll_take: { role: "camera_asset", state: "take_rolling — spring wound, gate open" },
  cut_take: { role: "camera_asset", state: "lens_capped — stopped after cut" },
  continue_page: { role: "manuscript", state: "page_open — typing, carriage mid-line" },
  scratch_line: { role: "manuscript", state: "page_torn — sheet pulled from the platen" },
  sign_off: { role: "manuscript", state: "note_signed — name at the foot of the page" },
  advance_clock: { role: "artifact_unset", state: "clock_forward — advanced, steam returned" },
  rewind: { role: "artifact_unset", state: "clock_rewound — cold again after fold-back" },
  page_studio: { role: "operator_interface", state: "studio_paged — line ringing" },
  summon_operator: { role: "operator_interface", state: "operator_called — final take queued" },
  warm_grade: { role: "vfx_element", state: "grade_warm — amber afternoon live" },
  cold_grade: { role: "vfx_element", state: "grade_cold — morning-after blue live" },
  bleach_grade: { role: "vfx_element", state: "grade_bleach — silver final-cut look live" },
  extend_establish: { role: "scene_extern", state: "on_the_coast — establishing" },
  cutto_interior: { role: "scene_extern", state: "back_inside — interior" },
};

/** TitlePlate landing plate only — never boot this into FilmGate. */
export const DEMO_INTRO = "/canvas/intro.mp4";

/**
 * Ambient room loop after "click inside the film".
 * Also used as the LTX seed source on disk (`fal-client.uploadRoomLoopSeed`).
 */
export const DEMO_ROOM = "/canvas/room_loop.mp4";

/** @deprecated use DEMO_ROOM */
export const DEMO_VIDEO = DEMO_ROOM;

const BRANCH_IDS = [
  "taking",
  "splice",
  "roll_take",
  "cut_take",
  "continue_page",
  "scratch_line",
  "sign_off",
  "warm_grade",
  "cold_grade",
  "bleach_grade",
  "page_studio",
  "recover",
  "burn",
  "rewind",
  "advance_clock",
  "extend_establish",
  "cutto_interior",
  "summon_operator",
  "neutral",
] as const satisfies readonly BranchId[];

const DEMO_BRANCH_URLS: Record<BranchId, string> = Object.fromEntries(
  BRANCH_IDS.map((id) => [id, DEMO_ROOM]),
) as Record<BranchId, string>;

/** Fire-and-forget warm-up so first generate doesn't pay fal.storage upload tax. */
let _seedTriggered = false;
export function eagerSeedUploadForLive(): void {
  if (_seedTriggered) return;
  _seedTriggered = true;
  try {
    void fetch("/api/canvas/seed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).then(
      (r) => (r.ok ? r.json() : Promise.reject()),
      () => {
        /* swallow */
      },
    );
  } catch {
    /* never throw from boot */
  }
}

interface CanvasState {
  primaryChunk: VideoChunk | null;
  secondaryChunk: VideoChunk | null;
  isBuffering: boolean;
  branch: BranchId;
  hoverObject: DetectedObject | null;
  lastDetections: DetectedObject[];
  lastClick: { x: number; y: number; t: number } | null;
  surfaces: Record<string, A2UISurface>;
  isSlowMo: boolean;
  slowMoFactor: number;
  pendingBranch: BranchId | null;
  isLive: boolean;
  /** Per-role narrative tags written on commitBranch, read by orchestrate. */
  objectStates: Partial<Record<SemanticRole, string>>;
  actionLog: Array<{ id: string; t: number; text: string; kind: "info" | "action" | "branch" }>;

  setLive: (live: boolean) => void;
  bootMain: () => void;
  setHoverObject: (obj: DetectedObject | null) => void;
  registerDetections: (dets: DetectedObject[]) => void;
  applyOrchestration: (resp: OrchestrateResponse) => void;
  clearSurfaces: () => void;
  dismissSurface: (surfaceId: string) => void;
  enterSlowMo: () => void;
  exitSlowMo: () => void;
  commitBranch: (branch: BranchId, videoUrl?: string) => void;
  queueSecondary: (branch: BranchId, videoUrl?: string) => void;
  promoteSecondary: () => void;
  logAction: (text: string, kind?: "info" | "action" | "branch") => void;
}

let _chunkId = 0;
function newChunkId() {
  _chunkId += 1;
  return `chunk_${_chunkId}_${Date.now()}`;
}

function ambientChunk(branch: BranchId, prompt: string): VideoChunk {
  return {
    id: newChunkId(),
    url: DEMO_ROOM,
    source: "demo",
    prompt,
    branch,
    durationSec: 10,
    queuedAt: Date.now(),
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  primaryChunk: null,
  secondaryChunk: null,
  isBuffering: false,
  branch: "taking",
  hoverObject: null,
  lastDetections: [],
  lastClick: null,
  surfaces: {},
  isSlowMo: false,
  slowMoFactor: 1.0,
  pendingBranch: null,
  isLive: false,
  objectStates: {},
  actionLog: [],

  setLive: (live) => set({ isLive: live }),

  bootMain: () => {
    const chunk = ambientChunk(
      "taking",
      "16mm cutting room, ambient motion, dust, light shaft — the room waiting",
    );
    set({
      primaryChunk: chunk,
      secondaryChunk: ambientChunk("neutral", "ambient continuation"),
      branch: "taking",
      isBuffering: false,
      objectStates: {},
    });
    get().logAction("Cutting room opened · the room is waiting for you", "info");
    eagerSeedUploadForLive();
  },

  setHoverObject: (obj) => set({ hoverObject: obj }),

  registerDetections: (dets) => set({ lastDetections: dets }),

  applyOrchestration: (resp) => {
    const ops = resp.a2ui.operations;
    const surfaces = { ...get().surfaces };
    for (const op of ops) {
      if (op.kind === "create_surface") {
        surfaces[op.surface.id] = op.surface;
      } else if (op.kind === "update_surface") {
        if (surfaces[op.surfaceId]) {
          surfaces[op.surfaceId] = { ...surfaces[op.surfaceId], ...op.patch };
        }
      } else if (op.kind === "delete_surface") {
        delete surfaces[op.surfaceId];
      } else if (op.kind === "clear") {
        for (const k of Object.keys(surfaces)) delete surfaces[k];
      }
    }
    set({ surfaces });
    if (resp.detectedObject) {
      get().logAction(
        `Clicked: ${resp.detectedObject.label} (${resp.detectedObject.semanticRole})`,
        "info",
      );
    }
  },

  clearSurfaces: () => set({ surfaces: {} }),

  dismissSurface: (surfaceId) => {
    const surfaces = { ...get().surfaces };
    delete surfaces[surfaceId];
    set({ surfaces });
  },

  enterSlowMo: () => set({ isSlowMo: true, slowMoFactor: 0.35 }),
  exitSlowMo: () => set({ isSlowMo: false, slowMoFactor: 1.0 }),

  commitBranch: (branch, videoUrl) => {
    const url = videoUrl ?? DEMO_BRANCH_URLS[branch];
    const isLive = Boolean(videoUrl);
    const chunk: VideoChunk = {
      id: newChunkId(),
      url,
      source: isLive ? "ltx23" : "demo",
      prompt: `Branch: ${branch}`,
      branch,
      durationSec: 6,
      queuedAt: Date.now(),
      rate: isLive ? 1.0 : undefined,
    };
    // Stamp per-object narrative state so the next slate isn't a static menu.
    const stamp = BRANCH_OBJECT_STATE[branch];
    const objectStates = stamp
      ? { ...get().objectStates, [stamp.role]: stamp.state }
      : get().objectStates;
    set({
      primaryChunk: chunk,
      branch,
      isBuffering: false,
      objectStates,
      // Live: FilmGate wraps the generated tail. Demo: keep ambient looping.
      secondaryChunk: isLive
        ? null
        : ambientChunk("neutral", "ambient continuation"),
    });
    get().logAction(
      isLive ? `Branch committed → ${branch} (live cut)` : `Branch committed → ${branch}`,
      "branch",
    );
  },

  queueSecondary: (branch, videoUrl) => {
    const chunk: VideoChunk = videoUrl
      ? {
          id: newChunkId(),
          url: videoUrl,
          source: "ltx23",
          prompt: `Pre-buffered: ${branch}`,
          branch,
          durationSec: 6,
          queuedAt: Date.now(),
          rate: 1.0,
        }
      : ambientChunk(branch, `Pre-buffered: ${branch}`);
    set({ secondaryChunk: chunk });
  },

  promoteSecondary: () => {
    const sec = get().secondaryChunk;
    if (!sec) return;
    set({
      primaryChunk: sec,
      branch: sec.branch,
      secondaryChunk: ambientChunk("neutral", "ambient continuation"),
    });
    get().logAction(`Seamless crossfade → ${sec.branch}`, "branch");
  },

  logAction: (text, kind = "info") => {
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      t: Date.now(),
      text,
      kind,
    };
    set({ actionLog: [entry, ...get().actionLog].slice(0, 50) });
  },
}));

export { DEMO_BRANCH_URLS };
