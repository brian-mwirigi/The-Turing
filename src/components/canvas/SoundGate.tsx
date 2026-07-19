"use client";

/**
 * SoundGate — blank theatre door.
 *
 * Browsers block media audio until a user gesture. This is that gesture:
 * a void screen, one line of copy. Click unlocks the session and reveals
 * the TitlePlate with sound.
 */

import { motion } from "framer-motion";

interface Props {
  onUnlock: () => void;
}

export function SoundGate({ onUnlock }: Props) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[60] flex cursor-pointer items-center justify-center border-0 bg-black"
      onClick={onUnlock}
      aria-label="Click to hear sound"
    >
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.35, 0.9, 0.35] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="text-[12px] uppercase tracking-[0.42em] sm:text-[13px]"
        style={{
          fontFamily: "var(--font-studio)",
          color: "rgba(233,210,163,0.78)",
        }}
      >
        Click to hear sound
      </motion.span>
    </motion.button>
  );
}
