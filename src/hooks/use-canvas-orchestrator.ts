"use client";

/**
 * useCanvasOrchestrator
 *
 * Wires together:
 *   1. Frame capture from the <video> element (canvas → toDataURL → base64)
 *   2. POST /api/canvas/orchestrate (Florence-2 detection + A2UI generation)
 *   3. Apply the A2UI message to the store
 *   4. Enter slow-mo latency-masking mode
 *   5. On user action: POST /api/canvas/generate (LTX-2.3 extension) →
 *      commit new branch + exit slow-mo
 *
 * This is the orchestration layer that ties the whole pipeline together.
 */

import { useCallback, useRef, useState } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import type { OrchestrateResponse, UserAction } from "@/lib/canvas/types";

export function useCanvasOrchestrator(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const applyOrchestration = useCanvasStore((s) => s.applyOrchestration);
  const enterSlowMo = useCanvasStore((s) => s.enterSlowMo);
  const exitSlowMo = useCanvasStore((s) => s.exitSlowMo);
  const commitBranch = useCanvasStore((s) => s.commitBranch);
  const clearSurfaces = useCanvasStore((s) => s.clearSurfaces);
  const branch = useCanvasStore((s) => s.branch);
  const logAction = useCanvasStore((s) => s.logAction);
  const setHoverObject = useCanvasStore((s) => s.setHoverObject);
  const registerDetections = useCanvasStore((s) => s.registerDetections);

  const [isProcessing, setIsProcessing] = useState(false);
  const [lastTimings, setLastTimings] = useState<{ detectionMs: number; orchestrationMs: number; totalMs: number }>();
  const [isGenerating, setIsGenerating] = useState(false);

  // Capture the current video frame as a base64 JPEG (quality 0.95 to avoid
  // the artifact-amplification trap documented in the strategic analysis)
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    // Capture at 720p max to keep payload reasonable
    const scale = Math.min(1, 1280 / w);
    canvas.width = Math.floor(w * scale);
    canvas.height = Math.floor(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.95);
  }, [videoRef]);

  // Handle a click on the video: capture frame, send to orchestrator
  const handleClick = useCallback(
    async (xNorm: number, yNorm: number) => {
      if (isProcessing) return;
      const frame = captureFrame();
      if (!frame) return;
      setIsProcessing(true);
      setHoverObject(null);
      try {
        const res = await fetch("/api/canvas/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frame,
            click: { x: xNorm, y: yNorm },
            currentBranch: branch,
            sceneId: "main",
          }),
        });
        if (!res.ok) throw new Error(`orchestrate failed: ${res.status}`);
        const data = (await res.json()) as OrchestrateResponse;
        applyOrchestration(data);
        registerDetections(data.detectedObject ? [data.detectedObject] : []);
        setLastTimings(data.timings);
        if (data.detectedObject) {
          // Enter slow-mo to mask the upcoming generation latency
          enterSlowMo();
          logAction(`Slow-mo engaged · ${data.detectedObject.label} selected`, "action");
        }
      } catch (err) {
        console.error("[orchestrate] error:", err);
        logAction(`Error: ${err instanceof Error ? err.message : "unknown"}`, "action");
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, captureFrame, branch, applyOrchestration, registerDetections, setHoverObject, setLastTimings, enterSlowMo, logAction]
  );

  // Handle an action selected in an A2UI surface
  const handleAction = useCallback(
    async (action: UserAction) => {
      if (isGenerating) return;
      setIsGenerating(true);
      clearSurfaces();
      logAction(`Action: ${action.label} (${action.actionId})`, "action");
      try {
        // Capture current frame as the extension seed
        const lastFrame = captureFrame();
        const res = await fetch("/api/canvas/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            currentBranch: branch,
            lastFrame,
            sceneId: "main",
          }),
        });
        if (!res.ok) throw new Error(`generate failed: ${res.status}`);
        const data = await res.json();
        // Commit the new branch — this triggers the crossfade in DoubleBufferedVideo
        commitBranch(data.branch, data.chunk.source === "ltx23" ? data.chunk.url : undefined);
        exitSlowMo();
        logAction(`Generated ${data.chunk.source} chunk → ${data.branch}`, "branch");
      } catch (err) {
        console.error("[generate] error:", err);
        logAction(`Generation error: ${err instanceof Error ? err.message : "unknown"}`, "action");
        exitSlowMo();
      } finally {
        setIsGenerating(false);
      }
    },
    [isGenerating, captureFrame, branch, clearSurfaces, commitBranch, exitSlowMo, logAction]
  );

  const dismissAll = useCallback(() => {
    clearSurfaces();
    exitSlowMo();
  }, [clearSurfaces, exitSlowMo]);

  return {
    handleClick,
    handleAction,
    dismissAll,
    captureFrame,
    isProcessing,
    isGenerating,
    lastTimings,
  };
}
