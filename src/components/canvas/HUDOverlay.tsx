"use client";

/**
 * HUD Overlay
 *
 * Renders the heads-up display elements layered on top of the video:
 *   - Top-left: System identity + mode badge
 *   - Top-right: Timing / branch telemetry
 *   - Bottom-left: Action log (live stream of orchestration events)
 *   - Bottom-right: Instructions / click hint
 */

import { motion, AnimatePresence } from "framer-motion";
import { Activity, Cpu, Radio, Zap } from "lucide-react";
import { useCanvasStore } from "@/lib/canvas/store";

interface Props {
  lastTimings?: { detectionMs: number; orchestrationMs: number; totalMs: number };
}

export function HUDOverlay({ lastTimings }: Props) {
  const isLive = useCanvasStore((s) => s.isLive);
  const branch = useCanvasStore((s) => s.branch);
  const actionLog = useCanvasStore((s) => s.actionLog);
  const hoverObject = useCanvasStore((s) => s.hoverObject);

  return (
    <>
      {/* ===== Top-left: Identity + Mode ===== */}
      <div className="pointer-events-none absolute top-4 left-4 z-30 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex h-7 w-7 items-center justify-center rounded border border-cyan-400/40 bg-slate-950/70">
            <Radio className="h-3.5 w-3.5 text-cyan-300" />
            <div className="absolute inset-0 rounded border border-cyan-400/30 animate-ping opacity-50" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-200/80">
              turing-canvas
            </div>
            <div className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
              v0.1 // spatial interface
            </div>
          </div>
        </div>
        {/* Mode badge */}
        <div className="inline-flex items-center gap-1.5 rounded border border-slate-700/60 bg-slate-950/70 px-2 py-0.5">
          <div className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
          <span className="font-mono text-[9px] uppercase tracking-wider text-slate-300">
            {isLive ? "LIVE · LTX-2.3" : "DEMO · PROCEDURAL"}
          </span>
        </div>
      </div>

      {/* ===== Top-right: Telemetry ===== */}
      <div className="pointer-events-none absolute top-4 right-4 z-30 space-y-1.5 text-right">
        {lastTimings && (
          <div className="inline-flex flex-col items-end gap-1 rounded border border-slate-700/60 bg-slate-950/70 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-fuchsia-300" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-slate-400">last click</span>
            </div>
            <div className="font-mono text-[10px] text-cyan-200">
              det: {lastTimings.detectionMs}ms · orch: {lastTimings.orchestrationMs}ms
            </div>
            <div className="font-mono text-[10px] text-emerald-300">
              total: {lastTimings.totalMs}ms
            </div>
          </div>
        )}
        <div className="inline-flex items-center gap-1.5 rounded border border-slate-700/60 bg-slate-950/70 px-2.5 py-0.5">
          <Activity className="h-3 w-3 text-emerald-300" />
          <span className="font-mono text-[9px] uppercase tracking-wider text-slate-300">
            branch:{branch}
          </span>
        </div>
      </div>

      {/* ===== Bottom-left: Action log ===== */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-30 max-w-xs">
        <div className="rounded border border-slate-700/60 bg-slate-950/70 backdrop-blur">
          <div className="flex items-center gap-1.5 border-b border-slate-700/60 px-2 py-1">
            <Cpu className="h-3 w-3 text-cyan-300" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
              orchestrator.log
            </span>
          </div>
          <div className="max-h-32 overflow-y-auto p-1.5 space-y-0.5 [scrollbar-width:thin]">
            <AnimatePresence initial={false}>
              {actionLog.slice(0, 6).map((entry) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-1.5"
                >
                  <span className="font-mono text-[9px] text-slate-500 shrink-0">
                    {new Date(entry.t).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span
                    className={`font-mono text-[9px] leading-snug ${
                      entry.kind === "branch"
                        ? "text-fuchsia-300"
                        : entry.kind === "action"
                        ? "text-cyan-300"
                        : "text-slate-300"
                    }`}
                  >
                    {entry.text}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            {actionLog.length === 0 && (
              <div className="font-mono text-[9px] text-slate-500 italic">
                awaiting input…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== Bottom-right: Hint ===== */}
      <div className="pointer-events-none absolute bottom-4 right-4 z-30">
        <div className="rounded border border-slate-700/60 bg-slate-950/70 px-2.5 py-1.5 text-right">
          {hoverObject ? (
            <div className="space-y-0.5">
              <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                target locked
              </div>
              <div className="font-mono text-[10px] text-slate-200">{hoverObject.label}</div>
              <div className="font-mono text-[9px] text-slate-500">
                click to interact
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <div className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
                hover to scan
              </div>
              <div className="font-mono text-[9px] text-slate-500">
                click any object → A2UI panel
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
