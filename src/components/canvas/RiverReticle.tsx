"use client";

/**
 * RiverReticle — the projectionist's iris.
 *
 * As the cursor moves over the projected frame, this layer is responsible
 * for hit-testing against the detected cutting-room objects. When a hover
 * hit occurs, it draws a brass iris settled around the object's centroid
 * plus four focus-pull tick marks and a tiny "FOCUS // label · conf%"
 * slate. The remaining objects are rendered as faint out-of-frame nodes —
 * the marks a projectionist would scratch on the gate to know where to land.
 *
 * On click, this layer forwards the *normalized* click to the orchestrator
 * hook (the engine decides what to do with it).
 *
 * Never borders full boxes. Never strobing. Never glow. A 16mm iris, lit.
 */

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { DetectedObject } from "@/lib/canvas/types";

interface Props {
  detections: DetectedObject[];
  onHover: (obj: DetectedObject | null) => void;
  onClick: (xNorm: number, yNorm: number) => void;
  enabled: boolean;
}

const RETICLE_CLOSED = 14; // px, closed iris
const RETICLE_OPEN = 64;   // px, open iris around an object

export function RiverReticle({ detections, onHover, onClick, enabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<DetectedObject | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setHovered(null);
      onHover(null);
    }
  }, [enabled, onHover]);

  const handleMove = (e: React.MouseEvent) => {
    if (!enabled || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const found =
      detections
        .filter((d) => x >= d.bbox.x1 && x <= d.bbox.x2 && y >= d.bbox.y1 && y <= d.bbox.y2)
        .sort((a, b) => area(a.bbox) - area(b.bbox))[0] ?? null;
    if (found !== hovered) {
      setHovered(found);
      onHover(found);
    }
  };

  const handleLeave = () => {
    setHovered(null);
    setCursor(null);
    onHover(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!enabled || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onClick(x, y);
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-20"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      style={{ cursor: enabled ? (hovered ? "none" : "crosshair") : "default" }}
    >
      {/* ===== Tracking reticle (open whenever cursor is in frame and unhit) ===== */}
      {enabled && cursor && !hovered && (
        <motion.div
          className="pointer-events-none absolute z-30"
          style={{ left: cursor.x, top: cursor.y }}
        >
          <div
            className="reticle-iris -translate-x-1/2 -translate-y-1/2"
            style={{ width: RETICLE_CLOSED, height: RETICLE_CLOSED, opacity: 0.55 }}
          />
        </motion.div>
      )}

      {/* ===== Hovered object -> settling iris + tick marks + focus slate ===== */}
      {enabled && hovered && (
        <motion.div
          key={hovered.id}
          className="pointer-events-none absolute"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          style={{
            left: `${hovered.bbox.x1 * 100}%`,
            top: `${hovered.bbox.y1 * 100}%`,
            width: `${(hovered.bbox.x2 - hovered.bbox.x1) * 100}%`,
            height: `${(hovered.bbox.y2 - hovered.bbox.y1) * 100}%`,
          }}
        >
          {/* Brass iris centered on the object */}
          <motion.div
            className="reticle-iris absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            initial={{ width: RETICLE_CLOSED, height: RETICLE_CLOSED, opacity: 0.25 }}
            animate={{ width: RETICLE_OPEN, height: RETICLE_OPEN, opacity: 0.95 }}
            transition={{ type: "spring", stiffness: 360, damping: 26 }}
          />
          {/* Crosshair hair — full-frame subtle */}
          <div
            className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2"
            style={{ background: "rgba(233,210,163,0.18)" }}
            aria-hidden
          />
          <div
            className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2"
            style={{ background: "rgba(233,210,163,0.18)" }}
            aria-hidden
          />
          {/* Focus-pull tick marks at each corner (open square) */}
          {[0, 1, 2, 3].map((idx) => {
            const corner: Record<number, string> = {
              0: "left-1 top-1",
              1: "right-1 top-1",
              2: "left-1 bottom-1",
              3: "right-1 bottom-1",
            };
            return (
              <div key={idx} className={`absolute ${corner[idx]}`} aria-hidden>
                <span
                  className="block h-4 w-4"
                  style={{
                    borderTop: idx < 2 ? "1px solid rgba(233,210,163,0.4)" : "none",
                    borderBottom: idx >= 2 ? "1px solid rgba(233,210,163,0.4)" : "none",
                    borderLeft: idx % 2 === 0 ? "1px solid rgba(233,210,163,0.4)" : "none",
                    borderRight: idx % 2 === 1 ? "1px solid rgba(233,210,163,0.4)" : "none",
                  }}
                />
              </div>
            );
          })}
          {/* Focus-distance slate pill beneath */}
          <div
            className="absolute left-1/2 top-full flex -translate-x-1/2 translate-y-2 select-none"
            aria-hidden
          >
            <span
              className="inline-flex items-baseline gap-2 px-3 py-[3px]"
              style={{
                background: "rgba(8,6,4,0.72)",
                border: "1px solid rgba(233,210,163,0.22)",
              }}
            >
              <span
                className="text-[9px] uppercase tracking-[0.42em]"
                style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.7)" }}
              >
                focus
              </span>
              <span
                className="text-[12px] italic"
                style={{ fontFamily: "var(--font-film)", color: "rgba(255,248,235,0.92)" }}
              >
                {hovered.label}
              </span>
              <span
                className="text-[9px] tracking-[0.18em] uppercase"
                style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.5)" }}
              >
                {(hovered.confidence * 100).toFixed(0)}%
              </span>
            </span>
          </div>
        </motion.div>
      )}

      {/* ===== Out-of-focus object marks (editor's loupe scratches) ===== */}
      {enabled && hovered && (
        <div className="pointer-events-none absolute inset-0">
          {detections
            .filter((d) => d.id !== hovered.id)
            .map((d) => {
              const cxp = ((d.bbox.x1 + d.bbox.x2) / 2) * 100;
              const cyp = ((d.bbox.y1 + d.bbox.y2) / 2) * 100;
              return (
                <div
                  key={d.id}
                  className="absolute"
                  style={{ left: `${cxp}%`, top: `${cyp}%` }}
                  aria-hidden
                >
                  <span
                    className="block h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2"
                    style={{
                      border: "1px solid rgba(233,210,163,0.18)",
                      borderRadius: "9999px",
                      boxShadow: "0 0 8px rgba(233,210,163,0.06)",
                    }}
                  />
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function area(b: { x1: number; y1: number; x2: number; y2: number }): number {
  return (b.x2 - b.x1) * (b.y2 - b.y1);
}
