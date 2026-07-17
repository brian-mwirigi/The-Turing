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
    "faulty_asset",
    "operator_interface",
    "hvac_component",
    "security_node",
    "data_stream",
    "unknown",
  ]),
  root: ComponentSchema,
  reason: z.string().optional(),
});

const RewriteSchema = z.object({
  branch: z.enum(["main", "alert", "reboot", "neutral", "veo31"]),
  promptSuffix: z.string().min(1).max(400),
});

// ============================================================================
// STEP 1 — A2UI surface generation
// ============================================================================

const SURFACE_SYSTEM = `You are an A2UI surface authoring agent. You emit declarative JSON describing a control panel to render on top of a video frame.

The schema supports these component types and their props:
- panel   : container; children = list of components
- header  : props.text = uppercase header string
- text    : props.content
- metric  : props.label, props.value, props.status ∈ {ok,warn,crit}
- button  : props.label, props.actionId, props.variant ∈ {primary,danger,ghost}
- toggle  : props.label, props.defaultOn (boolean)
- alert   : props.level ∈ {info,warn,crit}, props.message
- divider : no props
- code    : props.content (multiline)

Output a single JSON object with fields:
  anchor      : { x1, y1, x2, y2 } normalized 0..1 in video frame coordinates
  semanticRole : one of faulty_asset | operator_interface | hvac_component | security_node | data_stream | unknown
  root         : the panel component tree (root.type is typically "panel")
  reason       : one-sentence rationale

Hard constraints:
- Only emit JSON, no explanations, no markdown fences.
- actionIds must be lowercase snake_case; for the branching story use these canonical ids when relevant: trigger_alert, reboot, isolate, lockdown, continue, standby, lower_temp, boost_fan, review_logs, export_snapshot, inspect, summon_operator.
- The panel is anchored to the right of the bbox by the renderer, so anchor must equal the object's bbox.`;

export interface SurfaceGenInput {
  object: DetectedObject;
  branch: string;
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
    const user = JSON.stringify({
      object: {
        label: inp.object.label,
        semanticRole: inp.object.semanticRole ?? "unknown",
        confidence: inp.object.confidence,
        bbox: inp.object.bbox,
      },
      currentBranch: inp.branch,
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
    return { ok: true, surface: validated.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "llm error" };
  }
}

// ============================================================================
// STEP 2 — extend-video prompt rewrite (state persistence)
// ============================================================================

const REWRITE_SYSTEM = `You are a cinematic video-prompt rewriter for an LTX-2.3 video extension model.

Given a user action taken in a sci-fi server-room control panel, emit a short continuation cue that will be appended to the scene's base prompt. The cue must describe visible motion/camera/lighting changes that the video model can render in ~1 second of new content.

Rules:
- Output JSON only.
- Keep promptSuffix under 60 words. No markdown.
- branch must be one of: main | alert | reboot | neutral | veo31.
  - veo31 triggers Veo 3.1 (only valid for the summon_operator action).
- For summon_operator, set branch=veo31 and describe an operator arriving / a dramatic hero beat.
- Be cinematic, precise, action-oriented.`;

export interface RewriteInput {
  action: UserAction;
  object?: DetectedObject;
  currentBranch: string;
}
export interface RewriteResult {
  ok: boolean;
  branch?: "main" | "alert" | "reboot" | "neutral" | "veo31";
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
    "faulty_asset",
    "operator_interface",
    "hvac_component",
    "security_node",
    "data_stream",
    "unknown",
  ];
  return (valid as string[]).includes(role ?? "") ? (role as SemanticRole) : "unknown";
}
