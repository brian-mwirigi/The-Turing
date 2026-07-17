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
  build: (obj: DetectedObject) => A2UIComponent;
  suggestedBranch?: BranchId;
}

export const SURFACE_CATALOG: Record<SemanticRole, SurfaceSpec> = {
  faulty_asset: {
    semanticRole: "faulty_asset",
    reason: "Detected asset reporting thermal / electrical fault. Surfacing diagnostic + mitigation controls.",
    suggestedBranch: "alert",
    build: (obj) =>
      panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // FAULT`),
        alert("a1", "crit", "Power supply failure detected. Immediate action required."),
        divider("d1"),
        metric("m_temp", "Temperature", "31.8 °C", "crit"),
        metric("m_load", "Power Load", "112 %", "crit"),
        metric("m_uptime", "Uptime", "47d 12h", "ok"),
        divider("d2"),
        text("t1", "Select mitigation protocol:"),
        button("b_reboot", "Initiate Cold Reboot", "reboot", "primary"),
        button("b_alert", "Trigger Facility Alert", "trigger_alert", "danger"),
        button("b_isolate", "Isolate from Grid", "isolate", "ghost"),
      ]),
  },
  operator_interface: {
    semanticRole: "operator_interface",
    reason: "Operator terminal detected. Surfacing mission control panel.",
    suggestedBranch: "neutral",
    build: (obj) =>
      panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // OPERATOR`),
        text("t1", "Session: operator@turing-canvas"),
        divider("d1"),
        metric("m_sessions", "Active Sessions", "3", "ok"),
        metric("m_queue", "Job Queue", "14", "ok"),
        metric("m_latency", "p99 Latency", "42 ms", "ok"),
        divider("d2"),
        toggle("tg_audit", "Enable Audit Trail", true),
        toggle("tg_safe", "Safe Mode", false),
        divider("d3"),
        button("b_continue", "Continue Operation", "continue", "primary"),
        button("b_standby", "Enter Standby", "standby", "ghost"),
      ]),
  },
  hvac_component: {
    semanticRole: "hvac_component",
    reason: "HVAC component detected. Surfacing environmental controls.",
    suggestedBranch: "neutral",
    build: (obj) =>
      panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // HVAC`),
        metric("m_temp", "Ambient Temp", "24.1 °C", "ok"),
        metric("m_flow", "Airflow", "1.2 m³/s", "ok"),
        metric("m_filter", "Filter Health", "87 %", "ok"),
        divider("d1"),
        text("t1", "Adjust cooling target:"),
        button("b_lower", "Lower by 2°C", "lower_temp", "primary"),
        button("b_boost", "Boost Fan 100%", "boost_fan", "ghost"),
      ]),
  },
  security_node: {
    semanticRole: "security_node",
    reason: "Security node detected. Surfacing incident response panel.",
    suggestedBranch: "alert",
    build: (obj) =>
      panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // SECURITY`),
        alert("a1", "warn", "Unauthorized access attempt logged."),
        metric("m_attempts", "Failed Attempts", "7", "warn"),
        divider("d1"),
        button("b_lockdown", "Initiate Lockdown", "lockdown", "danger"),
        button("b_review", "Review Logs", "review_logs", "ghost"),
      ]),
  },
  data_stream: {
    semanticRole: "data_stream",
    reason: "Data stream detected. Surfacing telemetry controls.",
    suggestedBranch: "neutral",
    build: (obj) =>
      panel(`panel_${obj.id}`, [
        header("h1", `${obj.label} // TELEMETRY`),
        metric("m_throughput", "Throughput", "8.4 Gbps", "ok"),
        metric("m_errors", "CRC Errors", "0", "ok"),
        divider("d1"),
        button("b_dump", "Export Snapshot", "export_snapshot", "primary"),
      ]),
  },
  unknown: {
    semanticRole: "unknown",
    reason: "Unknown object clicked. Surfacing generic inspector.",
    build: (obj) =>
      panel(`panel_${obj.id}`, [
        header("h1", `Inspector // ${obj.label}`),
        text("t1", `Confidence: ${(obj.confidence * 100).toFixed(1)}%`),
        text("t2", `BBox: [${obj.bbox.x1.toFixed(2)}, ${obj.bbox.y1.toFixed(2)}, ${obj.bbox.x2.toFixed(2)}, ${obj.bbox.y2.toFixed(2)}]`),
        divider("d1"),
        button("b_inspect", "Run Deep Inspection", "inspect", "primary"),
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
 * fall back to the deterministic `SURFACE_CATALOG`.
 */
export function buildSurfaceMessage(
  detected: DetectedObject,
  surfaceSpec?: { root: A2UIComponent; reason?: string; suggestedBranch?: BranchId }
): { a2ui: A2UIMessage; suggestedBranch?: BranchId } {
  let root: A2UIComponent;
  let reason: string;
  let suggestedBranch: BranchId | undefined;

  if (surfaceSpec) {
    root = surfaceSpec.root;
    reason = surfaceSpec.reason ?? "LLM-authored surface";
    suggestedBranch = surfaceSpec.suggestedBranch;
  } else {
    const spec = SURFACE_CATALOG[detected.semanticRole ?? "unknown"];
    root = spec.build(detected);
    reason = spec.reason;
    suggestedBranch = spec.suggestedBranch;
  }

  const surface: A2UISurface = {
    id: `surface_${detected.id}`,
    anchor: detected.bbox,
    semanticRole: detected.semanticRole ?? "unknown",
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

  const { a2ui, suggestedBranch } = buildSurfaceMessage(detected);
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
  const map: Record<string, { branch: BranchId; promptSuffix: string }> = {
    summon_operator: {
      branch: "veo31",
      promptSuffix:
        " — a uniformed operator strides into frame from the left, emergency lighting floods the room, the camera pushes in dramatically, the faulty rack locks down under their authority, hero beat",
    },
    trigger_alert: {
      branch: "alert",
      promptSuffix: " — emergency lighting activates, red alert pulses across the room, sparks intensify on the faulty rack, alarm klaxon visuals",
    },
    reboot: {
      branch: "reboot",
      promptSuffix: " — cool blue reboot pulse sweeps through the room, LEDs cycle through reboot sequence, sparks cease, temperature drops",
    },
    isolate: {
      branch: "reboot",
      promptSuffix: " — faulty rack goes dark, power reroutes through secondary bus, status lights turn amber",
    },
    lockdown: {
      branch: "alert",
      promptSuffix: " — blast doors seal, security lights strobe, all consoles lock",
    },
    continue: {
      branch: "neutral",
      promptSuffix: " — system continues normal operation, ambient lighting stabilizes",
    },
    standby: {
      branch: "neutral",
      promptSuffix: " — system enters low-power standby, ambient lights dim to soft glow",
    },
    lower_temp: {
      branch: "neutral",
      promptSuffix: " — cooling vent activates, mist visible from overhead vents, temperature readout drops",
    },
    boost_fan: {
      branch: "neutral",
      promptSuffix: " — cooling fan ramps to 100%, visible airflow intensifies, vent louvers open fully",
    },
    review_logs: {
      branch: "neutral",
      promptSuffix: " — terminal displays scrolling log entries, cursor blinks rapidly",
    },
    export_snapshot: {
      branch: "neutral",
      promptSuffix: " — progress bar fills on terminal, data streams visibly through console",
    },
    inspect: {
      branch: "neutral",
      promptSuffix: " — close-up inspection overlay, magnifying scan lines move across the object",
    },
  };
  return map[action.actionId] ?? { branch: "neutral", promptSuffix: " — scene continues" };
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
