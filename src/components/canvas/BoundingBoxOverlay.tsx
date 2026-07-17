"use client";

/**
 * Bounding Box Overlay
 *
 * Renders an invisible interactive layer over the video that:
 *   1. Listens for mouse move → highlights the bounding box of the object
 *      currently under the cursor (proves semantic awareness)
 *   2. Listens for click → triggers the orchestration callback
 *
 * Coordinates come in as normalized 0..1 floats (already divided by 1000
 * from Florence-2's raw output). We multiply by the rendered pixel size of
 * the video element to obtain screen-space rectangles.
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

export function BoundingBoxOverlay({ detections, onHover, onClick, enabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<DetectedObject | null>(null);

  // Reset hover when disabled
  useEffect(() => {
    if (!enabled) setHovered(null);
  }, [enabled]);

  const handleMove = (e: React.MouseEvent) => {
    if (!enabled || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const found =
      detections
        .filter((d) => x >= d.bbox.x1 && x <= d.bbox.x2 && y >= d.bbox.y1 && y <= d.bbox.y2)
        .sort((a, b) => bboxArea(a.bbox) - bboxArea(b.bbox))[0] ?? null;
    if (found !== hovered) {
      setHovered(found);
      onHover(found);
    }
  };

  const handleLeave = () => {
    setHovered(null);
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
      style={{ cursor: enabled ? (hovered ? "pointer" : "crosshair") : "default" }}
    >
      {/* Hover bounding box */}
      {enabled && hovered && (
        <motion.div
          key={hovered.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="absolute pointer-events-none"
          style={{
            left: `${hovered.bbox.x1 * 100}%`,
            top: `${hovered.bbox.y1 * 100}%`,
            width: `${(hovered.bbox.x2 - hovered.bbox.x1) * 100}%`,
            height: `${(hovered.bbox.y2 - hovered.bbox.y1) * 100}%`,
          }}
        >
          {/* Glowing border */}
          <div className="absolute inset-0 border-2 border-cyan-300 rounded-sm shadow-[0_0_20px_rgba(34,211,238,0.5)]" />
          {/* Corner ticks (cinematic targeting reticle) */}
          <CornerTicks />
          {/* Label tag */}
          <div className="absolute -top-7 left-0 flex items-center gap-1.5 bg-slate-950/90 border border-cyan-400/40 rounded px-2 py-0.5">
            <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-200">
              {hovered.label}
            </span>
            <span className="font-mono text-[9px] text-cyan-500/60">
              {(hovered.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </motion.div>
      )}

      {/* Faint persistent outlines for all detections (subtle, only visible on hover) */}
      {enabled && hovered && (
        <div className="absolute inset-0 pointer-events-none">
          {detections
            .filter((d) => d.id !== hovered.id)
            .map((d) => (
              <div
                key={d.id}
                className="absolute border border-cyan-400/15 rounded-sm"
                style={{
                  left: `${d.bbox.x1 * 100}%`,
                  top: `${d.bbox.y1 * 100}%`,
                  width: `${(d.bbox.x2 - d.bbox.x1) * 100}%`,
                  height: `${(d.bbox.y2 - d.bbox.y1) * 100}%`,
                }}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function CornerTicks() {
  const tick = "absolute h-3 w-3 border-cyan-300";
  return (
    <>
      <div className={`${tick} top-0 left-0 border-t-2 border-l-2`} />
      <div className={`${tick} top-0 right-0 border-t-2 border-r-2`} />
      <div className={`${tick} bottom-0 left-0 border-b-2 border-l-2`} />
      <div className={`${tick} bottom-0 right-0 border-b-2 border-r-2`} />
    </>
  );
}

function bboxArea(b: { x1: number; y1: number; x2: number; y2: number }): number {
  return (b.x2 - b.x1) * (b.y2 - b.y1);
}
