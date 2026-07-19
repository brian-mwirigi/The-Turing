"use client";

/**
 * FilmGate — the double-buffered projection engine.
 *
 * Two stacked <video> planes live inside a 2.39:1 film holder.
 *   - Plane A holds the playing cut (the current chunk).
 *   - Plane B is pre-loaded with the null-hypothesis continuation.
 *
 * Two transition cuts are handled:
 *
 *   1. Continuous extension (null-hypothesis crossfade).
 *      As A nears its end, B is rolled in with a 0.4s luminance-matched
 *      crossfade + a faint gate-blip (a 90ms bleach flash along the seam).
 *      This is the "before anyone clicks" perpetual motion of the room.
 *
 *   2. Branch commit (the cut).
 *      When the store commits a branch we do not a crossfade fade a fade a
 *      branch. We roll a 380ms film-leader whip: a dark horizontal move,
 *      an amber exposure flash, then the new plane settles. This reads as
 *      "the editor cut" and preserves the cinematic register the assets
 *      already carry.
 *
 *   3. Slow-mo (latency mask).
 *      On User Click the store flips `isSlowMo`; both planes slow to 0.18
 *      so the audience reads the slate while the next cut queues off-line.
 *      When User commits the branch, slow-mo releases with a 0.3s ease.
 *
 * The engine never shows a loading spinner — a stuck room is *on purpose*.
 */

import { AnimatePresence, motion } from "framer-motion";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import type { BranchId } from "@/lib/canvas/types";

export interface FilmGateHandle {
  /** Returns the <video> currently playing (for client-side frame capture). */
  captureVideo: () => HTMLVideoElement | null;
}

interface Props {
  onEnded?: () => void;
  onTimeUpdate?: (t: number, duration: number) => void;
  /** false after SoundGate unlock — intro plate carries audio. */
  muted?: boolean;
}

/** Branch ids whose commit definitely means a different emotional beat — the
 *  cut deck plays a leader whip. Branches that are "ambient continuation of
 *  the same beat" skip the whip and arrive by quiet crossfade. */
const WHIP_BRANCHES: BranchId[] = [
  "splice",
  "roll_take",
  "cut_take",
  "continue_page",
  "sign_off",
  "scratch_line",
  "burn",
  "recover",
  "rewind",
  "advance_clock",
  "page_studio",
  "summon_operator",
  "extend_establish",
  "cutto_interior",
  "warm_grade",
  "cold_grade",
  "bleach_grade",
];

/** room_seed.mp4 is ~4.0s — fal extend returns seed+tail. Stay past this. */
const LIVE_SEED_HEAD_SEC = 3.6;

function isLiveChunk(chunk: { source: string; url: string } | null | undefined) {
  if (!chunk) return false;
  return (
    chunk.source === "ltx23" ||
    chunk.source === "veo31" ||
    chunk.url.includes("fal.media")
  );
}

function liveTailStart(duration: number) {
  if (!Number.isFinite(duration) || duration <= 1) return 0;
  // Prefer just before the seam; if clip is short, start past the midpoint.
  return duration > LIVE_SEED_HEAD_SEC + 0.5
    ? LIVE_SEED_HEAD_SEC
    : Math.max(0, duration * 0.55);
}

export const FilmGate = forwardRef<FilmGateHandle, Props>(function FilmGate(
  { onEnded, onTimeUpdate, muted = true },
  ref,
) {
  const primaryChunk = useCanvasStore((s) => s.primaryChunk);
  const secondaryChunk = useCanvasStore((s) => s.secondaryChunk);
  const isSlowMo = useCanvasStore((s) => s.isSlowMo);
  const slowMoFactor = useCanvasStore((s) => s.slowMoFactor);
  const branch = useCanvasStore((s) => s.branch);
  const promoteSecondary = useCanvasStore((s) => s.promoteSecondary);

  const aRef = useRef<HTMLVideoElement | null>(null);
  const bRef = useRef<HTMLVideoElement | null>(null);

  // Which plane is currently front ("a" or "b")
  const [front, setFront] = useState<"a" | "b">("a");
  // 0..1 crossfade alpha between A and B (only animates near end-of-chunk)
  const [crossfade, setCrossfade] = useState(0);
  // Whether B is loaded and ready to play
  const [bReady, setBReady] = useState(false);
  // Fire a leader whip when the committed branch is a "cut"
  const [whip, setWhip] = useState(false);
  const lastBranchRef = useRef<BranchId>(branch);
  const frontRef = useRef<"a" | "b">("a");
  /** Tail-loop start for the active live cut (0 = ambient / full loop). */
  const liveTailRef = useRef(0);
  /** Same blob/http URL on both planes for invisible live wraps. */
  const livePlayUrlRef = useRef<string | null>(null);
  const liveWrapBusyRef = useRef(false);
  /** blob: URLs we created so we can revoke them (keeps canvas untainted). */
  const blobUrlsRef = useRef<string[]>([]);
  /** Longer dissolve while soft-looping a live cut (ms). */
  const [seamMs, setSeamMs] = useState(350);
  /** Ambient rate dither from the active primary chunk (live cuts stay 1.0). */
  const ambientRateRef = useRef(1);

  /**
   * Anti-loop crossfade timing — the invisible-look trick lives here.
   *
   * Two window sizes, reseeded for every ambient crossfade so no two adjacent
   * transitions share a beat position:
   *
   *   - `silentPreRollWindow` — how far before the primary's end the secondary
   *     plane wakes up at ~32% rate and starts silently drifting from its
   *     park position. (Move D.) By the time the crossfade fires, plane B
   *     is *already in motion* — the audience never sees the "two adjacent
   *     clips both started fresh" tell that gives away every demo loop.
   *   - `crossfadeFireWindow` — how far before the primary's end plane B
   *     ramps to full rate + opacity crossfade begins. (Move C. ±0.15s
   *     seeded jitter per pick kills the "I saw this beat 6s ago" pattern.)
   *
   * Both are picked fresh on every crossfade settle. Start modest so the
   * first run on any clip (boot → first crossfade) still has sane values.
   */
  const silentPreRollWindow = useRef(1.6);
  const crossfadeFireWindow = useRef(0.55);
  /** True once silent pre-roll has already started for the live crossfade. */
  const preRollActiveRef = useRef(false);

  const reseedCrossfadeTimings = () => {
    // Pre-roll window: 1.25s .. 2.10s, seeded per crossfade.
    silentPreRollWindow.current = 1.25 + Math.random() * 0.85;
    // Fire window: 0.40s .. 0.70s, seeded per crossfade, never beats last
    // position within 0.10s (force a different beat than the prior pass).
    let candidate = 0.4 + Math.random() * 0.3;
    if (Math.abs(candidate - crossfadeFireWindow.current) < 0.1) {
      candidate = candidate < 0.55 ? candidate + 0.15 : candidate - 0.15;
    }
    crossfadeFireWindow.current = candidate;
  };

  useEffect(() => {
    frontRef.current = front;
  }, [front]);

  useEffect(() => {
    return () => {
      for (const u of blobUrlsRef.current) URL.revokeObjectURL(u);
      blobUrlsRef.current = [];
    };
  }, []);

  // Expose capture port
  useImperativeHandle(ref, () => ({
    captureVideo: () => (front === "a" ? aRef.current : bRef.current),
  }), [front]);

  // --- Load primary onto the back plane, then cut it in.
  //     Intentionally omits `front` from deps — swapping planes must not
  //     re-trigger this effect (that ping-ponged both buffers and left black).
  //
  //     CRITICAL: fal extend-video returns seed+tail. The first ~4s is the
  //     identical room_seed replay — we SEEK into the generated tail or
  //     every "successful" generate looks like nothing happened.
  //
  //     Also: remote fal URLs taint canvas capture. We re-host as blob:
  //     when CORS allows so clicks can still toDataURL after a live cut.
  useEffect(() => {
    if (!primaryChunk) return;
    const incomingPlane = frontRef.current === "a" ? "b" : "a";
    const v = incomingPlane === "a" ? aRef.current : bRef.current;
    if (!v) return;
    const url = primaryChunk.url;
    const isLiveCut = isLiveChunk(primaryChunk);
    const remote = /^https?:\/\//i.test(url);

    let cancelled = false;
    let blobUrl: string | null = null;

    const rollIn = () => {
      if (cancelled) return;

      const isNewBranch = lastBranchRef.current !== primaryChunk.branch;
      const whipThis =
        isLiveCut || (isNewBranch && WHIP_BRANCHES.includes(primaryChunk.branch));
      lastBranchRef.current = primaryChunk.branch;

      let shown = false;
      const playAndShow = () => {
        if (cancelled || shown) return;
        shown = true;
        v.play().catch(() => {});
        setFront(incomingPlane);
        setCrossfade(0);
        setBReady(false); // block ambient crossfade while live cut is settling
        liveWrapBusyRef.current = false;

        // Mirror the live cut onto the back plane so we can dissolve the wrap.
        if (isLiveCut && livePlayUrlRef.current) {
          const backPlane = incomingPlane === "a" ? "b" : "a";
          const back = backPlane === "a" ? aRef.current : bRef.current;
          const playUrl = livePlayUrlRef.current;
          if (back && playUrl) {
            if (back.src !== playUrl) {
              back.crossOrigin = v.crossOrigin;
              back.src = playUrl;
              back.load();
            }
            back.loop = false;
            back.muted = muted;
            back.playsInline = true;
            const park = () => {
              try {
                back.currentTime = liveTailRef.current;
              } catch {
                /* ignore */
              }
              back.pause();
            };
            if (back.readyState >= 2) park();
            else back.addEventListener("loadeddata", park, { once: true });
          }
        }
      };

      const afterSeek = () => {
        if (whipThis) {
          setWhip(true);
          window.setTimeout(() => {
            playAndShow();
            window.setTimeout(() => setWhip(false), 500);
          }, 320);
        } else {
          playAndShow();
        }
      };

      // Jump past the seed head into the NEW frames.
      if (isLiveCut && Number.isFinite(v.duration) && v.duration > 1) {
        const jump = liveTailStart(v.duration);
        liveTailRef.current = jump;
        console.log(
          `[FilmGate] live cut → seek ${jump.toFixed(2)}s / ${v.duration.toFixed(2)}s`,
          url.slice(0, 72),
        );
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          afterSeek();
        };
        v.addEventListener("seeked", onSeeked);
        try {
          v.currentTime = jump;
        } catch {
          afterSeek();
        }
        window.setTimeout(() => {
          v.removeEventListener("seeked", onSeeked);
          if (!cancelled && !shown) afterSeek();
        }, 800);
      } else {
        // Ambient breath — park mid-frame + apply rate dither (store.ts).
        liveTailRef.current = 0;
        livePlayUrlRef.current = null;
        const authoredRate =
          typeof primaryChunk.rate === "number" && primaryChunk.rate > 0
            ? primaryChunk.rate
            : 1;
        ambientRateRef.current = authoredRate;
        v.playbackRate = isSlowMo ? slowMoFactor : authoredRate;

        const parkRaw = primaryChunk.parkSec;
        const park =
          typeof parkRaw === "number" && Number.isFinite(v.duration) && v.duration > 0.5
            ? Math.min(Math.max(0.05, parkRaw), Math.max(0.05, v.duration - 0.35))
            : 0;

        if (park > 0) {
          const onSeeked = () => {
            v.removeEventListener("seeked", onSeeked);
            afterSeek();
          };
          v.addEventListener("seeked", onSeeked);
          try {
            v.currentTime = park;
          } catch {
            afterSeek();
          }
          window.setTimeout(() => {
            v.removeEventListener("seeked", onSeeked);
            if (!cancelled && !shown) afterSeek();
          }, 800);
        } else {
          v.currentTime = 0;
          afterSeek();
        }
      }
    };

    const attachAndPlay = (playUrl: string, sameOrigin: boolean) => {
      if (cancelled) return;
      // Same-origin / blob: → capture works. Remote without CORS → don't set
      // crossOrigin (playback works, capture falls back to placeholder).
      if (sameOrigin) {
        v.crossOrigin = "anonymous";
      } else {
        v.removeAttribute("crossOrigin");
      }
      livePlayUrlRef.current = isLiveCut ? playUrl : null;
      v.src = playUrl;
      v.load();
      v.playsInline = true;
      v.muted = muted;
      v.loop = !isLiveCut;

      const onCan = () => rollIn();
      v.addEventListener("canplaythrough", onCan, { once: true });
      if (v.readyState >= 3) onCan();
    };

    (async () => {
      if (remote) {
        try {
          const res = await fetch(url, { mode: "cors" });
          if (res.ok) {
            const blob = await res.blob();
            if (cancelled) return;
            blobUrl = URL.createObjectURL(blob);
            blobUrlsRef.current.push(blobUrl);
            attachAndPlay(blobUrl, true);
            return;
          }
        } catch {
          /* fal CDN may block CORS fetch — play URL directly */
        }
        if (!cancelled) attachAndPlay(url, false);
        return;
      }
      attachAndPlay(url, true);
    })();

    return () => {
      cancelled = true;
    };
  }, [primaryChunk, muted]);

  // --- Pre-load ambient continuation. Skip for live cuts — crossfading back
  //     to room_loop (or replaying the seed head) made generates look identical.
  useEffect(() => {
    if (!secondaryChunk) return;
    if (isLiveChunk(primaryChunk)) return;
    if (primaryChunk && secondaryChunk.url === primaryChunk.url) return;
    const backPlane = front === "a" ? "b" : "a";
    const v = backPlane === "a" ? aRef.current : bRef.current;
    if (!v) return;
    const url = secondaryChunk.url;
    const same = (() => {
      if (!v.src) return false;
      try {
        return v.src === new URL(url, window.location.href).href;
      } catch {
        return v.src.endsWith(url);
      }
    })();
    if (!same) {
      v.src = url;
      v.load();
      v.playsInline = true;
    }
    v.muted = muted;
    // Disable native loop while the plane sits parked behind the front.
    // Silent pre-roll starts it playing at a sub-rate for ~1.2s before the
    // crossfade fires; if native `loop` were armed, that pre-roll could wrap
    // silently to t=0 mid-preroll — which would snap the dust back to its
    // start-frame exactly when FilmGate is racing to make the crossfade
    // invisible. Native loop is re-armed only as the hardware fallback when
    // the plane reaches the front (handled in the primary-load effect).
    v.loop = false;
    // Park the pre-buffered breath mid-frame so the ambient crossfade
    // never lands on t=0 when a parkSec is authored. The
    // plane is also paused here so it sits silent and ready for the
    // silent pre-roll handshake in handleTimeUpdate. Without the explicit
    // pause, a same-URL rotation (e.g. two consecutive ambient picks
    // funnelled through fallback to the same long-breath clip) leaves the
    // plane quietly playing at its former pre-roll rate, throwing off the
    // next crossfade's park-phase alignment.
    v.pause();
    const parkRaw = secondaryChunk.parkSec;
    const applyPark = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0.5) {
        v.currentTime = 0;
        return;
      }
      const park =
        typeof parkRaw === "number"
          ? Math.min(Math.max(0.05, parkRaw), Math.max(0.05, v.duration - 0.35))
          : 0;
      v.currentTime = park;
    };
    if (v.readyState >= 1) applyPark();
    else v.addEventListener("loadedmetadata", applyPark, { once: true });
  }, [secondaryChunk, primaryChunk, front, muted]);

  const handleBCanPlay = () => {
    // Never arm ambient crossfade while a live fal cut is on screen.
    if (isLiveChunk(primaryChunk)) return;
    setBReady(true);
  };

  // Whenever a new primary lands (live cut or ambient commit), reset the
  // silent pre-roll handshake so the next crossfade starts from a clean
  // park state. Also reseed the crossfade timing windows so the first
  // transition in any sequence doesn't use the same window the last
  // ambient sequence happened to land on.
  useEffect(() => {
    preRollActiveRef.current = false;
    reseedCrossfadeTimings();
    const backPlane = frontRef.current === "a" ? "b" : "a";
    const backEl = backPlane === "a" ? aRef.current : bRef.current;
    // Live cuts wrap through softLoopLiveCut, not native loop. Ambient
    // does loop (handled via the crossfade-equivalent handshake). Park + loop
    // arm/disarm is set by the dedicated effects below — this just clears
    // the in-flight flag so a pre-roll started before the swap doesn't
    // leak into the new sequence.
    if (backEl) backEl.pause();
  }, [primaryChunk]);

  // --- Apply slow-mo to the live plane (the latency mask)
  useEffect(() => {
    const v = front === "a" ? aRef.current : bRef.current;
    if (!v) return;
    v.playbackRate = isSlowMo ? slowMoFactor : ambientRateRef.current;
    // Re-arm native loop on the front plane. The [secondaryChunk] pre-load
    // effect disarms `loop` (false) so pre-roll can't snap the parked
    // plane silently back to t=0; re-arm here when this plane becomes the
    // front so the browser's hardware fallback never leaves a stuck last
    // frame if all JS crossfade triggers somehow miss. Live cuts always
    // keep native loop off (they wrap through softLoopLiveCut).
    v.loop = !isLiveChunk(primaryChunk);
  }, [isSlowMo, slowMoFactor, front, primaryChunk]);

  /** Invisible wrap: dissolve into the mirrored plane already parked on the tail. */
  const softLoopLiveCut = () => {
    if (liveWrapBusyRef.current || liveTailRef.current <= 0) return;
    const playUrl = livePlayUrlRef.current;
    if (!playUrl) return;

    const frontEl = front === "a" ? aRef.current : bRef.current;
    const backPlane = front === "a" ? "b" : "a";
    const backEl = backPlane === "a" ? aRef.current : bRef.current;
    if (!frontEl || !backEl) return;

    liveWrapBusyRef.current = true;
    setSeamMs(700);
    let started = false;

    const startDissolve = () => {
      if (started) return;
      started = true;
      try {
        backEl.currentTime = liveTailRef.current;
      } catch {
        /* ignore */
      }
      backEl.playbackRate = frontEl.playbackRate;
      backEl.muted = muted;
      backEl.play().catch(() => {});
      setCrossfade(1);
      window.setTimeout(() => {
        setFront(backPlane);
        setCrossfade(0);
        frontEl.pause();
        try {
          frontEl.currentTime = liveTailRef.current;
        } catch {
          /* ignore */
        }
        liveWrapBusyRef.current = false;
        setSeamMs(350);
      }, 700);
    };

    const needsLoad = !backEl.src || (backEl.currentSrc !== playUrl && backEl.src !== playUrl);

    if (needsLoad) {
      backEl.crossOrigin = frontEl.crossOrigin;
      backEl.src = playUrl;
      backEl.load();
      backEl.loop = false;
      backEl.addEventListener("canplay", startDissolve, { once: true });
      window.setTimeout(startDissolve, 900);
    } else {
      startDissolve();
    }
  };

  // --- Ambient: near end → roll in B. Live: soft-dissolve wrap on the tail.
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (!v.duration) return;
    onTimeUpdate?.(v.currentTime, v.duration);

    if (isLiveChunk(primaryChunk) && liveTailRef.current > 0) {
      // Start the dissolve early so the hard cut never reads.
      if (v.duration - v.currentTime < 0.75 && crossfade === 0) {
        softLoopLiveCut();
      }
      return;
    }

    const remaining = v.duration - v.currentTime;

    // ----- (D) Silent pre-roll: wake the secondary well before crossfade.
    // B is already parked at its `parkSec` by the [secondaryChunk] effect.
    // Start it playing at a sub-rate (~0.32×) so by the time the crossfade
    // fires, B is ALREADY IN MOTION from its park offset — not restarting
    // from a frozen frame. This is the single move that kills the "two
    // adjacent clips both restarted their motion" tell.
    if (
      !preRollActiveRef.current &&
      remaining < silentPreRollWindow.current &&
      remaining > crossfadeFireWindow.current + 0.05 &&
      bReady
    ) {
      const backPlane = front === "a" ? "b" : "a";
      const b = backPlane === "a" ? aRef.current : bRef.current;
      if (b) {
        preRollActiveRef.current = true;
        const preRate =
          (typeof secondaryChunk?.rate === "number" && secondaryChunk.rate > 0
            ? secondaryChunk.rate
            : 1) * 0.32;
        b.playbackRate = isSlowMo ? slowMoFactor : preRate;
        b.muted = muted;
        b.play().catch(() => {});
      }
    }

    // ----- (C) Crossfade fire: seeded per-pick window so no two adjacent
    // transitions share a beat position.
    if (remaining < crossfadeFireWindow.current && bReady && crossfade === 0) {
      const backPlane = front === "a" ? "b" : "a";
      const b = backPlane === "a" ? aRef.current : bRef.current;
      if (!b) return;
      setSeamMs(450);
      // Secondary is already parked at parkSec — don't reset to 0.
      const nextRate =
        typeof secondaryChunk?.rate === "number" && secondaryChunk.rate > 0
          ? secondaryChunk.rate
          : 1;
      ambientRateRef.current = nextRate;
      // Ramp B up to full rate (it was at 0.32× during pre-roll).
      b.playbackRate = isSlowMo ? slowMoFactor : nextRate;
      // If pre-roll never armed (e.g. bReady flipped late), play it now from park.
      if (!preRollActiveRef.current) b.play().catch(() => {});
      setCrossfade(1);
      const fireMs = 450;
      setTimeout(() => {
        setFront(backPlane);
        promoteSecondary();
        setCrossfade(0);
        setBReady(false);
        setSeamMs(350);
        // Reseed for the NEXT crossfade so no two adjacent beats line up.
        preRollActiveRef.current = false;
        reseedCrossfadeTimings();
      }, fireMs);
    }
  };

  const handleEnded = () => {
    if (isLiveChunk(primaryChunk) && liveTailRef.current > 0) {
      softLoopLiveCut();
      return;
    }
    // Ambient reach-end: the crossfade path should normally have fired
    // earlier via handleTimeUpdate (silentPreRoll → fire). If it didn't
    // (e.g. bReady was late), restore the primary plane to its authored
    // park offset and continue — instead of the old snap-to-0 (bug 5/6
    // tells: "the clip restarted at t=0"). Park reseed picks the same
    // film but a different beat, so the wrap reads as ambient breath, not
    // a hard cut. Native `loop` also stays armed so worst case still plays.
    const frontEl = front === "a" ? aRef.current : bRef.current;
    if (bReady) {
      const backPlane = front === "a" ? "b" : "a";
      const b = backPlane === "a" ? aRef.current : bRef.current;
      if (!b) {
        onEnded?.();
        return;
      }
      const nextRate =
        typeof secondaryChunk?.rate === "number" && secondaryChunk.rate > 0
          ? secondaryChunk.rate
          : 1;
      ambientRateRef.current = nextRate;
      b.playbackRate = isSlowMo ? slowMoFactor : nextRate;
      b.muted = muted;
      b.play().catch(() => {});
      setCrossfade(1);
      setTimeout(() => {
        setFront(backPlane);
        promoteSecondary();
        setCrossfade(0);
        setBReady(false);
        setSeamMs(350);
        preRollActiveRef.current = false;
        reseedCrossfadeTimings();
      }, 450);
    } else if (frontEl) {
      // No secondary armed — soft-rewrap by seeking the same plane back to
      // its authored park. Native loop is allowed to fire as the hardware
      // fallback; we just nudge it past frame 0 so the eye doesn't clock
      // "the clip restarted at t=0".
      const parkRaw = primaryChunk?.parkSec;
      const park =
        typeof parkRaw === "number" &&
        Number.isFinite(frontEl.duration) &&
        frontEl.duration > 0.5
          ? Math.min(Math.max(0.05, parkRaw), Math.max(0.05, frontEl.duration - 0.35))
          : frontEl.duration * 0.42;
      frontEl.play().catch(() => {});
      try {
        frontEl.currentTime = park;
      } catch {
        /* ignore — native loop will fire */
      }
    } else {
      onEnded?.();
    }
  };

  // Opacities: front plane 1 at crossfade=0 -> 0 at crossfade=1; back inverse.
  const aOpacity = front === "a" ? 1 - crossfade : crossfade;
  const bOpacity = front === "b" ? 1 - crossfade : crossfade;
  // Native loop restarts at t=0 (seed head). Live cuts wrap in JS instead.
  const allowNativeLoop = !isLiveChunk(primaryChunk);
  const fadeTransition = `opacity ${seamMs}ms ease-in-out`;

  return (
    <div className="absolute inset-0 overflow-hidden room-void">
      {/* ===== Plane A ===== */}
      <video
        ref={aRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        preload="auto"
        muted={muted}
        loop={allowNativeLoop}
        onTimeUpdate={front === "a" ? handleTimeUpdate : undefined}
        onEnded={front === "a" ? handleEnded : undefined}
        style={{
          opacity: aOpacity,
          transition: fadeTransition,
        }}
      />
      {/* ===== Plane B ===== */}
      <video
        ref={bRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        preload="auto"
        muted={muted}
        loop={allowNativeLoop}
        onCanPlayThrough={handleBCanPlay}
        onLoadedMetadata={handleBCanPlay}
        onTimeUpdate={front === "b" ? handleTimeUpdate : undefined}
        onEnded={front === "b" ? handleEnded : undefined}
        style={{
          opacity: bOpacity,
          transition: fadeTransition,
        }}
      />

      {/* ===== Anamorphic matte (2.39:1 letterbox + gate edge falloff) ===== */}
      <div className="film-gate z-10" aria-hidden />

      {/* ===== Crossfade exposure blip — a single-frame of warm gate-wash ===== */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-20"
        initial={false}
        animate={{ opacity: crossfade > 0.5 ? 1 : 0 }}
        style={{
          background:
            "radial-gradient(ellipse 90% 80% at 50% 50%, rgba(233,210,163,0.10) 0%, transparent 70%)",
          mixBlendMode: "screen",
        }}
      />

      {/* ===== Leader whip — the cut ===== */}
      <AnimatePresence>
        {whip && (
          <motion.div
            key="leader"
            className="pointer-events-none absolute inset-0 z-40"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Black film leader sweeping horizontally */}
            <motion.div
              className="absolute inset-0"
              style={{ background: "#040302" }}
              initial={{ scaleX: 1, transformOrigin: "center" }}
              animate={{ scaleX: [1, 1, 0], opacity: [1, 1, 0] }}
              transition={{ duration: 0.62, times: [0, 0.5, 1], ease: [0.22, 1, 0.36, 1] }}
            />
            {/* Brief amber exposure flash — a single frame of the new cut */}
            <motion.div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(233,210,163,0.28) 50%, transparent 100%)",
                mixBlendMode: "screen",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.7, 0] }}
              transition={{ duration: 0.18, delay: 0.42, ease: "easeOut" }}
            />
            {/* Sprocket-hole leader chip for a single beat — the "this was a cut" tell */}
            <motion.div
              className="leader-chip absolute left-0 right-0 top-1/2 h-3"
              initial={{ y: "-50%", opacity: 0 }}
              animate={{ y: ["-50%", "-50%", "-50%"], opacity: [0, 0.6, 0] }}
              transition={{ duration: 0.5, times: [0, 0.4, 1] }}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
});
