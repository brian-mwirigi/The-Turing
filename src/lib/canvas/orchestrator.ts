/**
 * Orchestrator: deterministic fallback paths for the LLM-driven pipeline.
 *
 * The primary orchestration path is now LLM-authored (see `llm-orchestrator.ts`):
 * the LLM emits an A2UI surface for a clicked object and rewrites the
 * extend-video prompt for the user's chosen action.
 *
 * This module plays two roles:
 *   1. Pure geometry: hit-test detections, return the object under the click,
 *      and (when called) produce the A2UI message from a *given* surface spec.
 *      This is model-agnostic and always runs.
 *   2. Deterministic fallback: `SURFACE_CATALOG` (when the LLM call fails) and
 *      `planBranchForAction` (when the LLM rewrite fails). These guarantee
 *      the demo always works even without `FAL_KEY`.
 *
 * The catalog is trivially extensible: add a new role → add a new entry.
 */

import type {
  A2UIComponent,
  A2UIMessage,
  A2UIOperation,
  A2UISurface,
  BranchId,
  DetectedObject,
  OrchestrateRequest,
  OrchestrateResponse,
  SemanticRole,
  UserAction,
} from "./types";
import {
  getStaticAction,
  injectStaticActionFirst,
  injectStaticActionLast,
  resolveObjectPhase,
} from "./object-state-machine";

// ============================================================================
// Component builders
// ============================================================================

function panel(id: string, children: A2UIComponent[], props: Record<string, unknown> = {}): A2UIComponent {
  return { id, type: "panel", children, props };
}
function header(id: string, text: string): A2UIComponent {
  return { id, type: "header", props: { text } };
}
function text(id: string, content: string): A2UIComponent {
  return { id, type: "text", props: { content } };
}
function metric(id: string, label: string, value: string, status: "ok" | "warn" | "crit" = "ok"): A2UIComponent {
  return { id, type: "metric", props: { label, value, status } };
}
function button(id: string, label: string, actionId: string, variant: "primary" | "danger" | "ghost" = "primary"): A2UIComponent {
  return { id, type: "button", props: { label, actionId, variant } };
}
function toggle(id: string, label: string, defaultOn: boolean): A2UIComponent {
  return { id, type: "toggle", props: { label, defaultOn } };
}
function alert(id: string, level: "info" | "warn" | "crit", message: string): A2UIComponent {
  return { id, type: "alert", props: { level, message } };
}
function divider(id: string): A2UIComponent {
  return { id, type: "divider" };
}
function code(id: string, content: string): A2UIComponent {
  return { id, type: "code", props: { content } };
}

// ============================================================================
// Surface catalog (per semantic role) — fallback when LLM surface gen fails
// ============================================================================

export interface SurfaceSpec {
  semanticRole: SemanticRole;
  reason: string;
  build: (obj: DetectedObject, branch: BranchId) => A2UIComponent;
  suggestedBranch?: BranchId;
}

function branchIs(branch: BranchId, ...ids: BranchId[]) {
  return ids.includes(branch);
}

/** Catalog surfaces that change copy + actions with the live branch state. */
export const SURFACE_CATALOG: Record<SemanticRole, SurfaceSpec> = {
  film_source: {
    semanticRole: "film_source",
    reason: "16mm flatbed — slate tracks whether the reels are still or already cut.",
    suggestedBranch: "splice",
    build: (obj, branch) => {
      const running = branchIs(branch, "splice", "recover");
      const burnt = branch === "burn";
      return panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // ${running ? "REELS RUNNING" : burnt ? "LEADER BURNT" : "SPLICE DECK"}`),
        text(
          "t1",
          running
            ? "Reel A and B are joined. The flatbed is turning. The cut is live."
            : burnt
              ? "The leader is ash at the edge. The join did not hold."
              : "Reel A · take seven. Reel B · the one she never cut.",
        ),
        divider("d1"),
        metric("m_foot", "Footage on bench", "21 ft", "ok"),
        metric("m_lead", "Leader hanging", burnt ? "burnt" : running ? "through gate" : "yes", burnt ? "crit" : "warn"),
        metric("m_join", "Join ready", running ? "live" : burnt ? "lost" : "no", running ? "ok" : "warn"),
        divider("d2"),
        ...(running
          ? [
              alert("a1", "info", "The splice already landed. Choose how the cut continues."),
              divider("d3"),
              button("b_recover", "Pull another lost take under", "recover", "primary"),
              button("b_burn", "Burn the join", "burn", "danger"),
              button("b_splice", "Tighten the splice again", "splice", "ghost"),
            ]
          : burnt
            ? [
                alert("a1", "crit", "Smoke still hangs in the shaft. Recover or rejoin."),
                divider("d3"),
                button("b_recover", "Recover what survived", "recover", "primary"),
                button("b_splice", "Rejoin the reels", "splice", "ghost"),
              ]
            : [
                alert("a1", "warn", "The room pauses the moment you touch the splice."),
                divider("d3"),
                text("t2", "Pick the edit she would not let herself make:"),
                button("b_splice", "Splice reel B onto reel A", "splice", "primary"),
                button("b_recover", "Recover the lost take", "recover", "ghost"),
                button("b_burn", "Burn the leader", "burn", "danger"),
              ]),
      ]);
    },
  },
  camera_asset: {
    semanticRole: "camera_asset",
    reason: "Bolex — slate tracks spring wind / take state.",
    suggestedBranch: "roll_take",
    build: (obj, branch) => {
      const rolling = branch === "roll_take";
      const capped = branch === "cut_take";
      return panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // ${rolling ? "TAKE ROLLING" : capped ? "LENS CAPPED" : "TAKE CONTROL"}`),
        text(
          "t1",
          rolling
            ? "Spring is wound. The gate is open. You are inside the take."
            : capped
              ? "Lens cap is back on. The room has gone quiet again."
              : "H16 with the 25mm. The wind spring is not wound. You can wind it now.",
        ),
        divider("d1"),
        metric("m_spring", "Spring wind", rolling ? "full" : "0 turns", rolling ? "ok" : "warn"),
        metric("m_tfr", "Footage remaining", rolling ? "92 ft" : "100 ft", "ok"),
        metric("m_fps", "Framing rate", "24 fps", "ok"),
        divider("d2"),
        ...(rolling
          ? [
              button("b_cut", "Snap the lens cap · cut the take", "cut_take", "primary"),
              button("b_reframe", "Reframe on the door", "reframe", "ghost"),
              button("b_roll", "Keep the spring wound", "roll_take", "ghost"),
            ]
          : [
              button("b_roll", "Wind the spring · roll the take", "roll_take", "primary"),
              button("b_cut", "Snap the lens cap back on", "cut_take", "ghost"),
              button("b_reframe", "Reframe the Bolex on the door", "reframe", "primary"),
            ]),
      ]);
    },
  },
  manuscript: {
    semanticRole: "manuscript",
    reason: "Typewriter — slate tracks whether the page has moved.",
    suggestedBranch: "continue_page",
    build: (obj, branch) => {
      const written = branchIs(branch, "continue_page", "scratch_line");
      const signed = branch === "sign_off";
      return panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // ${signed ? "NOTE SIGNED" : written ? "PAGE OPEN" : "NOTE EDITOR"}`),
        alert(
          "a1",
          "info",
          signed
            ? "Her name is at the foot of the page. The carriage is home."
            : written
              ? "A new line sits mid-page. The carriage waits one space over."
              : "Last line: \"and the room was left as it was, un—\"",
        ),
        divider("d1"),
        text(
          "t1",
          signed
            ? "Leave it, or keep writing past the sign-off."
            : written
              ? "Continue her voice, scratch the last word, or sign it."
              : "Finish the line she didn't. Voice it the way she'd have.",
        ),
        divider("d2"),
        button("b_continue", written ? "Write the next line" : "Return the carriage · write a line", "continue_page", "primary"),
        button("b_scratch", "Scratch the line", "scratch_line", "ghost"),
        button("b_signoff", signed ? "Leave the signed page" : "Sign off the note", "sign_off", signed ? "ghost" : "primary"),
      ]);
    },
  },
  artifact_unset: {
    semanticRole: "artifact_unset",
    reason: "Coffee mug — the room's only clock.",
    suggestedBranch: "advance_clock",
    build: (obj, branch) => {
      const advanced = branch === "advance_clock";
      const rewound = branch === "rewind";
      return panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // ${advanced ? "CLOCK FORWARD" : rewound ? "CLOCK REWOUND" : "DESK CLOCK"}`),
        text(
          "t1",
          advanced
            ? "Steam again. The ring stain deepened. The room nodded forward."
            : rewound
              ? "Heat returned to the mug. The last few seconds unspooled."
              : "No steam on the surface. The ring stain says three days.",
        ),
        divider("d1"),
        metric("m_temp", "Coffee temperature", advanced ? "62 °C" : rewound ? "58 °C" : "11.4 °C", advanced || rewound ? "ok" : "warn"),
        metric("m_age", "Time since last pour", advanced ? "moments" : "72h", advanced ? "ok" : "warn"),
        metric("m_dust", "Dust film", "thin", "ok"),
        divider("d2"),
        button("b_advance", advanced ? "Pour another day forward" : "Advance the clock · pour the next cup", "advance_clock", "primary"),
        button("b_rewind", "Rewind the clock · warm it back", "rewind", "ghost"),
      ]);
    },
  },
  operator_interface: {
    semanticRole: "operator_interface",
    reason: "Intercom — paging vs summon state.",
    suggestedBranch: "page_studio",
    build: (obj, branch) => {
      const paged = branch === "page_studio";
      const summoned = branch === "summon_operator";
      return panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // ${summoned ? "OPERATOR CALLED" : paged ? "STUDIO PAGED" : "STUDIO DESK"}`),
        text(
          "t1",
          summoned
            ? "The final take is queued. The door is the next frame."
            : paged
              ? "The line clicked once. No voice came back — yet."
              : "The line is open to the study at the far end of the corridor.",
        ),
        divider("d1"),
        metric("m_line", "Line status", summoned ? "answered" : paged ? "ringing" : "open · held", "ok"),
        metric("m_ack", "Reply heard", summoned ? "yes" : "no", summoned ? "ok" : "warn"),
        divider("d2"),
        alert("a1", "warn", summoned ? "She is already on her way." : "Paging the studio will call her. Once per run."),
        divider("d3"),
        button("b_page", paged ? "Page again" : "Page the studio", "page_studio", summoned ? "ghost" : "primary"),
        button("b_summon", summoned ? "Hold for her entrance" : "Summon the operator · final take", "summon_operator", "danger"),
      ]);
    },
  },
  vfx_element: {
    semanticRole: "vfx_element",
    reason: "Light shaft — current grade is the live look.",
    suggestedBranch: "warm_grade",
    build: (obj, branch) => {
      const grade =
        branch === "warm_grade"
          ? "WARM"
          : branch === "cold_grade"
            ? "COLD"
            : branch === "bleach_grade"
              ? "BLEACH"
              : "GRADE";
      const kelvin =
        branch === "warm_grade" ? "3200 K" : branch === "cold_grade" ? "7200 K" : branch === "bleach_grade" ? "silver" : "5600 K";
      return panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // ${grade} DESK`),
        text(
          "t1",
          branchIs(branch, "warm_grade", "cold_grade", "bleach_grade")
            ? `Live grade: ${grade.toLowerCase()}. The whole reel is wearing it.`
            : "The whole reel inherits whatever grade you settle on.",
        ),
        divider("d1"),
        metric("m_kelvin", "Colour temperature", kelvin, "ok"),
        metric("m_grain", "Grain", "16mm · ISO 250", "ok"),
        divider("d2"),
        button("b_warm", branch === "warm_grade" ? "Hold the warm afternoon" : "Warm grade · afternoon", "warm_grade", branch === "warm_grade" ? "ghost" : "primary"),
        button("b_cold", branch === "cold_grade" ? "Hold the cold morning" : "Cold grade · morning after", "cold_grade", branch === "cold_grade" ? "ghost" : "ghost"),
        button("b_bleach", branch === "bleach_grade" ? "Hold the bleach bypass" : "Bleach bypass · the final cut", "bleach_grade", branch === "bleach_grade" ? "ghost" : "primary"),
      ]);
    },
  },
  scene_extern: {
    semanticRole: "scene_extern",
    reason: "Window — interior vs establishing.",
    suggestedBranch: "extend_establish",
    build: (obj, branch) => {
      const outside = branch === "extend_establish";
      return panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // ${outside ? "ON THE COAST" : "ESTABLISHING"}`),
        text(
          "t1",
          outside
            ? "You are outside the glass. Tide and weather are the cut."
            : "The film's only outdoor beat is on the other side of this glass.",
        ),
        divider("d1"),
        metric("m_tide", "Tide", "low · going out", "ok"),
        metric("m_wx", "Weather", "overcast", "ok"),
        divider("d2"),
        button("b_ext", outside ? "Hold on the establishing" : "Open on the establishing shot", "extend_establish", outside ? "ghost" : "primary"),
        button("b_cut", outside ? "Cut back to the interior" : "Cut back to the interior", "cutto_interior", outside ? "primary" : "ghost"),
      ]);
    },
  },
  unknown: {
    semanticRole: "unknown",
    reason: "Unknown object clicked. Surfacing the inspector slate.",
    build: (obj, _branch) =>
      panel(`panel_${obj.id}`, [
        header("h1", `Inspector // ${obj.label}`),
        text("t1", `Confidence: ${(obj.confidence * 100).toFixed(1)}%`),
        text("t2", `BBox: [${obj.bbox.x1.toFixed(2)}, ${obj.bbox.y1.toFixed(2)}, ${obj.bbox.x2.toFixed(2)}, ${obj.bbox.y2.toFixed(2)}]`),
        divider("d1"),
        button("b_inspect", "Run a closer pass", "inspect", "primary"),
      ]),
  },
};

// ============================================================================
// Orchestration entry point
// ============================================================================

export interface OrchestrateResult {
  detectedObject: DetectedObject | null;
  a2ui: A2UIMessage;
  suggestedBranch?: BranchId;
}

/**
 * Given a click + detected objects, find the object under the cursor.
 * Used by both the LLM-driven and deterministic code paths.
 */
export function findClickedObject(
  click: { x: number; y: number },
  detections: DetectedObject[]
): DetectedObject | null {
  const candidates = detections.filter((d) => isPointInBBox(click, d.bbox));
  return candidates.sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox))[0] ?? null;
}

/**
 * Construct the A2UI message that creates a surface for the given object.
 * If `surfaceSpec` is provided (the LLM-authored path), use it; otherwise
 * fall back to the branch-aware `SURFACE_CATALOG`.
 *
 * Always injects the deterministic static action as the first button so the
 * click path stays rehearsable regardless of LLM flavor options.
 */
export function buildSurfaceMessage(
  detected: DetectedObject,
  surfaceSpec?: { root: A2UIComponent; reason?: string; suggestedBranch?: BranchId },
  currentBranch: BranchId = "taking",
  objectStates?: Partial<Record<SemanticRole, string>>,
): { a2ui: A2UIMessage; suggestedBranch?: BranchId } {
  const role = detected.semanticRole ?? "unknown";
  let root: A2UIComponent;
  let reason: string;
  let suggestedBranch: BranchId | undefined;

  if (surfaceSpec) {
    root = surfaceSpec.root;
    reason = surfaceSpec.reason ?? "LLM-authored surface";
    suggestedBranch = surfaceSpec.suggestedBranch;
  } else {
    const spec = SURFACE_CATALOG[role];
    root = spec.build(detected, currentBranch);
    reason = `${spec.reason} (branch: ${currentBranch})`;
    suggestedBranch = spec.suggestedBranch;
  }

  const phase = resolveObjectPhase(role, objectStates, currentBranch);
  const staticAction = getStaticAction(role, phase);
  if (staticAction) {
    root = injectStaticActionFirst(root, staticAction);
    // Prefer the static transition as the suggested next branch when valid.
    if (!suggestedBranch) {
      suggestedBranch = staticAction.actionId as BranchId;
    }
  }

  // Pitch guarantee: every panel gets "Summon the operator" so the hero beat
  // is always one click away — LLM or catalog, any object.
  if (currentBranch !== "summon_operator") {
    root = injectStaticActionLast(root, {
      actionId: "summon_operator",
      label: "Summon the operator",
      voiceLine: "",
      nextState: "operator_called — final take queued",
      variant: "danger",
    });
  }

  const surface: A2UISurface = {
    id: `surface_${detected.id}`,
    anchor: detected.bbox,
    semanticRole: role,
    root,
    reason,
  };
  const op: A2UIOperation = { kind: "create_surface", surface };
  return { a2ui: { nonce: makeNonce(), operations: [op] }, suggestedBranch };
}

/**
 * Given a click + detected objects, find the object under the cursor and
 * produce an A2UI message from the deterministic catalog (fallback path).
 */
export function orchestrate(req: OrchestrateRequest, detections: DetectedObject[]): OrchestrateResponse {
  const t0 = Date.now();

  const detected = findClickedObject(req.click, detections);

  if (!detected) {
    return {
      detections,
      detectedObject: null,
      a2ui: { nonce: makeNonce(), operations: [{ kind: "clear" }] },
      timings: {
        detectionMs: 0,
        orchestrationMs: Date.now() - t0,
        totalMs: Date.now() - t0,
      },
    };
  }

  const branch = (req.currentBranch as BranchId) || "taking";
  const { a2ui, suggestedBranch } = buildSurfaceMessage(detected, undefined, branch);
  return {
    detections,
    detectedObject: detected,
    a2ui,
    suggestedBranch,
    timings: {
      detectionMs: 0,
      orchestrationMs: Date.now() - t0,
      totalMs: Date.now() - t0,
    },
  };
}

/**
 * Given a user action selected in a surface, produce the updated prompt
 * and target branch for the next LTX-2.3 generation. Deterministic fallback
 * used when the LLM rewrite call fails (or `FAL_KEY` is absent).
 */
export function planBranchForAction(action: UserAction): {
  branch: BranchId;
  promptSuffix: string;
} {
  /**
   * Pitch-arc order (1→16). Each middle names MOVES vs DOES NOT MOVE.
   * assembleExtendPrompt appends cine + camera/set lock (except cutaways/hero).
   */
  const map: Record<string, { branch: BranchId; promptSuffix: string }> = {
    // 1 — time forward (coffee only)
    advance_clock: {
      branch: "advance_clock",
      promptSuffix:
        "MOVES: faint translucent steam wisp rising 2–3 inches above the coffee mug only; " +
        "a dark ring stain slowly spreads on the wood under the mug base. " +
        "DOES NOT MOVE: camera, framing, distance to desk, Steenbeck, typewriter, Bolex, window, walls. " +
        "No thick steam column. No spill splash. No push-in.",
    },
    // 2 — Bolex starts rolling (stay in room; do not cut to what Bolex sees)
    roll_take: {
      branch: "roll_take",
      promptSuffix:
        "MOVES: on the Bolex only — spring releases with a click, lens cap drops off the lens onto the desk or hangs, " +
        "film begins winding inside the camera body. " +
        "DOES NOT MOVE: main camera, wide framing, Steenbeck, typewriter, mug, window. " +
        "Do not cut to a POV through the Bolex. No zoom.",
    },
    // 3 — typewriter writes
    continue_page: {
      branch: "continue_page",
      promptSuffix:
        "MOVES: Royal typewriter only — carriage slams home, typebars strike the page stamping fresh black letters, paper jolts once. " +
        "DOES NOT MOVE: camera, Steenbeck reels, coffee mug, Bolex, window. No zoom.",
    },
    // 4 — Steenbeck mechanical life
    splice: {
      branch: "splice",
      promptSuffix:
        "MOVES: Steenbeck only — splice block slams shut on the leader, both white reels spin with motion blur, " +
        "coffee surface ripples once from the vibration. " +
        "DOES NOT MOVE: camera, typewriter, Bolex, window. No smoke. No fire. No zoom.",
    },
    // 5 — crisis: burn on splice block only
    burn: {
      branch: "burn",
      promptSuffix:
        "MOVES: film leader on the splice block ignites and curls into black ash at that spot only; " +
        "one thin grey wisp of smoke rises from the burning leader (not room-filling). " +
        "DOES NOT MOVE: camera, framing, typewriter, mug position, Bolex, window. " +
        "No fog bank. No white blobs. No zoom. No dolly toward the flame.",
    },
    // 6 — page tear (fast)
    scratch_line: {
      branch: "scratch_line",
      promptSuffix:
        "MOVES: on the typewriter page only — a thick black ink strike scrapes across the typed line; " +
        "the page margin tears slightly. " +
        "DOES NOT MOVE: camera, Steenbeck, mug, Bolex, window. No zoom.",
    },
    // 7 — mood shift: grade only (no object motion)
    cold_grade: {
      branch: "cold_grade",
      promptSuffix:
        "MOVES: color and light temperature only — entire frame snaps to steel-blue cold grade, " +
        "cyan light shaft, grey window light. Props stay exactly where they are. " +
        "DOES NOT MOVE: camera, object positions, geometry. No zoom. No new props.",
    },
    // 8 — anticipation: only allowed pan (Bolex head → door)
    reframe: {
      branch: "roll_take",
      promptSuffix:
        "MOVES: Bolex tripod HEAD pans toward the stage-left door as if anticipating someone there; winding spring ratchets. " +
        "DOES NOT MOVE: main camera body position, zoom, dolly, desk props, Steenbeck, typewriter, mug. " +
        "Wide shot remains; do not cut closer. No person enters yet.",
    },
    // 9 — pivot: double-exposure ghost (not fire)
    recover: {
      branch: "recover",
      promptSuffix:
        "MOVES: a brief double-exposed ghost image overlays the same wide desk shot for a second, then resolves sharp and single again. " +
        "DOES NOT MOVE: camera, furniture layout. No fire. No smoke. No zoom. No new objects.",
    },
    // 10 — reverse dust only (steam from beat 1 is long gone from the seed pixels)
    rewind: {
      branch: "rewind",
      promptSuffix:
        "MOVES: dust motes in the vertical light shaft drift backward for a moment, then freeze still. " +
        "DOES NOT MOVE: camera, furniture, mug. No steam effect. No thick fog. No zoom.",
    },
    // 11–12, 14 — full prompts in extend-prompts.ts
    extend_establish: { branch: "extend_establish", promptSuffix: "" },
    cutto_interior: { branch: "cutto_interior", promptSuffix: "" },
    // 13 — intercom summons
    page_studio: {
      branch: "page_studio",
      promptSuffix:
        "MOVES: wall intercom green indicator lamp strobes three hard flashes; a small click on the line. " +
        "DOES NOT MOVE: camera, desk, Steenbeck, typewriter, mug, Bolex. No zoom.",
    },
    summon_operator: { branch: "summon_operator", promptSuffix: "" },
    // 15 — final typed line
    sign_off: {
      branch: "sign_off",
      promptSuffix:
        "MOVES: typewriter only — stamps a signature line and date at the foot of the page; carriage returns and locks home. " +
        "DOES NOT MOVE: camera, Steenbeck, mug, Bolex, window. No zoom.",
    },
    // 16 — film ends
    cut_take: {
      branch: "cut_take",
      promptSuffix:
        "MOVES: lens cap snaps onto the Bolex lens; spring motor stops; every other motion in the room freezes. " +
        "DOES NOT MOVE: camera framing or distance. Hold the wide locked shot. No zoom.",
    },
    // Interactive-only (not in pitch reel)
    warm_grade: {
      branch: "warm_grade",
      promptSuffix:
        "MOVES: color grade only — frame snaps to deep amber late-afternoon, honey film sleeves, golden shaft. " +
        "DOES NOT MOVE: camera, object positions. No zoom. No fire.",
    },
    bleach_grade: {
      branch: "bleach_grade",
      promptSuffix:
        "MOVES: color grade only — bleach-bypass, crushed blacks, silver grain, near-white shaft. " +
        "DOES NOT MOVE: camera, object positions. No zoom. No smoke.",
    },
    inspect: {
      branch: "neutral",
      promptSuffix:
        "MOVES: none — hold the wide shot; grain reads slightly clearer on the clicked object. " +
        "DOES NOT MOVE: camera, framing. No push-in. No cut to macro.",
    },
  };
  return map[action.actionId] ?? {
    branch: "neutral",
    promptSuffix:
      "MOVES: none. DOES NOT MOVE: camera, framing, all props. Hold the locked wide shot.",
  };
}

// ============================================================================
// Helpers
// ============================================================================

export function makeNonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPointInBBox(p: { x: number; y: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean {
  return p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;
}

function bboxArea(b: { x1: number; y1: number; x2: number; y2: number }): number {
  return (b.x2 - b.x1) * (b.y2 - b.y1);
}
