/**
 * Deterministic per-object state machines.
 *
 * Each role has a short phase chain. For every phase there is exactly one
 * guaranteed static action (always the first button on the slate). LLM flavor
 * options may follow; they never replace this button.
 *
 * Voice lines are keyed to the transition (phase → action), so ElevenLabs
 * clips can be pre-baked and played without depending on LLM copy.
 */

import type { A2UIComponent, BranchId, SemanticRole } from "./types";

export type ObjectPhase =
  | "paused"
  | "running"
  | "burnt"
  | "blank"
  | "typing"
  | "torn"
  | "cold"
  | "advanced"
  | "stopped"
  | "rolling"
  | "idle"
  | "paged"
  | "neutral"
  | "grade_warm"
  | "grade_cold"
  | "grade_bleach"
  | "interior"
  | "establishing";

export interface StaticAction {
  actionId: string;
  /** Slate button label (editor voice). */
  label: string;
  /** Pre-recordable VO line for this transition. */
  voiceLine: string;
  /** Phase tag written to objectStates after commit. */
  nextState: string;
  variant?: "primary" | "danger" | "ghost";
}

/** Resolve phase from store tag + current branch. */
export function resolveObjectPhase(
  role: SemanticRole,
  objectStates: Partial<Record<SemanticRole, string>> | undefined,
  branch: BranchId,
): ObjectPhase {
  const tag = (objectStates?.[role] ?? "").toLowerCase();

  switch (role) {
    case "film_source":
      if (tag.includes("burnt") || branch === "burn") return "burnt";
      if (tag.includes("running") || tag.includes("ghost") || branch === "splice" || branch === "recover")
        return "running";
      return "paused";
    case "manuscript":
      if (tag.includes("torn") || tag.includes("signed") || branch === "sign_off") return "torn";
      if (tag.includes("typing") || tag.includes("page_open") || tag.includes("scratch") ||
          branch === "continue_page" || branch === "scratch_line")
        return "typing";
      return "blank";
    case "artifact_unset":
      if (tag.includes("forward") || tag.includes("advanced") || branch === "advance_clock") return "advanced";
      return "cold";
    case "camera_asset":
      if (tag.includes("rolling") || branch === "roll_take") return "rolling";
      return "stopped";
    case "operator_interface":
      // idle → page; once paged or summoned, static action is summon (Veo).
      if (
        tag.includes("called") ||
        tag.includes("paged") ||
        branch === "page_studio" ||
        branch === "summon_operator"
      )
        return "paged";
      return "idle";
    case "vfx_element":
      if (tag.includes("bleach") || branch === "bleach_grade") return "grade_bleach";
      if (tag.includes("cold") || branch === "cold_grade") return "grade_cold";
      if (tag.includes("warm") || branch === "warm_grade") return "grade_warm";
      return "neutral";
    case "scene_extern":
      if (tag.includes("coast") || tag.includes("estab") || branch === "extend_establish") return "establishing";
      return "interior";
    default:
      return "paused";
  }
}

/** The one guaranteed static action for this role + phase. */
export function getStaticAction(role: SemanticRole, phase: ObjectPhase): StaticAction | null {
  switch (role) {
    case "film_source":
      if (phase === "paused")
        return {
          actionId: "splice",
          label: "Run reels",
          voiceLine: "The reels turn again.",
          nextState: "reels_running — splice live, join held",
          variant: "primary",
        };
      if (phase === "running")
        return {
          actionId: "burn",
          label: "Burn leader",
          voiceLine: "The leader catches. It's burning.",
          nextState: "leader_burnt — join lost, smoke in the shaft",
          variant: "danger",
        };
      return {
        actionId: "recover",
        label: "Salvage the join",
        voiceLine: "Salvaged. Barely.",
        nextState: "ghost_take — second exposure under the join",
        variant: "primary",
      };

    case "manuscript":
      if (phase === "blank")
        return {
          actionId: "continue_page",
          label: "Start typing",
          voiceLine: "She's writing again.",
          nextState: "page_open — typing, carriage mid-line",
          variant: "primary",
        };
      if (phase === "typing")
        return {
          actionId: "scratch_line",
          label: "Tear the page",
          voiceLine: "The page is torn free.",
          nextState: "page_torn — sheet pulled from the platen",
          variant: "danger",
        };
      return {
        actionId: "sign_off",
        label: "Sign off",
        voiceLine: "Signed. Final.",
        nextState: "note_signed — name at the foot of the page",
        variant: "primary",
      };

    case "artifact_unset":
      if (phase === "cold")
        return {
          actionId: "advance_clock",
          label: "Advance time",
          voiceLine: "Time moves forward.",
          nextState: "clock_forward — steam returned, stain deepened",
          variant: "primary",
        };
      return {
        actionId: "rewind",
        label: "Rewind time",
        voiceLine: "Time folds back.",
        nextState: "clock_rewound — heat back in the mug",
        variant: "ghost",
      };

    case "camera_asset":
      if (phase === "stopped")
        return {
          actionId: "roll_take",
          label: "Roll camera",
          voiceLine: "Rolling.",
          nextState: "take_rolling — spring wound, gate open",
          variant: "primary",
        };
      return {
        actionId: "cut_take",
        label: "Cut take",
        voiceLine: "Cut.",
        nextState: "lens_capped — take cut, room quiet again",
        variant: "primary",
      };

    case "operator_interface":
      if (phase === "idle")
        return {
          actionId: "page_studio",
          label: "Page studio",
          voiceLine: "Paging the studio.",
          nextState: "studio_paged — line ringing, no voice yet",
          variant: "primary",
        };
      return {
        actionId: "summon_operator",
        label: "Summon the operator",
        voiceLine: "", // Veo lip-sync carries dialogue — no overlapping VO
        nextState: "operator_called — final take queued",
        variant: "danger",
      };

    case "vfx_element":
      // Cycle: neutral → warm → cold → bleach → warm…
      if (phase === "neutral" || phase === "grade_bleach")
        return {
          actionId: "warm_grade",
          label: "Shift grade",
          voiceLine: "The light changes color.",
          nextState: "grade_warm — amber afternoon live",
          variant: "primary",
        };
      if (phase === "grade_warm")
        return {
          actionId: "cold_grade",
          label: "Shift grade",
          voiceLine: "The light changes color.",
          nextState: "grade_cold — morning-after blue live",
          variant: "primary",
        };
      return {
        actionId: "bleach_grade",
        label: "Shift grade",
        voiceLine: "The light changes color.",
        nextState: "grade_bleach — silver final-cut look live",
        variant: "primary",
      };

    case "scene_extern":
      if (phase === "interior")
        return {
          actionId: "extend_establish",
          label: "Cut to window",
          voiceLine: "Cut to the Pacific.",
          nextState: "on_the_coast — outside the glass",
          variant: "primary",
        };
      return {
        actionId: "cutto_interior",
        label: "Cut back",
        voiceLine: "Back to the room.",
        nextState: "back_inside — cut returned to the desk",
        variant: "primary",
      };

    default:
      return null;
  }
}

function makeStaticButton(staticAction: StaticAction): A2UIComponent {
  return {
    id: `b_static_${staticAction.actionId}`,
    type: "button",
    props: {
      label: staticAction.label,
      actionId: staticAction.actionId,
      variant: staticAction.variant ?? "primary",
      voiceLine: staticAction.voiceLine,
    },
  };
}

function withoutActionId(children: A2UIComponent[], actionId: string): A2UIComponent[] {
  return children.filter((c) => {
    if (c.type !== "button") return true;
    return (c.props?.actionId as string | undefined) !== actionId;
  });
}

/**
 * Prepend the static action as the first button in a panel tree.
 * Dedupes if the LLM already emitted the same actionId.
 */
export function injectStaticActionFirst(
  root: A2UIComponent,
  staticAction: StaticAction,
): A2UIComponent {
  if (root.type !== "panel" || !root.children) return root;

  const staticBtn = makeStaticButton(staticAction);
  const rest = withoutActionId(root.children, staticAction.actionId);

  // Insert after the first header/text block if present, else at top of actions.
  const firstButtonIdx = rest.findIndex((c) => c.type === "button");
  if (firstButtonIdx === -1) {
    return { ...root, children: [...rest, staticBtn] };
  }
  const before = rest.slice(0, firstButtonIdx);
  const after = rest.slice(firstButtonIdx);
  return { ...root, children: [...before, staticBtn, ...after] };
}

/**
 * Append a guaranteed action as the last button (e.g. summon_operator on every panel).
 * Dedupes if already present.
 */
export function injectStaticActionLast(
  root: A2UIComponent,
  staticAction: StaticAction,
): A2UIComponent {
  if (root.type !== "panel" || !root.children) return root;
  const staticBtn = makeStaticButton(staticAction);
  const rest = withoutActionId(root.children, staticAction.actionId);
  return { ...root, children: [...rest, staticBtn] };
}

/**
 * Pitch-reel VO pack (Imogen — quiet, close-mic, third-person ghost).
 * 4-beat reel: burn, recover carry VO; summon_operator (Veo lip-sync) and
 * cut_take (lens cap / film ending) are silent by design.
 * Re-record ElevenLabs when lines change; stems must match /public/canvas/voices/.
 */
export const VOICE_LINES: Array<{
  id: string;
  line: string;
  delivery: string;
}> = [
  {
    id: "vo_burn_leader",
    line: "She burned three reels the week before she died. Never said why.",
    delivery: "low, accepting — heaviest line, leave air after",
  },
  {
    id: "vo_salvage",
    line: "Salvaged. Barely.",
    delivery: "dry, half a smile — pivot",
  },
];
