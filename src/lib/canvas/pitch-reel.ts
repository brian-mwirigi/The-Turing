/**
 * Canonical pitch-reel cut list — shortened 4-beat sequence (time-crunch cut).
 * Used by gen:demo --all order and as the edit bible for the submission cut.
 *
 * Chain: burn ← room_seed.mp4 → recover ← burn → summon_operator (Veo, still
 * seed from recover's last frame) → cut_take ← summon_operator's output video.
 */

export type PitchHold = "short" | "medium" | "long" | "longest" | "silence";

export type PitchBeat = {
  n: number;
  act: 1 | 2 | 3 | 4;
  actionId: string;
  /** Voice stem under /canvas/voices/, or null for silence / Veo lip-sync */
  vo: string | null;
  /** Edit-time VO copy (may differ from older ElevenLabs takes until re-recorded) */
  line: string | null;
  still: string | null;
  hold: PitchHold;
  note: string;
};

export const PITCH_REEL: PitchBeat[] = [
  {
    n: 1,
    act: 1,
    actionId: "burn",
    vo: "vo_burn_leader",
    line: "She burned three reels the week before she died. Never said why.",
    still: "Scorched leader, ashtray",
    hold: "longest",
    note: "opening beat — seeds from room_seed.mp4, heaviest line, leave air after",
  },
  {
    n: 2,
    act: 2,
    actionId: "recover",
    vo: "vo_salvage",
    line: "Salvaged. Barely.",
    still: null,
    hold: "long",
    note: "pivot — seeds from burn's output",
  },
  {
    n: 3,
    act: 3,
    actionId: "summon_operator",
    vo: null,
    line: null,
    still: null,
    hold: "longest",
    note: "Veo lip-sync owns it — still seed from recover's last frame, full volume, longest hold",
  },
  {
    n: 4,
    act: 4,
    actionId: "cut_take",
    vo: null,
    line: null,
    still: null,
    hold: "silence",
    note: "lens cap snaps — final frame, film ending, seeds from summon_operator's Veo output video",
  },
];

/** Gen order for `bun run gen:demo -- --all` — pitch sequence, no cut clips. */
export const PITCH_DEMO_CLIPS = PITCH_REEL.map((b) => b.actionId);

/** Explicitly excluded from this pass. */
export const PITCH_CUT = [
  "advance_clock",
  "roll_take",
  "continue_page",
  "splice",
  "scratch_line",
  "cold_grade",
  "reframe",
  "rewind",
  "extend_establish",
  "cutto_interior",
  "page_studio",
  "sign_off",
  "inspect",
  "warm_grade",
  "bleach_grade",
] as const;
