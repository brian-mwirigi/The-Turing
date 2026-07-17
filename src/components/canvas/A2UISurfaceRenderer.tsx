"use client";

/**
 * A2UI Surface Renderer
 *
 * Renders an A2UISurface (declarative JSON) into actual React components.
 * This mirrors the @googlemaps/a2ui Lit renderer's role: take a component
 * tree described as data and project it onto the DOM.
 *
 * Each surface is anchored to a normalized 0..1 bounding box in the video
 * frame; the renderer positions the panel near the anchor.
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ChevronRight,
  CircleDot,
  Gauge,
  Power,
  PowerOff,
  Shield,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import type { A2UIComponent, A2UISurface } from "@/lib/canvas/types";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Props {
  surface: A2UISurface;
  onAction: (actionId: string, label: string) => void;
  onDismiss: () => void;
}

export function A2UISurfaceRenderer({ surface, onAction, onDismiss }: Props) {
  // Anchor panel near the top-right of the detected object's bbox
  // (so it doesn't obscure the object itself)
  const left = `${(surface.anchor.x2 * 100).toFixed(2)}%`;
  const top = `${Math.max(surface.anchor.y1 * 100, 5).toFixed(2)}%`;

  return (
    <AnimatePresence>
      <motion.div
        key={surface.id}
        initial={{ opacity: 0, scale: 0.9, x: -20 }}
        animate={{ opacity: 1, scale: 1, x: 0 }}
        exit={{ opacity: 0, scale: 0.95, x: -10 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        className="absolute z-30"
        style={{
          left,
          top,
          transform: "translateX(8px)",
          maxWidth: "min(360px, calc(100vw - 80px))",
        }}
      >
        <div className="relative rounded-lg border border-cyan-400/40 bg-slate-950/85 backdrop-blur-md shadow-2xl shadow-cyan-500/10 overflow-hidden">
          {/* Top accent bar */}
          <div className="h-0.5 bg-gradient-to-r from-cyan-400 via-cyan-300 to-fuchsia-400" />
          {/* Header row with dismiss */}
          <button
            onClick={onDismiss}
            className="absolute right-2 top-2 z-10 rounded p-1 text-cyan-200/60 hover:bg-cyan-400/10 hover:text-cyan-100"
            aria-label="Dismiss panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="max-h-[60vh] overflow-y-auto p-3 pr-8 [scrollbar-width:thin]">
            <RenderNode node={surface.root} onAction={onAction} />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function RenderNode({
  node,
  onAction,
}: {
  node: A2UIComponent;
  onAction: (actionId: string, label: string) => void;
}) {
  switch (node.type) {
    case "panel":
      return (
        <div className="space-y-2.5">
          {node.children?.map((c) => (
            <RenderNode key={c.id} node={c} onAction={onAction} />
          ))}
        </div>
      );
    case "header": {
      const text = (node.props?.text as string) ?? "";
      return (
        <div className="flex items-center gap-2 pb-1">
          <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-300">
            {text}
          </span>
        </div>
      );
    }
    case "text":
      return (
        <p className="text-xs text-slate-300 leading-relaxed">
          {node.props?.content as string}
        </p>
      );
    case "metric": {
      const label = (node.props?.label as string) ?? "";
      const value = (node.props?.value as string) ?? "";
      const status = (node.props?.status as "ok" | "warn" | "crit") ?? "ok";
      const color =
        status === "crit"
          ? "text-rose-400"
          : status === "warn"
          ? "text-amber-300"
          : "text-emerald-300";
      const dot =
        status === "crit"
          ? "bg-rose-400"
          : status === "warn"
          ? "bg-amber-300"
          : "bg-emerald-300";
      return (
        <div className="flex items-center justify-between rounded border border-slate-700/60 bg-slate-900/60 px-2.5 py-1.5">
          <div className="flex items-center gap-2">
            <div className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <span className="text-[11px] uppercase tracking-wider text-slate-400">
              {label}
            </span>
          </div>
          <span className={`font-mono text-sm font-semibold ${color}`}>{value}</span>
        </div>
      );
    }
    case "button": {
      const label = (node.props?.label as string) ?? "";
      const actionId = (node.props?.actionId as string) ?? "";
      const variant = (node.props?.variant as "primary" | "danger" | "ghost") ?? "primary";
      const icon = pickButtonIcon(actionId);
      return (
        <Button
          size="sm"
          variant={variant === "danger" ? "destructive" : variant === "ghost" ? "ghost" : "default"}
          className={`w-full justify-start gap-2 font-mono text-xs ${
            variant === "primary"
              ? "bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 border border-cyan-400/40"
              : variant === "danger"
              ? "bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 border border-rose-400/40"
              : "bg-transparent text-slate-300 hover:bg-slate-700/50 border border-slate-600/40"
          }`}
          onClick={() => onAction(actionId, label)}
        >
          {icon}
          {label}
          <ChevronRight className="ml-auto h-3 w-3 opacity-50" />
        </Button>
      );
    }
    case "toggle": {
      const label = (node.props?.label as string) ?? "";
      const def = (node.props?.defaultOn as boolean) ?? false;
      return <ToggleNode label={label} defaultOn={def} />;
    }
    case "alert": {
      const level = (node.props?.level as "info" | "warn" | "crit") ?? "info";
      const message = (node.props?.message as string) ?? "";
      const colors =
        level === "crit"
          ? "border-rose-500/50 bg-rose-500/10 text-rose-200"
          : level === "warn"
          ? "border-amber-500/50 bg-amber-500/10 text-amber-200"
          : "border-cyan-500/50 bg-cyan-500/10 text-cyan-200";
      return (
        <div className={`flex items-start gap-2 rounded border px-2.5 py-2 ${colors}`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="text-[11px] leading-snug">{message}</span>
        </div>
      );
    }
    case "divider":
      return <div className="my-1 h-px bg-slate-700/50" />;
    case "code":
      return (
        <pre className="rounded bg-slate-900/80 p-2 font-mono text-[10px] text-emerald-300 overflow-x-auto">
          {node.props?.content as string}
        </pre>
      );
    default:
      return null;
  }
}

function pickButtonIcon(actionId: string) {
  const cls = "h-3.5 w-3.5";
  switch (actionId) {
    case "trigger_alert":
    case "lockdown":
      return <Shield className={cls} />;
    case "reboot":
      return <Power className={cls} />;
    case "isolate":
      return <PowerOff className={cls} />;
    case "continue":
      return <ChevronRight className={cls} />;
    case "boost_fan":
      return <Zap className={cls} />;
    case "review_logs":
    case "export_snapshot":
      return <Terminal className={cls} />;
    case "inspect":
      return <CircleDot className={cls} />;
    default:
      return <Gauge className={cls} />;
  }
}

function ToggleNode({ label, defaultOn }: { label: string; defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      className="flex w-full items-center justify-between rounded border border-slate-700/60 bg-slate-900/60 px-2.5 py-1.5 hover:bg-slate-800/60"
    >
      <span className="text-[11px] uppercase tracking-wider text-slate-400">{label}</span>
      <span
        className={`relative h-4 w-7 rounded-full transition-colors ${
          on ? "bg-cyan-500/70" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
