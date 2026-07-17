/**
 * Zustand store for the Turing-Complete Canvas.
 *
 * Holds:
 *   - The double-buffered video queue (primary + secondary)
 *   - The current A2UI surfaces (keyed by surface id)
 *   - The current branch context
 *   - Detection state (hover bbox, last click)
 *   - Latency-masking slow-mo state
 */

import { create } from "zustand";
import type {
  A2UISurface,
  BranchId,
  DetectedObject,
  OrchestrateResponse,
  UserAction,
  VideoChunk,
} from "./types";

// ============================================================================
// Demo asset map (used when FAL_KEY is not set)
// ============================================================================

const DEMO_BRANCH_URLS: Record<BranchId, string> = {
  main: "/canvas/scene_main.mp4",
  alert: "/canvas/branch_alert.mp4",
  reboot: "/canvas/branch_reboot.mp4",
  neutral: "/canvas/branch_neutral.mp4",
  // Veo 3.1 has no procedural fallback; reuse reboot clip so slow-mo + crossfade still demo cleanly.
  veo31: "/canvas/branch_reboot.mp4",
};

// ============================================================================
// Store type
// ============================================================================

interface CanvasState {
  // --- Video buffer state ---
  primaryChunk: VideoChunk | null;
  secondaryChunk: VideoChunk | null; // pre-buffered continuation
  isBuffering: boolean;
  branch: BranchId;

  // --- Detection state ---
  hoverObject: DetectedObject | null;
  lastDetections: DetectedObject[];
  lastClick: { x: number; y: number; t: number } | null;

  // --- A2UI surfaces ---
  surfaces: Record<string, A2UISurface>;

  // --- Latency masking ---
  isSlowMo: boolean;
  slowMoFactor: number; // 1.0 = normal, 0.15 = slow
  pendingBranch: BranchId | null;

  // --- Demo / live mode flag ---
  isLive: boolean;

  // --- Action log (for HUD) ---
  actionLog: Array<{ id: string; t: number; text: string; kind: "info" | "action" | "branch" }>;

  // --- Actions ---
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

export const useCanvasStore = create<CanvasState>((set, get) => ({
  primaryChunk: null,
  secondaryChunk: null,
  isBuffering: false,
  branch: "main",
  hoverObject: null,
  lastDetections: [],
  lastClick: null,
  surfaces: {},
  isSlowMo: false,
  slowMoFactor: 1.0,
  pendingBranch: null,
  isLive: false,
  actionLog: [],

  setLive: (live) => set({ isLive: live }),

  bootMain: () => {
    const chunk: VideoChunk = {
      id: newChunkId(),
      url: DEMO_BRANCH_URLS.main,
      source: "demo",
      prompt: "Procedural server room, ambient operation",
      branch: "main",
      durationSec: 6,
      queuedAt: Date.now(),
    };
    // Pre-buffer neutral continuation (null hypothesis pre-generation strategy)
    const secondary: VideoChunk = {
      ...chunk,
      id: newChunkId(),
      url: DEMO_BRANCH_URLS.neutral,
      branch: "neutral",
    };
    set({
      primaryChunk: chunk,
      secondaryChunk: secondary,
      branch: "main",
      isBuffering: false,
    });
    get().logAction("System booted — main scene streaming", "info");
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
        "info"
      );
    }
  },

  clearSurfaces: () => set({ surfaces: {} }),

  dismissSurface: (surfaceId) => {
    const surfaces = { ...get().surfaces };
    delete surfaces[surfaceId];
    set({ surfaces });
  },

  enterSlowMo: () => set({ isSlowMo: true, slowMoFactor: 0.15 }),
  exitSlowMo: () => set({ isSlowMo: false, slowMoFactor: 1.0 }),

  commitBranch: (branch, videoUrl) => {
    const url = videoUrl ?? DEMO_BRANCH_URLS[branch];
    const chunk: VideoChunk = {
      id: newChunkId(),
      url,
      source: videoUrl ? "ltx23" : "demo",
      prompt: `Branch: ${branch}`,
      branch,
      durationSec: 6,
      queuedAt: Date.now(),
    };
    set({
      primaryChunk: chunk,
      branch,
      isBuffering: false,
      // Pre-buffer the next null hypothesis (neutral continuation)
      secondaryChunk: {
        ...chunk,
        id: newChunkId(),
        url: DEMO_BRANCH_URLS.neutral,
        branch: "neutral",
      },
    });
    get().logAction(`Branch committed → ${branch}`, "branch");
  },

  queueSecondary: (branch, videoUrl) => {
    const url = videoUrl ?? DEMO_BRANCH_URLS[branch];
    const chunk: VideoChunk = {
      id: newChunkId(),
      url,
      source: videoUrl ? "ltx23" : "demo",
      prompt: `Pre-buffered: ${branch}`,
      branch,
      durationSec: 6,
      queuedAt: Date.now(),
    };
    set({ secondaryChunk: chunk });
  },

  promoteSecondary: () => {
    const sec = get().secondaryChunk;
    if (!sec) return;
    set({
      primaryChunk: sec,
      branch: sec.branch,
      // Pre-buffer the next neutral continuation as the new null hypothesis
      secondaryChunk: {
        ...sec,
        id: newChunkId(),
        url: DEMO_BRANCH_URLS.neutral,
        branch: "neutral",
      },
    });
    get().logAction(`Seamless crossfade → ${sec.branch}`, "branch");
  },

  logAction: (text, kind = "info") => {
    const entry = { id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, t: Date.now(), text, kind };
    set({ actionLog: [entry, ...get().actionLog].slice(0, 50) });
  },
}));

export { DEMO_BRANCH_URLS };
