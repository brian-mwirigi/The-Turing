# The Turing-Complete Canvas · Creative Bible

> **Logline.** *A filmmaker dies mid-edit of the only film she ever cared about.
> Her cutting room is left as it was. You — the inheritor — don't watch the film.
> You finish it.*

---

## 1. Why this story, why this architecture

The judging panel is Sequoia. The thesis the playbook makes us prove is that
**video is no longer a fixed MP4 — it is a stateful, editable operating system.**

Every other team in the Dev Track will use that thesis to fix a server, spin a
forklift, or tap a glowing vending machine. Those demos prove the architecture.
They will be forgotten by Friday.

A story about *finishing a dead filmmaker's last cut* proves the architecture
**and** lands the only thing VCs and filmmakers can agree on: that a medium is
only as powerful as the grief it can hold. The demo ends not with "look, it
branched" but with the dead woman looking at the camera and asking you, by
name, whether the choice you just made was the one she would have made.

That is the moat. That is also a film.

---

## 2. Setting — Cutting Room 7

A 1970s cutting room. Sleeves of 16mm film hang from the ceiling. A Steenbeck
flatbed editor hums on the desk. A cup of coffee gone cold. A Royal typewriter
with a half-finished note. A Bolex on a tripod in the corner, lens cap off.
A green-illuminated intercom on the wall — the only thing that still answers.
Long vertical light shafts from a high window. Dust in the air. Everything is
paused, as if the room itself is waiting.

We are **inside the last frame** of her unfinished film. The whole demo is one
continuous, branching, 16mm-graded take.

---

## 3. Characters

**Imogen Veyra** — the filmmaker. Died at 41 in a single-car accident on the
Pacific Coast Highway, three days before picture lock. Her face never appears
in the wide shots. She is only ever a voice, a hand, a note. The Veo 3.1 hero
beat is the first time the audience sees her face.

**The Inheritor** — you. The audience. The demo implies you are her student, her
estranged child, or whoever the studio's algorithm picked up off the bench. The
intercom addresses you as "Operator". Veo addresses you by the name you typed
on the typewriter.

**The Room** — antagonist and ally. It wants to stay paused. Every branch you
choose either keeps it paused or risks moving it forward. The first time the
room un-pauses is the demo's emotional climax.

---

## 4. Object map — what's clickable

The Florence-2 detection layer maps these semantic roles → A2UI surfaces. Each
object is a different filmmaking tool. Clicking it is the act of editing the
dead woman's film from inside the film.

| # | Object            | Semantic role        | A2UI surface         | Possible branches      |
|---|-------------------|----------------------|----------------------|------------------------|
| 1 | Steenbeck reels   | `film_source`        | Splice deck          | splice, recover, burn  |
| 2 | Standing Bolex    | `camera_asset`       | Take control         | roll_take, cut_teake, reframe |
| 3 | Royal typewriter  | `manuscript`         | Note editor          | continue_page, scratch_line, sign_off |
| 4 | Cold coffee       | `artifact_unset`     | Time/desk inspector  | advance_clock, rewind_clock |
| 5 | Wall intercom     | `operator_interface`| Studio desk panel    | page_studio, summon_operator (Veo 3.1 hero) |
| 6 | Light shaft       | `vfx_element`        | Grade desk           | warm_grade, cold_grade, bleach_grade |
| 7 | Window onto ocean | `scene_extern`       | Establishing shot    | extend_establish, cutto_interior |

**`summon_operator` is the only action that triggers Veo 3.1.** Every other
branch is LTX-2.3 (fast, 6s, environmental). The hero beat is reserved because
it costs the most and lands the hardest.

---

## 5. Branch narrative — a stateful film

We don't write scenes. We write **edits**. Each branch is a *cut* of the same
underlying take. State accumulates across the demo: each choice rewrites the
room's lighting, sound bed, and the position of objects. That's the
**temporal persistence of state** the playbook demands.

| Branch id   | When entered                          | What the room becomes                            |
|-------------|---------------------------------------|--------------------------------------------------|
| `taking`    | boot — null hypothesis                | Paused cutting room, ambient hum, light shaft, dust drifting. The film we have been bequeathed. |
| `splice`    | splice a frame on the Steenbeck       | The reels spin. The room un-pauses for the first time. Coffee ripples. We hear her voice, off-mic, on the lost reel. |
| `roll_take` | roll a take on the Bolex              | The camera runs. Light leaks across the frame. The lens cap swings. We see only what the camera sees, not the operator. |
| `cut_take`  | cut a take on the Bolex              | The cap snaps back on. The room goes dead. Coffee settles. We are alone again. |
| `continue_page` | continue Imogen's last note      | The carriage returns. We type a single line in her voice. The line is remembered across subsequent branches. |
| `warm_grade` / `cold_grade` / `bleach_grade` | grade the light shaft | The entire demo's grade shifts on the next crossfade. Persistent state. |
| `page_studio` | page the studio via intercom         | A distant tone answers. Hold tone. The line drops. Ambient returns louder. |
| `summon_operator` (Veo 3.1) | the only character beat        | The far door opens. Imogen walks into the room with a mug of coffee. She sets it down on the desk — *the same mug that is cold in the present.* She looks at us. Lip-synced: "You weren't the operator I expected. But you're the one the room wanted." She sits at the Steenbeck and lets the reel run. Cut to black. |
| `recover`   | recover the lost reel                 | A second take of her appears under the first, flickering. We glimpse it. Then it folds back. |
| `burn`      | burn a frame on the Steenbeck         | The frame catches light. The film catches. The room dims. The demo quietly returns to `taking`. |
| `rewind`    | rewind the clock on the desk          | Coffee warms. Steam rises. The room reverses four seconds and we are back at the boot frame. |

---

## 6. The hero moment — Veo 3.1, sparingly

The Veo 3.1 hero beat fires **once per demo**, only on `summon_operator`, only
when a real `FAL_KEY` is present. Demo fallback reuses `splice` footage so the
emotional curve still survives on a flaky conference Wi-Fi.

Veo is asked for: 4K, single shot, door-stage left → desk-center → look to
camera → six seconds, lip-synced dialogue, ambient phonograph bed. This is the
only time we move from the environmental LTX texture into a photoreal face, so
the contrast itself is the punchline.

---

## 7. The closing shot

The demo does not end with a card. It ends with the room still running, the
reel still rolling on whichever cut the operator left on the Steenbeck, and a
single subtitle that fades up over the crossfade:

> *You did not watch this film. You kept it.*

Then a soft iris to black, and the intro plate returns inverted (white on
black, serif italic) — the same plate the audience first saw, now a closing
title. The architecture's "intro -> play -> branch -> outro" loop closes on
itself, and the room never has to be reset.

---

## 8. Tagline & title

**Title:** *The Turing-Complete Canvas*
**Subtitle / tag:** *A film you finish by clicking.*

We are not the team that showed video can be an OS. We are the team that
showed it can be a *eulogy*.

---

## 9. Why this beats the storytellers in the room

- Every other film in the room is a film. Ours is a film in the act of being
  made.
- Every other "interactive film" gives the user a menu. Ours gives the user the
  director's desk.
- The judges are VCs. They are looking at generative UI as a moat. The most
  defensible moat in this category is one where the user interface *is the
  subject matter*. There is no wrapper here. The interface is a Steenbeck.
- Veo 3.1 character beat is fired exactly once, at maximum cost, at maximum
  emotion — never as a gimmick. Filmmakers in the audience will clock this
  restraint.
- Langton's law: the artefact that gets remembered is the one that dared to
  have a stake. Our stake is small and personal — a single mug of coffee. The
  server room teams will out-render us. They will not out-feel us.
