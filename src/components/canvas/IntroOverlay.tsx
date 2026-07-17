"use client";

/**
 * IntroOverlay
 *
 * Shown on first load. Provides the macro thesis ("Batch Size 1 software"),
 * the demo flow instructions, and the boot button.
 *
 * This is the "first 15 seconds" hook from the strategic analysis.
 */

import { motion } from "framer-motion";
import { ChevronRight, MousePointer2, Sparkles, Zap } from "lucide-react";

interface Props {
  onBoot: () => void;
  isLive: boolean;
}

export function IntroOverlay({ onBoot, isLive }: Props) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      className="absolute inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950"
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.15) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="absolute top-1/3 right-1/4 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl" />

      <div className="relative z-10 max-w-2xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-6 text-center"
        >
          {/* Logo lockup */}
          <div className="flex items-center justify-center gap-3">
            <div className="relative h-12 w-12 rounded-lg border border-cyan-400/40 bg-slate-950/80 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-cyan-300" />
              <div className="absolute inset-0 rounded-lg border border-cyan-400/30 animate-ping" />
            </div>
            <div className="text-left">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-400/70">
                fal × Sequoia · Dev Track
              </div>
              <h1 className="font-mono text-2xl font-bold text-slate-50">
                The Turing-Complete Canvas
              </h1>
            </div>
          </div>

          {/* Tagline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-base text-slate-300 leading-relaxed"
          >
            A generative video stream that behaves like a software interface.
            Click any object → a contextual control panel materializes → the
            narrative branches. Batch-Size-1 software, where the UI is the world.
          </motion.p>

          {/* Pillars */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left"
          >
            <Pillar
              icon={<MousePointer2 className="h-4 w-4" />}
              title="Click anything"
              body="Florence-2 zero-shot detection maps semantic objects to interactive DOM coordinates in real time."
            />
            <Pillar
              icon={<Sparkles className="h-4 w-4" />}
              title="A2UI surfaces"
              body="Declarative JSON control panels stream over the video — no HTML, just data."
            />
            <Pillar
              icon={<Zap className="h-4 w-4" />}
              title="Branch the video"
              body="LTX-2.3 extends the stream with state persistence. Slow-mo masks the latency."
            />
          </motion.div>

          {/* Mode badge */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-950/60 px-3 py-1">
              <div className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-300">
                {isLive ? "LIVE · fal.ai LTX-2.3 + Florence-2" : "DEMO MODE · procedural assets (set FAL_KEY for live)"}
              </span>
            </div>
          </div>

          {/* Boot button */}
          <motion.button
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.7 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onBoot}
            className="group inline-flex items-center gap-2 rounded-md border border-cyan-400/50 bg-cyan-500/15 px-6 py-3 font-mono text-sm uppercase tracking-[0.2em] text-cyan-200 transition-all hover:bg-cyan-500/25 hover:border-cyan-400"
          >
            <span>Enter the Canvas</span>
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Pillar({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 p-3">
      <div className="flex items-center gap-2 text-cyan-300">
        {icon}
        <span className="font-mono text-[11px] uppercase tracking-wider">{title}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{body}</p>
    </div>
  );
}
