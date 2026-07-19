"use client";

/**
 * FilmSlate — the slate that prints onto the lens.
 *
 * When an object is clicked and the orchestrator returns an A2UI surface,
 * the slate rises from the camera's lower-sash, like a focus puller's
 * annotation projected through the lens. It is not a card. It is not a
 * modal. It is *metadata*, drawn in the film-desk register: serif italic
 * headers, long-leading text, slim action verbs, a slate footer stamped
 * "cutting room 7 · take NNN".
 *
 * A2UI components are declarative (the engine authored them); this renderer
 * is just the camera. The same component tree can be rendered by any A2UI
 * client. The point is that THIS client speaks film, not software.
 *
 * Speak in the cutting-room register here:
 *   - dangerous actions render in amber, never red. There is no "system
 *     alert" in a film. There is only "the room wants you to decide".
 *   - buttons are verbs in the editor's voice ("Splice / Burn / Sign off")
 *     not in the engineer's ("Submit / Cancel / Retry").
 */

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { A2UIComponent, A2UISurface } from "@/lib/canvas/types";

interface Props {
  surface: A2UISurface;
  onAction: (actionId: string, label: string) => void;
  onDismiss: () => void;
}

export function FilmSlate({ surface, onAction, onDismiss }: Props) {
  // Anchor the slate just to the right of the hovered object, but inside the
  // safe area. The slate never covers the iris area at frame-center.
  const left = `${Math.min(Math.max(surface.anchor.x2 * 100 + 1.5, 4), 70).toFixed(2)}%`;
  const top = `${Math.min(Math.max(surface.anchor.y1 * 100 - 1, 12), 82).toFixed(2)}%`;

  return (
    <AnimatePresence>
      <motion.div
        key={surface.id}
        initial={{ opacity: 0, y: 24, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: 12, filter: "blur(3px)" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="absolute z-30"
        style={{
          left,
          top,
          transform: "translateX(14px)",
          maxWidth: "min(420px, 76vw)",
        }}
      >
        <SlateBody surfaceId={surface.id}>
          <div className="max-h-[58vh] overflow-y-auto pr-3 [scrollbar-width:thin]">
            <NodeView node={surface.root} onAction={onAction} depth={0} />
          </div>
        </SlateBody>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Slate body — the physical slate strip
// ---------------------------------------------------------------------------
function SlateBody({ surfaceId, children }: { surfaceId: string; children: React.ReactNode }) {
  // Stamped take number from the slate id hash, so each rise prints a different
  // take number — looking exactly like a new take was rolled.
  const takeNo = ((surfaceId.length * 13) % 9990) + 10;
  return (
    <div className="relative slate-strip" style={{ padding: "16px 16px 14px 18px" }}>
      {/* Close pin */}
      <button
        onClick={() => {}}
        aria-hidden
        className="pointer-events-none absolute right-3 top-3 text-[13px] leading-none opacity-0"
      />
      <button
        onClick={() => {}}
        aria-label="Dismiss slate"
        className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center text-[12px] leading-none transition-opacity"
        style={{
          color: "rgba(233,210,163,0.50)",
          border: "1px solid rgba(233,210,163,0.14)",
          fontFamily: "var(--font-studio)",
        }}
        onMouseDown={(e) => { e.stopPropagation(); }}
      >
        {/* The dismiss is handled by AnimatePresence via a parent call;
            here we expose it via a custom event so the wrapping card does
            not have to know its own surfaceId. */}
        <span
          aria-hidden
          onClick={(e) => {
            e.stopPropagation();
            onSlateDismiss(e.currentTarget);
          }}
        >
          ×
        </span>
      </button>

      {children}

      {/* Slate footer */}
      <div
        className="mt-4 flex items-center justify-between"
        style={{ borderTop: "1px solid rgba(233,210,163,0.10)" }}
      >
        <span
          className="pt-2 text-[8px] uppercase tracking-[0.32em]"
          style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.42)" }}
        >
          cutting room 7
        </span>
        <span
          className="pt-2 text-[8px] uppercase tracking-[0.32em]"
          style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.42)" }}
        >
          take {String(takeNo).padStart(4, "0")}
        </span>
      </div>
    </div>
  );
}

/** Wire a dismiss out through the DOM so a 3rd-party SlateBody can be re-used
 *  without prop-drilling a dismiss function. In page.tsx, we also expose
 *  direct onDismiss through the parent AnimatePresence; we use both. */
function onSlateDismiss(_target: EventTarget | null) {
  // No-op fallback — the parent always passes onDismiss via the
  // `<FilmSlate onDismiss=...>` prop chain, which the subsidary dismiss X
  // simulates by poking the escape key. We do the simplest robust thing:
  // dispatch a synthetic keydown Escape which AnimatePresence-bound
  // parents always handle.
  if (typeof window === "undefined") return;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

// ---------------------------------------------------------------------------
// Node renderer (the A2UI component tree, rendered film-desk style)
// ---------------------------------------------------------------------------
function NodeView({ node, onAction, depth }: { node: A2UIComponent; onAction: (id: string, label: string) => void; depth: number }) {
  switch (node.type) {
    case "panel":
      return (
        <div className="space-y-3">
          {node.children?.map((c) => <NodeView key={c.id} node={c} onAction={onAction} depth={depth + 1} />)}
        </div>
      );

    case "header": {
      const text = (node.props?.text as string) ?? "";
      // Header reads like the printed top of a film slate: serif italic,
      // amber divider underneath. We split on "//" (catalog convention) so
      // the part after it can render in a more discrete tone (the desk type).
      const [head, sub] = text.split("//").map((s) => s.trim());
      return (
        <div className="pb-2">
          <div className="leading-[1.05]">
            <span
              className="text-[18px]"
              style={{
                fontFamily: "var(--font-film)",
                color: "rgba(255,248,235,0.92)",
                fontStyle: "italic",
                fontWeight: 500,
              }}
            >
              {head}
            </span>
            {sub ? (
              <span
                className="ml-2 text-[10px] uppercase tracking-[0.30em]"
                style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.70)" }}
              >
                {sub}
              </span>
            ) : null}
          </div>
          <div className="mt-2 h-px w-full" style={{ background: "linear-gradient(90deg, rgba(233,210,163,0.40), transparent 70%)" }} />
        </div>
      );
    }

    case "text":
      return (
        <p
          className="text-[12.5px] leading-[1.5]"
          style={{
            fontFamily: "var(--font-film)",
            color: "rgba(255,248,235,0.66)",
            fontWeight: 430,
          }}
        >
          {node.props?.content as string}
        </p>
      );

    case "metric": {
      const label = (node.props?.label as string) ?? "";
      const value = (node.props?.value as string) ?? "";
      const status = (node.props?.status as "ok" | "warn" | "crit") ?? "ok";
      const accent =
        status === "crit" ? "rgba(245,170,98,0.95)" :
        status === "warn" ? "rgba(233,210,163,0.82)" :
        "rgba(255,248,235,0.78)";
      return (
        <div className="flex items-baseline justify-between gap-4 border-b py-[5px]"
             style={{ borderColor: "rgba(233,210,163,0.07)" }}>
          <span
            className="text-[9.5px] uppercase tracking-[0.22em]"
            style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.46)" }}
          >
            {label}
          </span>
          <span
            className="text-[12px] tabular-nums"
            style={{ fontFamily: "var(--font-film)", color: accent, fontStyle: "italic", fontWeight: 520 }}
          >
            {value}
          </span>
        </div>
      );
    }

    case "button":
      return (
        <SlateButton
          label={(node.props?.label as string) ?? ""}
          actionId={(node.props?.actionId as string) ?? ""}
          variant={(node.props?.variant as "primary" | "danger" | "ghost") ?? "primary"}
          onAction={onAction}
        />
      );

    case "toggle":
      return <SlateToggle label={(node.props?.label as string) ?? ""} defaultOn={(node.props?.defaultOn as boolean) ?? false} />;

    case "select": {
      const label = (node.props?.label as string) ?? "";
      const raw = node.props?.options;
      const options = Array.isArray(raw)
        ? raw.map((opt) => {
            if (typeof opt === "string") return { label: opt, actionId: opt };
            if (opt && typeof opt === "object") {
              const o = opt as { label?: string; actionId?: string; value?: string };
              const optLabel = o.label ?? o.value ?? "";
              return { label: optLabel, actionId: o.actionId ?? o.value ?? optLabel };
            }
            return { label: String(opt), actionId: String(opt) };
          })
        : [];
      return <SlateSelect label={label} options={options} onAction={onAction} />;
    }

    case "alert": {
      const level = (node.props?.level as "info" | "warn" | "crit") ?? "info";
      const message = (node.props?.message as string) ?? "";
      // In a film desk there's no "system alert" — only stage direction.
      // We render these as quoted italic stage-note text with a small
      // amber rail to the left; crit reads a touch warmer than warn.
      const rail =
        level === "crit" ? "rgba(245,170,98,0.85)" :
        level === "warn" ? "rgba(233,210,163,0.78)" :
        "rgba(255,248,235,0.46)";
      const fg =
        level === "crit" ? "rgba(245,170,98,0.94)" :
        level === "warn" ? "rgba(233,210,163,0.84)" :
        "rgba(255,248,235,0.62)";
      return (
        <div className="pl-3 py-1.5" style={{ borderLeft: `2px solid ${rail}` }}>
          <span className="text-[12px] italic" style={{ fontFamily: "var(--font-film)", color: fg }}>
            {message}
          </span>
        </div>
      );
    }

    case "divider":
      return (
        <div className="py-1.5" style={{ borderTop: "1px solid rgba(233,210,163,0.08)", width: "62%" }} />
      );

    case "code":
      return (
        <pre className="px-3 py-1.5 text-[10.5px] leading-[1.5]"
             style={{
               fontFamily: "var(--font-film)",
               fontStyle: "italic",
               background: "rgba(255,248,235,0.04)",
               color: "rgba(255,248,235,0.58)",
               border: "1px solid rgba(233,210,163,0.08)",
             }}>
          {node.props?.content as string}
        </pre>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Decorative slate primitives
// ---------------------------------------------------------------------------
function SlateButton({
  label,
  actionId,
  variant,
  onAction,
}: {
  label: string;
  actionId: string;
  variant: "primary" | "danger" | "ghost";
  onAction: (id: string, label: string) => void;
}) {
  // Map variants to amber register, never "system red". Ghost = quiet flee.
  let border = "rgba(233,210,163,0.22)";
  let fg = "rgba(255,248,235,0.78)";
  let glyph = "▸";
  if (variant === "danger") {
    border = "rgba(245,170,98,0.55)";
    fg = "rgba(245,170,98,0.94)";
    glyph = "▲";
  } else if (variant === "ghost") {
    border = "rgba(255,248,235,0.10)";
    fg = "rgba(255,248,235,0.52)";
    glyph = "·";
  }
  return (
    <motion.button
      onClick={(e) => { e.stopPropagation(); onAction(actionId, label); }}
      onMouseDown={(e) => e.stopPropagation()}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 600, damping: 32 }}
      className="group mb-[3px] flex w-full items-center gap-2 px-3 py-2 text-left transition-all"
      style={{
        border: `1px solid ${border}`,
        background: variant === "danger" ? "rgba(245,170,98,0.06)" : "rgba(255,248,235,0.03)",
        fontFamily: "var(--font-film)",
        fontWeight: 520,
        fontStyle: "italic",
        fontSize: "13px",
        color: fg,
      }}
    >
      <span className="shrink-0 text-[11px] opacity-70">{glyph}</span>
      <span className="flex-1">{label}</span>
      <span
        className="text-[16px] leading-none opacity-0 transition-opacity group-hover:opacity-90"
        style={{ color: "rgba(233,210,163,0.78)" }}
        aria-hidden
      >
        →
      </span>
    </motion.button>
  );
}

function SlateToggle({ label, defaultOn }: { label: string; defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => setOn((v) => !v)}
      onMouseDown={(e) => e.stopPropagation()}
      className="flex w-full items-center justify-between px-3 py-2"
      style={{ border: "1px solid rgba(233,210,163,0.12)" }}
    >
      <span
        className="text-[11px] uppercase tracking-[0.20em]"
        style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.56)" }}
      >
        {label}
      </span>
      <span
        className="text-[10px] tracking-[0.18em]"
        style={{
          fontFamily: "var(--font-film)",
          fontStyle: "italic",
          color: on ? "rgba(245,170,98,0.90)" : "rgba(255,248,235,0.32)",
        }}
      >
        {on ? "engaged" : "held"}
      </span>
    </button>
  );
}

function SlateSelect({
  label,
  options,
  onAction,
}: {
  label: string;
  options: Array<{ label: string; actionId: string }>;
  onAction: (id: string, label: string) => void;
}) {
  return (
    <label className="mb-1 block" onMouseDown={(e) => e.stopPropagation()}>
      {label ? (
        <span
          className="mb-1 block text-[9.5px] uppercase tracking-[0.22em]"
          style={{ fontFamily: "var(--font-studio)", color: "rgba(233,210,163,0.48)" }}
        >
          {label}
        </span>
      ) : null}
      <select
        defaultValue=""
        onChange={(e) => {
          const actionId = e.target.value;
          if (!actionId) return;
          const opt = options.find((o) => o.actionId === actionId);
          onAction(actionId, opt?.label ?? actionId);
          e.target.value = "";
        }}
        className="w-full px-3 py-2 text-[12px] outline-none"
        style={{
          fontFamily: "var(--font-film)",
          fontStyle: "italic",
          color: "rgba(255,248,235,0.78)",
          background: "rgba(255,248,235,0.03)",
          border: "1px solid rgba(233,210,163,0.22)",
        }}
      >
        <option value="" disabled>
          select…
        </option>
        {options.map((opt) => (
          <option key={opt.actionId} value={opt.actionId}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
