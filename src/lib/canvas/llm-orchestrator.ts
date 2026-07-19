/**
 * LLM Orchestrator
 *
 * Two-step LLM pipeline (via fal OpenRouter's OpenAI-compatible endpoint):
 *
 *   STEP 1 — A2UI surface generation
 *     Given a detected object + scene context, ask the LLM to author the
 *     A2UI surface JSON (component tree + anchor + reason). The output is
 *     validated with Zod; on any failure we gracefully fall back to the
 *     deterministic `SURFACE_CATALOG` in `orchestrator.ts`.
 *
 *   STEP 2 — extend-video prompt rewrite (state persistence)
 *     Given the user's chosen action + the current scene prompt + branch,
 *     ask the LLM to rewrite the cinematic continuation prompt so the next
 *     generated video chunk visibly reflects the user's action. Falls back
 *     to `planBranchForAction` deterministic suffixes.
 *
 * Auth: `Authorization: Key ${FAL_KEY}` against
 *   https://fal.run/openrouter/router/openai/v1
 * Model defaults to Gemini 2.5 Flash (fast + cheap for hackathon latency).
 */

import OpenAI from "openai";
import { z } from "zod";
import type {
  A2UIComponent,
  A2UISurface,
  DetectedObject,
  SemanticRole,
  UserAction,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY || "";

const openrouterBaseURL = "https://fal.run/openrouter/router/openai/v1";

let _client: OpenAI | null = null;
function client(): OpenAI | null {
  if (!FAL_KEY) return null;
  if (!_client) {
    _client = new OpenAI({
      baseURL: openrouterBaseURL,
      apiKey: FAL_KEY,
      defaultHeaders: { Authorization: `Key ${FAL_KEY}` },
    });
  }
  return _client;
}

export const isLlmLive = () => FAL_KEY.length > 0;

const DEFAULT_LLM_MODEL = process.env.FAL_LLM_MODEL || "google/gemini-2.5-flash";

// ============================================================================
// Zod schemas — what the LLM is allowed to emit
// ============================================================================

const ComponentSchema: z.ZodType<A2UIComponent> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum([
      "panel",
      "header",
      "text",
      "metric",
      "button",
      "toggle",
      "select",
      "alert",
      "divider",
      "code",
    ]),
    children: z.array(ComponentSchema).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
);

export const SurfaceSchema = z.object({
  anchor: z.object({
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
    x2: z.number().min(0).max(1),
    y2: z.number().min(0).max(1),
  }),
  semanticRole: z.enum([
    "film_source",
    "camera_asset",
    "manuscript",
    "artifact_unset",
    "operator_interface",
    "vfx_element",
    "scene_extern",
    "unknown",
  ]),
  root: ComponentSchema,
  reason: z.string().optional(),
});

const RewriteSchema = z.object({
  branch: z.enum([
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
    "summon_operator",
    "recover",
    "burn",
    "rewind",
    "advance_clock",
    "extend_establish",
    "cutto_interior",
    "neutral",
  ]),
  promptSuffix: z.string().min(1).max(400),
});

// ============================================================================
// Canonical actionId allowlist — buttons/options MUST resolve to one of
// these. The system prompt already asks the LLM for this, but nothing
// enforced it; an off-list actionId would break planBranchForAction /
// generate mapping. Reject the surface so orchestrate falls back to catalog.
// ============================================================================

const CANONICAL_ACTION_IDS = new Set([
  "splice",
  "recover",
  "burn",
  "roll_take",
  "cut_take",
  "reframe",
  "continue_page",
  "scratch_line",
  "sign_off",
  "advance_clock",
  "rewind",
  "warm_grade",
  "cold_grade",
  "bleach_grade",
  "page_studio",
  "summon_operator",
  "extend_establish",
  "cutto_interior",
  "inspect",
]);

/** Recursively collect any button/select-option actionId not on the allowlist. */
function collectInvalidActionIds(node: A2UIComponent): string[] {
  const bad: string[] = [];
  const props = node.props as Record<string, unknown> | undefined;
  if (node.type === "button") {
    const actionId = props?.actionId;
    if (typeof actionId !== "string" || !CANONICAL_ACTION_IDS.has(actionId)) {
      bad.push(String(actionId));
    }
  }
  if (node.type === "select") {
    const options = (props?.options as Array<{ actionId?: unknown }> | undefined) ?? [];
    for (const opt of options) {
      if (typeof opt.actionId !== "string" || !CANONICAL_ACTION_IDS.has(opt.actionId)) {
        bad.push(String(opt.actionId));
      }
    }
  }
  for (const child of node.children ?? []) bad.push(...collectInvalidActionIds(child));
  return bad;
}

// ============================================================================
// STEP 1 — A2UI surface generation
// ============================================================================

const SURFACE_SYSTEM = `You are an A2UI surface authoring agent inside a film. The scene is "The Turing-Complete Canvas" — a 1970s cutting room left exactly as the late filmmaker Imogen Veyra left it. The user is the inheritor finishing her uncut film.

You emit declarative JSON describing a control panel rendered on top of the film frame. The panel is not software chrome: it is a film-desk slate. Voice it like a focus-puller's annotation. Quiet. Precise. Never break the cinematic register. Never say "system", "alert", "facility", "operator", "server". This is a cutting room, not a server room.

The schema supports these component types and their props:
- panel   : container; children = list of components
- header  : props.text = uppercase header string, format "<Label> // <DESK>"
- text    : props.content — short, evocative, at most two lines
- metric  : props.label (descriptive, lowercase), props.value (string), props.status in {ok,warn,crit}
- button  : props.label (an action verb in the filmmaker's voice), props.actionId (snake_case), props.variant in {primary,danger,ghost}
- toggle  : props.label, props.defaultOn (boolean)
- select  : props.label, props.options = [{label, actionId}, ...]
- alert   : props.level in {info,warn,crit}, props.message — write as a line of stage direction, never a system log
- divider : no props
- code    : props.content (multiline)

Output a single JSON object with fields:
  anchor      : { x1, y1, x2, y2 } normalized 0..1 in video frame coordinates — equal to the object's bbox
  semanticRole : one of film_source | camera_asset | manuscript | artifact_unset | operator_interface | vfx_element | scene_extern | unknown
  root         : the panel component tree (root.type is typically "panel")
  reason       : one-sentence rationale, written like a film editor's slate note

Hard constraints:
- Only emit JSON, no explanations, no markdown fences.
- actionIds must be lowercase snake_case. Use these canonical ids when relevant to the branching story: splice, recover, burn, roll_take, cut_take, reframe, continue_page, scratch_line, sign_off, advance_clock, rewind, warm_grade, cold_grade, bleach_grade, page_studio, summon_operator, extend_establish, cutto_interior, inspect.
- ALWAYS include a button with actionId "summon_operator", label "Summon the operator", variant "danger" on EVERY panel (every object). The server also injects it if missing — still emit it yourself.
- The panel is anchored to the right of the bbox by the renderer, so anchor must equal the object's bbox.
- Maximum three buttons per panel (including summon_operator). Maximum four metrics. Restraint lands the beat.

CURRENT BRANCH + OBJECT STATE (critical):
- The user payload includes currentBranch AND objectState (for the clicked role) AND objectStates (all roles).
- objectState is the narrative tag for THIS object after prior commits (e.g. "leader_burnt — join lost").
- Metrics, copy, and buttons MUST reflect objectState + currentBranch. Do NOT offer the same primary action that already happened.
  Examples:
  - objectState contains reels_running / splice → offer burn/recover/hold — NOT "splice for the first time".
  - objectState contains leader_burnt → offer recover/rejoin — NOT the idle splice menu.
  - objectState contains take_rolling → emphasize cut_take / reframe.
  - objectState contains grade_warm → offer cold/bleach or hold — not "warm" as if unset.
  - objectState empty / "paused" + currentBranch taking|neutral → first-touch actions for that object.
- Header/metrics should read as a status report of the present beat ("REELS RUNNING", "LEADER BURNT", etc.).`;

export interface SurfaceGenInput {
  object: DetectedObject;
  branch: string;
  /** Narrative tag for the clicked object's role (from store.objectStates). */
  objectState?: string;
  /** Full per-role state map for scene continuity. */
  objectStates?: Record<string, string>;
}
export interface SurfaceGenResult {
  ok: boolean;
  surface?: Omit<A2UISurface, "id">;
  error?: string;
}

export async function generateSurface(inp: SurfaceGenInput): Promise<SurfaceGenResult> {
  const c = client();
  if (!c) return { ok: false, error: "no FAL_KEY" };
  try {
    const role = inp.object.semanticRole ?? "unknown";
    const objectState =
      inp.objectState ??
      inp.objectStates?.[role] ??
      "paused — no prior action on this object";
    const user = JSON.stringify({
      object: {
        label: inp.object.label,
        semanticRole: role,
        confidence: inp.object.confidence,
        bbox: inp.object.bbox,
      },
      currentBranch: inp.branch,
      objectState,
      objectStates: inp.objectStates ?? {},
      instruction:
        "Author the slate for THIS object's current state. Buttons and metrics must match objectState — not the idle starting menu.",
    });
    const completion = await c.chat.completions.create({
      model: DEFAULT_LLM_MODEL,
      messages: [
        { role: "system", content: SURFACE_SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 900,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = safeJson(raw);
    if (!parsed) return { ok: false, error: "invalid json" };
    const validated = SurfaceSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, error: validated.error.issues[0]?.message ?? "schema fail" };
    }
    const invalidActionIds = collectInvalidActionIds(validated.data.root);
    if (invalidActionIds.length > 0) {
      return {
        ok: false,
        error: `invalid actionId(s) from LLM: ${invalidActionIds.join(", ")}`,
      };
    }
    return { ok: true, surface: validated.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "llm error" };
  }
}

// ============================================================================
// STEP 2 — extend-video prompt rewrite (state persistence)
// ============================================================================

const REWRITE_SYSTEM = `You are a cinematic video-prompt rewriter for an LTX-2.3 video extension model. The film is "The Turing-Complete Canvas" — a 1970s cutting room left mid-edit by a filmmaker who died before picture lock.

Given a user action, emit a continuation cue in this exact shape:
MOVES: <only the parts that change>. DOES NOT MOVE: <camera/framing and every prop that stays>.

Rules:
- Output JSON only. No markdown.
- Keep promptSuffix under 60 words. No ellipsis. No soft ambient trailing.
- Always ban: zoom, push-in, dolly, thick fog/steam blobs, restaging the room.
- Exception: reframe may pan the Bolex tripod head only; camera body stays fixed.
- Exception: extend_establish is a HARD CUT to outdoor Pacific (no interior props).
- Server appends camera/set lock — do not write a long layout essay.
- branch must be one of: taking | splice | roll_take | cut_take | continue_page | scratch_line | sign_off | warm_grade | cold_grade | bleach_grade | page_studio | summon_operator | recover | burn | rewind | advance_clock | extend_establish | cutto_interior | neutral.
- summon_operator is the ONLY branch that may introduce a person (Veo). Keep the room layout.
- Never redesign the set. Never invent lamps, green walls, or new furniture.`;

export interface RewriteInput {
  action: UserAction;
  object?: DetectedObject;
  currentBranch: string;
}
export interface RewriteResult {
  ok: boolean;
  branch?:
    | "taking"
    | "splice"
    | "roll_take"
    | "cut_take"
    | "continue_page"
    | "scratch_line"
    | "sign_off"
    | "warm_grade"
    | "cold_grade"
    | "bleach_grade"
    | "page_studio"
    | "summon_operator"
    | "recover"
    | "burn"
    | "rewind"
    | "advance_clock"
    | "extend_establish"
    | "cutto_interior"
    | "neutral";
  promptSuffix?: string;
  error?: string;
}

export async function rewriteExtendPrompt(inp: RewriteInput): Promise<RewriteResult> {
  const c = client();
  if (!c) return { ok: false, error: "no FAL_KEY" };
  try {
    const user = JSON.stringify({
      actionId: inp.action.actionId,
      label: inp.action.label,
      semanticRole: inp.action.semanticRole,
      payload: inp.action.payload ?? null,
      objectLabel: inp.object?.label ?? null,
      currentBranch: inp.currentBranch,
    });
    const completion = await c.chat.completions.create({
      model: DEFAULT_LLM_MODEL,
      messages: [
        { role: "system", content: REWRITE_SYSTEM },
        { role: "user", content: user },
      ],
      temperature: 0.5,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = safeJson(raw);
    if (!parsed) return { ok: false, error: "invalid json" };
    const validated = RewriteSchema.safeParse(parsed);
    if (!validated.success) {
      return { ok: false, error: validated.error.issues[0]?.message ?? "schema fail" };
    }
    return { ok: true, ...validated.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "llm error" };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function safeJson(s: string): unknown | null {
  if (!s) return null;
  const trimmed = s.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to locate the first {...} block as a last resort
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function roleFromStringSafe(role: string | undefined): SemanticRole {
  const valid: SemanticRole[] = [
    "film_source",
    "camera_asset",
    "manuscript",
    "artifact_unset",
    "operator_interface",
    "vfx_element",
    "scene_extern",
    "unknown",
  ];
  return (valid as string[]).includes(role ?? "") ? (role as SemanticRole) : "unknown";
}
