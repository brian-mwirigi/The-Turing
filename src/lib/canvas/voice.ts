/**
 * Ghost VO playback — ElevenLabs clips in /public/canvas/voices/.
 * Third-person Imogen lines keyed to static actionIds.
 */

/** actionId → filename stem (under /canvas/voices/) — 4-beat pitch reel. */
const ACTION_VOICE: Record<string, string> = {
  burn: "vo_burn_leader",
  recover: "vo_salvage",
  // summon_operator: Veo lip-sync owns the beat — silence
  // cut_take: silence — lens cap / film ending
};

let _current: HTMLAudioElement | null = null;

/** Play the VO for an action if a clip exists. Fire-and-forget; never blocks generate. */
export function playActionVoice(actionId: string): void {
  const stem = ACTION_VOICE[actionId];
  if (!stem) return;

  try {
    if (_current) {
      _current.pause();
      _current = null;
    }
    const audio = new Audio(`/canvas/voices/${stem}.mp3`);
    audio.volume = 0.85;
    _current = audio;
    void audio.play().catch(() => {
      /* autoplay / missing file — ignore */
    });
  } catch {
    /* ignore */
  }
}
