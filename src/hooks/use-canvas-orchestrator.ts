"use client";

/**
 * useCanvasOrchestrator
 *
 * Wires together:
 *   1. Frame  capture from the <video> element (canvas → toDataURL → base64 JPEG)
 *      used as Florence-2 input AND as the Veo 3.1 seed image.
 *   2. Clip   capture via MediaRecorder (~2s mp4) used as the LTX-2.3
 *      extend-video `video_url` source (uploaded server-side via fal.storage).
 *   3. POST /api/canvas/orchestrate (Florence-2 + LLM A2UI surface)
 *   4. Apply the A2UI message to the store; enter slow-mo.
 *   5. On user action: POST /api/canvas/generate (multipart, mp4 + frame) →
 *      commit new branch + exit slow-mo.
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

  // ---------------------------------------------------------------------------
  // Frame capture (single JPEG) — used for Florence-2 detection and Veo seed
  // ---------------------------------------------------------------------------
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / w);
    canvas.width = Math.floor(w * scale);
    canvas.height = Math.floor(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.95);
  }, [videoRef]);

  // ---------------------------------------------------------------------------
  // Clip capture (recent ~2s) — mp4 blob for LTX-2.3 extend-video
  //
  // Strategy: captureStream(captureFrameRate=0) clones the live <video>
  // element's current stream; we record for 2s, then stop and yield the blob.
  // ---------------------------------------------------------------------------
  const captureRecentVideo = useCallback(
    async (durationMs = 2000): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video) return null;
    // `captureStream` is non-standard on Safari/Firefox (mozCaptureStream).
    // We cast through a permissive interface rather than extending lib.dom.
    type CaptureableVideo = HTMLVideoElement & {
      captureStream?: (frameRate?: number) => MediaStream;
      mozCaptureStream?: (frameRate?: number) => MediaStream;
    };
    const captureable = video as CaptureableVideo;
    const streamFn = captureable.captureStream ?? captureable.mozCaptureStream;
    if (!streamFn) {
      // Safari fallback — capture a few frames via canvas into a stream.
      return null;
    }
    try {
      const stream = streamFn.call(video, 30);
      if (!stream) return null;

        // Pick the best supported video mime; prefer mp4 if supported
        const mimes = [
          "video/mp4;codecs=h264",
          "video/mp4",
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
        ];
        const mime = mimes.find((m) =>
          typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
        ) ?? "video/webm";

        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        return await new Promise<Blob | null>((resolve) => {
          recorder.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            if (chunks.length === 0) return resolve(null);
            resolve(new Blob(chunks, { type: mime }));
          };
          recorder.start();
          setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, durationMs);
        });
      } catch (err) {
        console.error("[captureRecentVideo] error:", err);
        return null;
      }
    },
    [videoRef]
  );

  // ---------------------------------------------------------------------------
  // Click → orchestrate (Florence-2 + LLM surface)
  // ---------------------------------------------------------------------------
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
        registerDetections(data.detections ?? []);
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
    [isProcessing, captureFrame, branch, applyOrchestration, registerDetections, setHoverObject, enterSlowMo, logAction]
  );

  // ---------------------------------------------------------------------------
  // Action → generate (mp4 + frame POST → LTX-2.3 extend or Veo 3.1 hero)
  // ---------------------------------------------------------------------------
  const handleAction = useCallback(
    async (action: UserAction) => {
      if (isGenerating) return;
      setIsGenerating(true);
      clearSurfaces();
      logAction(`Action: ${action.label} (${action.actionId})`, "action");
      try {
        // Capture the current frame (JPEG seed for Veo / Florence fallback)
        const lastFrame = captureFrame();
        // Capture the most recent ~2s as an mp4 blob for LTX extend-video.
        const lastFrameVideo = await captureRecentVideo(2000);

        const fd = new FormData();
        fd.append("action", JSON.stringify(action));
        fd.append("currentBranch", branch);
        fd.append("sceneId", "main");
        if (lastFrame) fd.append("lastFrame", lastFrame);
        if (lastFrameVideo) {
          fd.append(
            "lastFrameVideo",
            new File([lastFrameVideo], `capture-${Date.now()}.mp4`, {
              type: lastFrameVideo.type || "video/mp4",
            })
          );
        }

        const res = await fetch("/api/canvas/generate", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) throw new Error(`generate failed: ${res.status}`);
        const data = await res.json();
        // Commit the new branch — this triggers the crossfade in DoubleBufferedVideo
        const source = data.chunk?.source ?? "demo";
        const useLiveUrl = source === "ltx23" || source === "veo31";
        commitBranch(data.branch, useLiveUrl ? data.chunk.url : undefined);
        exitSlowMo();
        logAction(
          `Generated ${source} chunk → ${data.branch}${data.fallback ? " (fallback)" : ""}`,
          "branch"
        );
      } catch (err) {
        console.error("[generate] error:", err);
        logAction(`Generation error: ${err instanceof Error ? err.message : "unknown"}`, "action");
        exitSlowMo();
      } finally {
        setIsGenerating(false);
      }
    },
    [isGenerating, captureFrame, captureRecentVideo, branch, clearSurfaces, commitBranch, exitSlowMo, logAction]
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
    captureRecentVideo,
    isProcessing,
    isGenerating,
    lastTimings,
  };
}
