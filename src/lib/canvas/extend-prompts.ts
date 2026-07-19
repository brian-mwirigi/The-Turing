/**
 * LTX / Veo prompt assembly.
 *
 * Non-cutaway pattern:
 *   [MOVES / DOES NOT MOVE] + [cine] + [camera+set lock]
 *
 * Cutaways / hero: full standalone strings (no room lock).
 */

import type { BranchId } from "./types";

export const CINE_BASE = "16mm grain, hard tungsten practical, long shadows.";

/**
 * Camera/set lock — keep "static camera" SEPARATE from "keep motion alive".
 * Phrases like "frame holds / unchanged" made LTX freeze the effect by the out.
 */
export const FRAME_LOCK =
  "Camera remains static and locked throughout — same wide tripod framing and distance to the desk as the input. " +
  "NO zoom, NO push-in, NO dolly, NO track, NO pan, NO tilt, NO close-up. " +
  "Same Steenbeck with two reels, Royal typewriter with page, coffee mug, Bolex on tripod, open coastal window. " +
  "Do not add objects. Do not relocate props. No fog, no thick white vapor, no cotton clouds, no new lamps, no green walls. " +
  "Only the parts listed under MOVES may change. " +
  "Motion continues naturally to the final frame — do not freeze, settle, or hold still at the end.";

/** Only reframe may pan the Bolex head — still no dolly/zoom; keep pan alive to the out. */
export const FRAME_LOCK_REFRAME =
  "Camera BODY remains static and locked on the tripod — no dolly, no zoom, no push-in. " +
  "Only the Bolex tripod HEAD may pan. Desk props stay put. No fog, no new objects. " +
  "The pan continues naturally to the final frame — do not freeze or settle still at the end.";

export const LTX_NEGATIVE_PROMPT =
  "camera zoom, push-in, dolly in, tracking shot, crane, reframing, close-up cut, rack focus to close-up, " +
  "thick fog, white blobs, cotton vapor, solid steam column, smoke filling the room, billowing clouds, " +
  "new desk lamp, new furniture, green walls, restaged room, different camera angle, different lens, " +
  "CGI haze, melting objects, dream sequence, surreal morphing, morphing set, " +
  "freeze frame, static hold, motion stopping, stillness at end, settling to freeze";

/** Step 11 — leave the room. Seed may be interior; forbid blend. */
export const EXTEND_ESTABLISH_PROMPT =
  "HARD CUT to a new exterior wide shot — not a morph, not a pan out the window. " +
  "Pacific coastline at low tide, grey overcast surf, single cypress at frame-left, natural daylight. " +
  "MOVES: ocean waves, wind in the cypress. " +
  "DOES NOT APPEAR: desk, Steenbeck, typewriter, coffee mug, Bolex, cutting room, tungsten light, interior walls. " +
  "16mm grain, outdoor only.";

/**
 * Step 12 — return to room.
 * Technical seed is the last-interior clip (rewind), NOT original room_seed.mp4
 * and NOT the Pacific cutaway.
 */
export const CUTTO_INTERIOR_PROMPT =
  "HARD CUT back to the wide 1974 cutting-room desk. " +
  "Match THIS input video's room state exactly (the last interior plate fed as seed — not the original room, not the coastline). " +
  "MOVES: none for props — room stays as seeded; only natural grain/dust may live. " +
  "DOES NOT APPEAR: ocean, coastline, beach, exterior sky. " +
  "Camera remains static and locked. NO zoom, NO push-in. " +
  `${CINE_BASE} Same Steenbeck, typewriter, mug, Bolex, window as the input. Do not restage.`;

/**
 * Step 14 — Veo hero. Dialogue must feel earned by the path (burn → cold → return),
 * not "the system chose you."
 */
export const VEO_HERO_PROMPT =
  "Photoreal live-action continuing from the seed frame of the empty 1974 cutting room. " +
  "MOVES: a real woman mid-40s (tired film editor, unstyled brown hair with grey at temples, no makeup, visible pores, " +
  "worn flannel over a plain tee) opens the stage-left door, walks in with a ceramic mug, sets it on the desk, " +
  "turns to camera, speaks quietly dry close-mic. " +
  "DOES NOT MOVE: camera body on locked tripod — no zoom, no dolly. Same Steenbeck, typewriter, Bolex, window. " +
  "Available tungsten only, long hard shadows, heavy 16mm grain, soft focus, 24fps documentary. No beauty light, no VFX.\n" +
  'Sample Dialogue:\nImogen (quiet, dry): "You burned the leader. You let it sit cold. And still you came back."';

export const VEO_NEGATIVE_PROMPT =
  "CGI, 3D render, plastic skin, digital beauty filter, porcelain face, uncanny valley, " +
  "over-smooth skin, airbrushed, perfect makeup, fashion model, AI face, morphing face, " +
  "glowing skin, neon, lens flare spam, cinematic color grade, HDR, " +
  "cartoon, anime, wax figure, doll, symmetrical face, stock actress, camera zoom, dolly in";

export function isCutawayBranch(branch: BranchId | string): boolean {
  return branch === "extend_establish" || branch === "summon_operator";
}

export function assembleExtendPrompt(
  beat: string,
  branch: BranchId | string,
  actionId?: string,
): string {
  if (branch === "extend_establish" || actionId === "extend_establish") {
    return EXTEND_ESTABLISH_PROMPT;
  }
  if (branch === "cutto_interior" || actionId === "cutto_interior") {
    return CUTTO_INTERIOR_PROMPT;
  }
  if (branch === "summon_operator" || actionId === "summon_operator") {
    return VEO_HERO_PROMPT;
  }
  const action = beat.replace(/^[\s—-]+/, "").trim().replace(/\.\.+$/, ".");
  const mid = action.endsWith(".") ? action : `${action}.`;
  const lock = actionId === "reframe" ? FRAME_LOCK_REFRAME : FRAME_LOCK;
  return `${mid} ${CINE_BASE} ${lock}`;
}
