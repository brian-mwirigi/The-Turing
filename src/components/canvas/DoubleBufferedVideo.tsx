"use client";

/**
 * Double-Buffered Video Player
 *
 * Implements the seamless crossfade architecture described in the strategic
 * analysis:
 *
 *   - Two <video> elements are layered via CSS opacity.
 *   - The "primary" plays the current chunk.
 *   - The "secondary" holds the pre-buffered continuation (the null-hypothesis
 *     chunk pre-generated in the background).
 *   - When the primary nears its end OR a branch is committed, we:
 *       1. Sync the secondary's playhead to 0
 *       2. Start playing the secondary
 *       3. Crossfade opacities
 *       4. Swap roles (secondary becomes primary, primary is flushed)
 *
 * Latency masking:
 *   - On user click, we set isSlowMo=true which drops playbackRate to 0.15
 *   - The user reads the A2UI panel (~5-10s cognitive time)
 *   - By the time they submit an action, the new chunk is generated
 *   - We then commit the branch and crossfade out of slow-mo
 */

import { motion } from "framer-motion";
import { forwardRef, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";

interface Props {
  onEnded?: () => void;
  onTimeUpdate?: (t: number, duration: number) => void;
}

/**
 * DoubleBufferedVideo
 *
 * The outer container doesn't expose a ref to the video element directly.
 * The page-level orchestrator attaches to whichever <video> is currently
 * playing via a polling interval (see page.tsx).
 */
export const DoubleBufferedVideo = forwardRef<HTMLDivElement, Props>(function DoubleBufferedVideo(
  { onEnded, onTimeUpdate },
  _ref
) {
  const primaryChunk = useCanvasStore((s) => s.primaryChunk);
  const secondaryChunk = useCanvasStore((s) => s.secondaryChunk);
  const branch = useCanvasStore((s) => s.branch);
  const isSlowMo = useCanvasStore((s) => s.isSlowMo);
  const slowMoFactor = useCanvasStore((s) => s.slowMoFactor);
  const promoteSecondary = useCanvasStore((s) => s.promoteSecondary);

  const primaryRef = useRef<HTMLVideoElement>(null);
  const secondaryRef = useRef<HTMLVideoElement>(null);

  // Which buffer is currently in front (0 = primary on top, 1 = secondary on top)
  const [frontBuffer, setFrontBuffer] = useState<0 | 1>(0);
  // Crossfade alpha 0..1 — animates between buffers during transition
  const [crossfade, setCrossfade] = useState<0 | 1>(0);
  // Whether the secondary has been pre-loaded and is ready to play
  const [secondaryReady, setSecondaryReady] = useState(false);

  // Load primary chunk into the primary buffer and reset transition state
  useEffect(() => {
    if (!primaryChunk || !primaryRef.current) return;
    const v = primaryRef.current;
    if (v.src !== primaryChunk.url) {
      v.src = primaryChunk.url;
      v.load();
      v.play().catch(() => {
        /* autoplay may be blocked; user interaction will resume */
      });
    }
    // Reset crossfade state when a new chunk loads
    setFrontBuffer(0);
    setCrossfade(0);
    setSecondaryReady(false);
  }, [primaryChunk]);

  // Pre-load secondary chunk silently
  useEffect(() => {
    if (!secondaryChunk || !secondaryRef.current) return;
    const v = secondaryRef.current;
    if (v.src !== secondaryChunk.url) {
      v.src = secondaryChunk.url;
      v.load();
      v.muted = true;
      // Preload but don't play yet
      v.currentTime = 0;
    }
  }, [secondaryChunk]);

  // Mark secondary as ready once it can play through
  const handleSecondaryCanPlay = () => setSecondaryReady(true);

  // Apply slow-mo to whichever buffer is in front
  useEffect(() => {
    const target = frontBuffer === 0 ? primaryRef.current : secondaryRef.current;
    if (target) target.playbackRate = isSlowMo ? slowMoFactor : 1.0;
    // Also apply to the back buffer so crossfade doesn't speed up
    const back = frontBuffer === 0 ? secondaryRef.current : primaryRef.current;
    if (back) back.playbackRate = isSlowMo ? slowMoFactor : 1.0;
  }, [isSlowMo, slowMoFactor, frontBuffer]);

  // Watch primary's timeupdate: when near the end, promote the secondary
  // (this is the seamless infinite-streaming trick)
  const handlePrimaryTimeUpdate = () => {
    const v = primaryRef.current;
    if (!v || !v.duration) return;
    onTimeUpdate?.(v.currentTime, v.duration);
    // If we're within 0.6s of the end and the secondary is ready, crossfade
    if (v.duration - v.currentTime < 0.6 && secondaryReady && crossfade === 0) {
      doCrossfadeToSecondary();
    }
  };

  const doCrossfadeToSecondary = () => {
    const sec = secondaryRef.current;
    if (!sec) return;
    sec.currentTime = 0;
    sec.play().catch(() => {});
    setCrossfade(1);
    // After crossfade completes, swap roles
    setTimeout(() => {
      setFrontBuffer(1);
      promoteSecondary();
      // Reset for next cycle
      setCrossfade(0);
      setSecondaryReady(false);
    }, 450);
  };

  // Expose imperative API via ref-less callback when primary ends
  const handlePrimaryEnded = () => {
    if (secondaryReady) doCrossfadeToSecondary();
    else onEnded?.();
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {/* Primary buffer */}
      <video
        ref={primaryRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        loop={!secondaryReady}
        onTimeUpdate={handlePrimaryTimeUpdate}
        onEnded={handlePrimaryEnded}
        style={{
          opacity: frontBuffer === 0 ? 1 - crossfade : crossfade,
          transition: "opacity 0.45s ease-in-out",
        }}
      />
      {/* Secondary buffer */}
      <video
        ref={secondaryRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
        loop={false}
        onCanPlayThrough={handleSecondaryCanPlay}
        onLoadedMetadata={handleSecondaryCanPlay}
        style={{
          opacity: frontBuffer === 0 ? crossfade : 1 - crossfade,
          transition: "opacity 0.45s ease-in-out",
        }}
      />

      {/* Crossfade scan-line overlay (cinematic transition flourish) */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: crossfade > 0.5 ? 0.6 : 0 }}
        transition={{ duration: 0.2 }}
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(34,211,238,0.08) 50%, transparent 100%)",
          mixBlendMode: "screen",
        }}
      />

      {/* Branch indicator (top-center chip) */}
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-slate-950/70 backdrop-blur px-3 py-1">
          <div className={`h-1.5 w-1.5 rounded-full ${branchColor(branch)} animate-pulse`} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200">
            branch:{branch}
          </span>
          {isSlowMo && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-fuchsia-300 ml-2">
              ⟁ slow-mo
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

function branchColor(branch: string): string {
  switch (branch) {
    case "main":
      return "bg-emerald-400";
    case "alert":
      return "bg-rose-400";
    case "reboot":
      return "bg-sky-400";
    case "veo31":
      return "bg-fuchsia-400";
    case "neutral":
      return "bg-cyan-400";
    default:
      return "bg-slate-400";
  }
}
