"use client";

/**
 * Turing-Complete Canvas — main page
 *
 * Layered composition:
 *   z-0   DoubleBufferedVideo (the generative stream)
 *   z-10  BoundingBoxOverlay (invisible clickable layer + hover reticle)
 *   z-20  (free)
 *   z-30  A2UISurfaceRenderer(s) + HUDOverlay
 *   z-50  IntroOverlay (until booted)
 *
 * The video element ref is shared between DoubleBufferedVideo and the
 * orchestrator hook so the hook can capture frames for Florence-2 / LTX-2.3.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { DoubleBufferedVideo } from "@/components/canvas/DoubleBufferedVideo";
import { BoundingBoxOverlay } from "@/components/canvas/BoundingBoxOverlay";
import { A2UISurfaceRenderer } from "@/components/canvas/A2UISurfaceRenderer";
import { HUDOverlay } from "@/components/canvas/HUDOverlay";
import { IntroOverlay } from "@/components/canvas/IntroOverlay";
import { useCanvasStore } from "@/lib/canvas/store";
import { useCanvasOrchestrator } from "@/hooks/use-canvas-orchestrator";
import type { UserAction } from "@/lib/canvas/types";

export default function Home() {
  // Hidden primary video element used only for frame capture (matches what's
  // currently visible). We render a single <video> inside DoubleBufferedVideo
  // and expose it via ref forwarding through a global stash.
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);

  const [booted, setBooted] = useState(false);
  const [isLive, setIsLive] = useState(false);

  const bootMain = useCanvasStore((s) => s.bootMain);
  const surfaces = useCanvasStore((s) => s.surfaces);
  const hoverObject = useCanvasStore((s) => s.hoverObject);
  const lastDetections = useCanvasStore((s) => s.lastDetections);
  const setHoverObject = useCanvasStore((s) => s.setHoverObject);
  const dismissSurface = useCanvasStore((s) => s.dismissSurface);
  const isSlowMo = useCanvasStore((s) => s.isSlowMo);

  const { handleClick, handleAction, dismissAll, isProcessing, isGenerating, lastTimings } =
    useCanvasOrchestrator(captureVideoRef);

  // Check live mode on mount
  useEffect(() => {
    fetch("/api/canvas/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frame: "ping", click: { x: 0, y: 0 }, currentBranch: "main", sceneId: "ping" }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.live === true) setIsLive(true);
      })
      .catch(() => setIsLive(false));
  }, []);

  // Keep a stable set of detections for the overlay (combines the most recent
  // orchestration result + the hover target)
  const detections = lastDetections.length > 0 ? lastDetections : getBootDetections();

  // Sync the captureVideoRef to the actually-playing <video> in DoubleBufferedVideo.
  // We do this by querying the DOM after mount.
  useEffect(() => {
    if (!booted) return;
    const interval = setInterval(() => {
      const videos = document.querySelectorAll("video");
      for (const v of videos) {
        // Pick the one that's currently playing (has src and not paused)
        if (v.src && !v.paused && v.videoWidth > 0) {
          captureVideoRef.current = v;
          break;
        }
      }
    }, 500);
    return () => clearInterval(interval);
  }, [booted]);

  // Click handler wraps orchestrator + closes any open surfaces first
  const onVideoClick = (xNorm: number, yNorm: number) => {
    if (isProcessing || isGenerating) return;
    handleClick(xNorm, yNorm);
  };

  // Surface action handler
  const onSurfaceAction = (surfaceId: string, actionId: string, label: string) => {
    const surface = surfaces[surfaceId];
    const action: UserAction = {
      semanticRole: surface?.semanticRole ?? "unknown",
      actionId,
      label,
      targetObject: undefined,
    };
    handleAction(action);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-slate-100">
      {/* ===== Generative video stream ===== */}
      {booted && <DoubleBufferedVideo />}

      {/* ===== Invisible interactive overlay ===== */}
      {booted && (
        <BoundingBoxOverlay
          detections={detections}
          onHover={setHoverObject}
          onClick={onVideoClick}
          enabled={!isProcessing && !isGenerating}
        />
      )}

      {/* ===== A2UI surfaces ===== */}
      {booted && (
        <div className="pointer-events-none absolute inset-0 z-30">
          <div className="pointer-events-auto">
            <AnimatePresence>
              {Object.values(surfaces).map((surface) => (
                <A2UISurfaceRenderer
                  key={surface.id}
                  surface={surface}
                  onAction={(actionId, label) => onSurfaceAction(surface.id, actionId, label)}
                  onDismiss={() => dismissSurface(surface.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ===== HUD ===== */}
      {booted && <HUDOverlay lastTimings={lastTimings} />}

      {/* ===== Generating indicator ===== */}
      {booted && isGenerating && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40">
          <div className="flex items-center gap-3 rounded-md border border-fuchsia-400/40 bg-slate-950/90 px-4 py-2.5 backdrop-blur">
            <div className="h-2 w-2 rounded-full bg-fuchsia-400 animate-pulse" />
            <span className="font-mono text-xs uppercase tracking-wider text-fuchsia-200">
              generating branch · LTX-2.3
            </span>
          </div>
        </div>
      )}

      {/* ===== Processing indicator (orchestration in flight) ===== */}
      {booted && isProcessing && !isGenerating && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40">
          <div className="flex items-center gap-3 rounded-md border border-cyan-400/40 bg-slate-950/90 px-4 py-2.5 backdrop-blur">
            <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-xs uppercase tracking-wider text-cyan-200">
              florence-2 scanning…
            </span>
          </div>
        </div>
      )}

      {/* ===== Click ripple (slow-mo feedback) ===== */}
      {booted && isSlowMo && !isGenerating && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute inset-0 bg-fuchsia-500/5 mix-blend-screen" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-fuchsia-300/40">
              t i m e · d i l a t e d
            </div>
          </div>
        </div>
      )}

      {/* ===== Reset button (top-right corner of viewport) ===== */}
      {booted && (
        <button
          onClick={() => {
            dismissAll();
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 rounded border border-slate-700/60 bg-slate-950/70 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:bg-slate-800/70"
        >
          [esc] dismiss panels
        </button>
      )}

      {/* ===== Escape key handler ===== */}
      <EscapeKeyHandler onEscape={() => dismissAll()} enabled={booted} />

      {/* ===== Intro ===== */}
      <AnimatePresence>
        {!booted && (
          <IntroOverlay
            isLive={isLive}
            onBoot={() => {
              bootMain();
              setBooted(true);
            }}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

/**
 * Returns the static boot-time detections matching the procedural scene.
 * These are populated client-side so the overlay is interactive immediately
 * (without waiting for the first Florence-2 call).
 */
function getBootDetections() {
  return [
    {
      id: "boot_rack_7a",
      label: "Server Rack 7-A",
      bbox: { x1: 0.18, y1: 0.20, x2: 0.42, y2: 0.85 },
      confidence: 0.94,
      semanticRole: "faulty_asset" as const,
    },
    {
      id: "boot_terminal_1",
      label: "Control Terminal",
      bbox: { x1: 0.55, y1: 0.30, x2: 0.92, y2: 0.78 },
      confidence: 0.92,
      semanticRole: "operator_interface" as const,
    },
    {
      id: "boot_vent_1",
      label: "Cooling Vent",
      bbox: { x1: 0.44, y1: 0.05, x2: 0.62, y2: 0.18 },
      confidence: 0.90,
      semanticRole: "hvac_component" as const,
    },
  ];
}

function EscapeKeyHandler({ onEscape, enabled }: { onEscape: () => void; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape, enabled]);
  return null;
}
