/**
 * POST /api/canvas/seed
 *
 * Eager, fire-and-forget warm-up invoked from `useCanvasStore.bootMain()` the
 * moment the cutting-room opens. Calls `uploadRoomLoopSeed()` so the first
 * `/api/canvas/generate` POST after the user picks an action doesn't pay the
 * 200–400ms fal.storage upload tax (the LTX-2.3 extend endpoint needs a
 * fal-hosted `video_url`, and the room seed is the only capture long enough).
 *
 * Idempotent: `uploadRoomLoopSeed()` caches its first successful URL in a
 * module-scoped `_roomSeedUrl`. In demo mode (no `FAL_KEY`) it returns "" and
 * the client just discards the response. Failures never reach the UI — the
 * client never awaits this route.
 */

import { NextResponse } from "next/server";
import { isLiveMode, uploadRoomLoopSeed } from "@/lib/canvas/fal-client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  if (!isLiveMode()) {
    return NextResponse.json({ live: false, url: "" });
  }
  const url = await uploadRoomLoopSeed();
  return NextResponse.json({ live: url.length > 0, url });
}
