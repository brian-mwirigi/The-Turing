"use client";

/**
 * TitlePlate — the house lights before the projection.
 *
 * This is a film title card, not a landing page and not a separate "intro
 * film" that plays before the desk loads. Three layers, top to bottom:
 *
 *   1. Background plate. If `/canvas/intro.mp4` exists, it auto-plays
 *      muted + looped as the background surface BEHIND the title
 *      typography. Otherwise we fall back to the static
 *      `/canvas/poster.jpg`. Drop your own generated clip into
 *      `public/canvas/intro.mp4` (see `bun run gen:intro`) and the card
 *      upgrades its background — the typography and iris stay on top.
 *
 *   2. A slow amber vignette + film grain + a single horizontal scan shimmer
 *      all driven by framer-motion so they breathe rather than sit.
 *
 *   3. Brand: serif-italic title rendered as three stacked lines, a thesis
 *      line in the film-film serif, and a single amber-tipped gesture ("click
 *      inside the film").
 *
 * SoundGate unlocks audio first. Click here boots the live diorama with an
 * iris-collapse on the way out.
 */

import { motion } from "framer-motion";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";

export interface TitlePlateHandle {
  /** Unmute + play the intro plate. Must be called inside a user gesture. */
  unlockAudio: () => void;
}

interface Props {
  onBoot: () => void;
  isLive: boolean;
  /** When false the plate is under SoundGate — keep video muted until unlock. */
  audioUnlocked?: boolean;
}

export const TitlePlate = forwardRef<TitlePlateHandle, Props>(function TitlePlate(
  { onBoot, isLive, audioUnlocked = false },
  ref,
) {
  const [leaving, setLeaving] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [posterFailed, setPosterFailed] = useState(false);
  const [introFailed, setIntroFailed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(ref, () => ({
    unlockAudio: () => {
      const v = videoRef.current;
      if (!v) return;
      v.muted = false;
      void v.play().catch(() => {});
    },
  }));

  const handleMove = useCallback((e: React.MouseEvent) => {
    const el = frame.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: x * 8, y: y * -6 });
  }, []);

  const handleEnter = () => {
    if (leaving || !audioUnlocked) return;
    setLeaving(true);
    window.setTimeout(() => onBoot(), 720);
  };

  return (
    <motion.div
      ref={frame}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      animate={leaving ? { opacity: 0, scale: 1.04 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-50 overflow-hidden room-void"
      onClick={handleEnter}
      onMouseMove={handleMove}
      style={{ cursor: audioUnlocked ? "pointer" : "default" }}
    >
      {/* ===== Background plate: the intro.mp4 if present, otherwise poster.jpg ===== */}
      <motion.div className="absolute inset-0 z-0" animate={{ scale: 1.08 }} transition={{ duration: 0.6 }}>
        {!introFailed && (
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            src="/canvas/intro.mp4"
            autoPlay
            muted={!audioUnlocked}
            loop
            playsInline
            aria-hidden
            onError={() => setIntroFailed(true)}
          />
        )}
        {introFailed && !posterFailed && (
          <img
            className="absolute inset-0 h-full w-full object-cover"
            src="/canvas/poster.jpg"
            alt=""
            aria-hidden
            onError={() => setPosterFailed(true)}
          />
        )}
      </motion.div>

      {/* Warm theatre wash */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 70% 55% at 50% 42%, transparent 0%, rgba(8,6,4,0.45) 55%, rgba(4,3,2,0.95) 100%),
            linear-gradient(180deg, rgba(8,6,4,0.55) 0%, transparent 28%, transparent 58%, rgba(4,3,2,0.90) 100%)
          `,
        }}
        aria-hidden
      />

      {/* Amber leak — upper-right, the lamp's tell */}
      <motion.div
        className="pointer-events-none absolute -right-1/4 -top-1/4 h-[70vmax] w-[70vmax] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(233,210,163,0.16) 0%, rgba(193,154,93,0.04) 35%, transparent 65%)",
          mixBlendMode: "screen",
        }}
        animate={{ opacity: [0.55, 0.88, 0.55], rotate: [0, 6, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden
      />

      {/* Persistent film grain */}
      <div
        className="film-grain pointer-events-none absolute inset-0 opacity-[0.10] mix-blend-overlay"
        aria-hidden
      />

      {/* Soft iris collapse on leave — the title close */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 1 : 0 }}
        transition={{ duration: 0.55, ease: "easeIn" }}
        style={{
          background:
            "radial-gradient(circle at center, transparent 0%, rgba(4,3,2,0.55) 42%, rgba(4,3,2,1) 72%)",
        }}
        aria-hidden
      />

      {/* ===== Brand composition — story leads, title stays quiet ===== */}
      <div className="relative z-10 flex h-full w-full items-center justify-center px-8 sm:px-14">
        <motion.div
          className="flex w-full max-w-2xl flex-col items-center text-center"
          animate={{ x: tilt.x * -0.4, y: tilt.y * -0.3 }}
          transition={{ type: "tween", ease: "easeOut", duration: 0.4 }}
        >
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.12 }}
            className="mb-4 text-[10px] uppercase tracking-[0.42em]"
            style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.48)" }}
          >
            {isLive ? "live projection · fal.ai" : "demo reel · the cutting room"}
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="select-none"
            style={{
              fontFamily: "var(--font-film)",
              color: "rgba(255,248,235,0.72)",
              fontSize: "clamp(0.95rem, 2.2vw, 1.15rem)",
              fontWeight: 400,
              letterSpacing: "0.02em",
            }}
          >
            The Turing-Complete{" "}
            <span style={{ fontStyle: "italic", color: "rgba(233,210,163,0.88)" }}>
              Canvas
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, delay: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="mt-7 max-w-xl leading-[1.35]"
            style={{
              fontFamily: "var(--font-film)",
              color: "rgba(255,248,235,0.94)",
              fontSize: "clamp(1.55rem, 4.2vw, 2.35rem)",
              fontWeight: 600,
              textShadow: "0 2px 36px rgba(0,0,0,0.55)",
            }}
          >
            A filmmaker died mid-edit of the only film she ever cared about.
            Her cutting room is left as it was. Giving you the brush and
            asking you to{" "}
            <span style={{ fontStyle: "italic", color: "rgba(233,210,163,0.95)" }}>
              paint
            </span>
            .
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.55 }}
            className="mt-10 flex items-center justify-center"
          >
            <span
              className="relative inline-flex items-center gap-3 text-[11px] uppercase tracking-[0.34em]"
              style={{ fontFamily: "var(--font-studio)", color: "rgba(255,248,235,0.78)" }}
            >
              <motion.span
                className="inline-block h-[1px] w-8 origin-left"
                style={{ background: "rgba(233,210,163,0.65)" }}
                animate={{ scaleX: [0.4, 1, 0.4] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
              Click inside the film
              <motion.span
                aria-hidden
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                style={{ color: "rgba(233,210,163,0.9)" }}
              >
                ▸
              </motion.span>
            </span>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
});
