"use client";

/**
 * ProjectorSound — the sound of the room.
 *
 * A film projector doesn't hum at one frequency. It hums AND rattles the
 * gate AND ticks the sprockets. We synth three layers via Web Audio:
 *
 *   1. Sub drone (41 Hz pure sine, ramped in 1.2s) — the floor hum.
 *   2. Second harmonic (87 Hz sine, quiet) — the lamp coherence.
 *   3. Gate rattle — a short noise burst (~80ms band-passed noise) triggered
 *      once every ~3-5s on a jittered interval. Reads as the 16mm gate
 *      advancing a frame. Loud-ish on entry, settles in.
 *
 * State is module-scoped so every caller shares one AudioContext. Closing
 * the context on unmount would kill audio when the intro exits, so we keep
 * it alive for the session.
 */

import { useCallback, useSyncExternalStore } from "react";

const LAYERS = {
  drone:    { pitch: 41, gain: 0.12 },
  harmonic: { pitch: 87, gain: 0.04 },
  gate:     { intervalMs: 3800, jitterMs: 1700, burstMs: 90, gain: 0.05, q: 0.8, freq: 240 },
};

let started = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let drone: OscillatorNode | null = null;
let harm: OscillatorNode | null = null;
let rattleTimer: number | null = null;
let rattleNoiseSource: AudioBufferSourceNode | null = null;

const listeners = new Set<() => void>();
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function snapshot() { return started; }
function emit() { for (const l of listeners) l(); }

function ensureCtx() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

function makeNoiseBuffer(audio: AudioContext): AudioBuffer {
  // 1s of band-passed-ish noise; we close it for ~90ms per rattle
  const len = Math.floor(audio.sampleRate * 0.5);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function startAmbient() {
  if (started) return;
  const audio = ensureCtx();
  if (audio.state === "suspended") void audio.resume();

  master = audio.createGain();
  master.gain.value = 0;
  master.connect(audio.destination);

  drone = audio.createOscillator();
  drone.type = "sine";
  drone.frequency.value = LAYERS.drone.pitch;
  drone.connect(master);
  drone.start();

  harm = audio.createOscillator();
  harm.type = "sine";
  harm.frequency.value = LAYERS.harmonic.pitch;
  harm.connect(master);
  harm.start();

  // Gate rattle scheduler
  const fireRattle = () => {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = LAYERS.gate.freq;
    bp.Q.value = LAYERS.gate.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(LAYERS.gate.gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + LAYERS.gate.burstMs / 1000);
    noise.connect(bp).connect(g).connect(master);
    noise.start(now);
    noise.stop(now + LAYERS.gate.burstMs / 1000 + 0.02);
    rattleNoiseSource = noise;
    // Schedule next with jitter
    const next = LAYERS.gate.intervalMs + (Math.random() * 2 - 1) * LAYERS.gate.jitterMs;
    rattleTimer = window.setTimeout(fireRattle, Math.max(900, next));
  };

  master.gain.linearRampToValueAtTime(LAYERS.drone.gain, audio.currentTime + 1.2);
  started = true;
  emit();
  rattleTimer = window.setTimeout(fireRattle, 2200);
}

function stopAmbient() {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (master) master.gain.linearRampToValueAtTime(0, now + 0.6);
  window.setTimeout(() => {
    try { drone?.stop?.(); harm?.stop?.(); rattleNoiseSource?.stop?.(); } catch { /* noop */ }
    if (rattleTimer) { window.clearTimeout(rattleTimer); rattleTimer = null; }
    drone = null; harm = null; master = null; rattleNoiseSource = null;
  }, 700);
  started = false;
  emit();
}

export function useProjectorSound() {
  const isStarted = useSyncExternalStore(subscribe, snapshot, snapshot);
  const start = useCallback(() => startAmbient(), []);
  const stop = useCallback(() => stopAmbient(), []);
  return { started: isStarted, start, stop };
}
