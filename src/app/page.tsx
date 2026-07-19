"use client";

/**
 * Turing-Complete Canvas — cutting-room main page.
 *
 * Entry sequence:
 *   1. SoundGate     — blank void, "Click to hear sound" (unlocks audio)
 *   2. TitlePlate    — landing with intro.mp4 + ambient projector hum
 *   3. Diorama/film  — live cutting room after a second click
 *
 * Layered composition once in the film:
 *   z-0    Diorama            (curved projection hosting FilmGate)
 *   z-20   RiverReticle       (16mm projectionist's iris)
 *   z-30   FilmSlate × n      (cutting-room slates rising from the sash)
 *   z-40   Generating/processing pulse
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Diorama } from "@/components/canvas/Diorama";
import { RiverReticle } from "@/components/canvas/RiverReticle";
import { FilmSlate } from "@/components/canvas/FilmSlate";
import { SoundGate } from "@/components/canvas/SoundGate";
import { TitlePlate, type TitlePlateHandle } from "@/components/canvas/TitlePlate";
import { useProjectorSound } from "@/components/canvas/ProjectorSound";
import type { FilmGateHandle } from "@/components/canvas/FilmGate";
import { useCanvasStore } from "@/lib/canvas/store";
import { useCanvasOrchestrator } from "@/hooks/use-canvas-orchestrator";
import type { UserAction } from "@/lib/canvas/types";

type Phase = "sound" | "title" | "main";

export default function Home() {
  const gateRef = useRef<FilmGateHandle | null>(null);
  const titleRef = useRef<TitlePlateHandle | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<Phase>("sound");
  const { start: startSound } = useProjectorSound();

  const bootMain = useCanvasStore((s) => s.bootMain);
  const surfaces = useCanvasStore((s) => s.surfaces);
  const lastDetections = useCanvasStore((s) => s.lastDetections);
  const setHoverObject = useCanvasStore((s) => s.setHoverObject);
  const dismissSurface = useCanvasStore((s) => s.dismissSurface);
  const setLive = useCanvasStore((s) => s.setLive);
  const clearSurfaces = useCanvasStore((s) => s.clearSurfaces);
  const isLive = useCanvasStore((s) => s.isLive);

  const { handleClick, handleAction, isProcessing, isGenerating } =
    useCanvasOrchestrator(captureVideoRef);

  // Check live mode on mount (engine ping)
  useEffect(() => {
    fetch("/api/canvas/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        frame: "ping",
        click: { x: 0, y: 0 },
        currentBranch: "taking",
        sceneId: "cutting_room_7",
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const live = data?.live === true || data?.llm === true;
        setLive(live);
      })
      .catch(() => setLive(false));
  }, [setLive]);

  // Sync captureVideoRef to the FilmGate's currently playing plane.
  useEffect(() => {
    if (phase !== "main") return;
    const sync = () => {
      const v = gateRef.current?.captureVideo() ?? null;
      if (v && v.videoWidth > 0) captureVideoRef.current = v;
    };
    sync();
    const id = window.setInterval(sync, 500);
    return () => window.clearInterval(id);
  }, [phase]);

  // Escape clears any open slates (FilmSlate fires synthetic Escape on ×).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && Object.keys(surfaces).length > 0) {
        clearSurfaces();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [surfaces, clearSurfaces]);

  const onUnlockSound = () => {
    // Same user gesture: ambient hum + unmute the landing intro plate.
    startSound();
    titleRef.current?.unlockAudio();
    setPhase("title");
  };

  const onBootFilm = () => {
    bootMain();
    setPhase("main");
  };

  const onVideoClick = (xNorm: number, yNorm: number) => {
    if (isProcessing || isGenerating) return;
    handleClick(xNorm, yNorm);
  };

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

  const inFilm = phase === "main";
  const audioUnlocked = phase !== "sound";

  return (
    <main className="fixed inset-0 overflow-hidden room-void">
      {inFilm && (
        <>
          <Diorama gateRef={gateRef} muted={false} />

          <RiverReticle
            detections={lastDetections}
            onHover={setHoverObject}
            onClick={onVideoClick}
            enabled={!isProcessing && !isGenerating}
          />

          <div className="pointer-events-none absolute inset-0 z-30">
            <div className="pointer-events-auto">
              <AnimatePresence>
                {Object.values(surfaces).map((surface) => (
                  <FilmSlate
                    key={surface.id}
                    surface={surface}
                    onAction={(actionId, label) =>
                      onSurfaceAction(surface.id, actionId, label)
                    }
                    onDismiss={() => dismissSurface(surface.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>

          {isGenerating && (
            <div className="pointer-events-none absolute top-1/2 left-1/2 z-40 -translate-x-1/2 -translate-y-1/2">
              <div className="reticle-iris flex h-16 w-16 animate-pulse items-center justify-center">
                <span
                  className="text-[11px] uppercase tracking-[0.42em]"
                  style={{
                    fontFamily: "var(--font-studio)",
                    color: "rgba(233,210,163,0.52)",
                  }}
                >
                  cutting
                </span>
              </div>
            </div>
          )}

          {isProcessing && !isGenerating && (
            <div className="pointer-events-none absolute top-1/2 left-1/2 z-40 -translate-x-1/2 -translate-y-1/2">
              <div className="reticle-iris flex h-12 w-12 items-center justify-center">
                <span
                  className="text-[9px] uppercase tracking-[0.42em]"
                  style={{
                    fontFamily: "var(--font-studio)",
                    color: "rgba(233,210,163,0.40)",
                  }}
                >
                  slate
                </span>
              </div>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {!inFilm && (
          <TitlePlate
            key="title"
            ref={titleRef}
            onBoot={onBootFilm}
            isLive={isLive}
            audioUnlocked={audioUnlocked}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === "sound" && <SoundGate key="sound" onUnlock={onUnlockSound} />}
      </AnimatePresence>
    </main>
  );
}
