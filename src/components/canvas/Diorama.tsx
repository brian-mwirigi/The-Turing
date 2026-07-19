"use client";

/**
 * Diorama — projection surface hosting FilmGate.
 *
 * Kept light on purpose: 3D parallax + framer transforms on a full-bleed
 * <video> tanked FPS. Ambient wash + vignette only; the film stays flat.
 */

import { FilmGate, type FilmGateHandle } from "@/components/canvas/FilmGate";

interface Props {
  gateRef?: React.RefObject<FilmGateHandle | null>;
  muted?: boolean;
}

export function Diorama({ gateRef, muted = true }: Props) {
  return (
    <div className="absolute inset-0 overflow-hidden room-void">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 56% at 50% 44%, rgba(193,154,93,0.08) 0%, transparent 60%)",
        }}
        aria-hidden
      />

      <div className="absolute inset-0">
        <FilmGate ref={gateRef} muted={muted} />
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-30"
        style={{
          background:
            "radial-gradient(ellipse 88% 78% at 50% 50%, transparent 58%, rgba(8,6,4,0.22) 82%, rgba(4,3,2,0.55) 100%)",
        }}
        aria-hidden
      />
    </div>
  );
}
