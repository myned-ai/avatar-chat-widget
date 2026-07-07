# Avatar Motion & State Machine — Implementation Plan

*Created 2026-07-06, revised same day after depth review: every load-bearing
assumption is now listed in the Assumption Register with a verification
experiment. Companion to [STATE_MACHINE.md](STATE_MACHINE.md) — the research
audit (§0.5, §0.5.1, Q7b, Q8b, Parts VIII–IX) is the justification for every
item. Reviewed with Antonios; execute in phase order unless told otherwise.*

## END OF DAY 2026-07-07 — state + open problem for tomorrow

**Where we are:** big structural progress (arbiter, single-clip renderer mode,
face gate, camera look-at gaze, mid-turn-teardown fix, post-turn-Idle fix,
holistic energy envelope). Gaze cadence + Listening calm ACCEPTED. But the
**core talking-head problem is NOT solved** and needs a fresh troubleshooting
pass tomorrow.

**Antonios' feedback on the F9 holistic energy build (last run today):**
1. **"Now it nods all the time"** — not rapid, but a constant nod as she
   speaks. The single 0.9 Hz pitch bob, amplitude ∝ energy envelope, reads as
   perpetual nodding. Too much continuous pitch. (Consider: much smaller bob,
   or drive pitch less / yaw more, or make motion sparser — the research
   agent's envelope-follower + talking-head findings should inform this.)
2. **"The glitch is present too, occasionally"** — CRITICAL DIAGNOSTIC:
   the fast-forward glitch SURVIVED removing the discrete beat and the entire
   energy-signal redesign. **⇒ the glitch is almost certainly NOT procedural.**
   Prime suspect now: the **idle clip loops with a seam** (single-clip mode
   plays `yumi_h5_a3_idle` on LoopRepeat; if its head track's first≠last
   keyframe, the head snaps every loop period). Renderer-side.

**First moves tomorrow (no real-time reflexes required from Antonios):**
- Confirm/kill the clip-seam hypothesis with a NON-interactive probe: log the
  mixer time + clip duration, and either (a) log head-bone quaternion each
  frame and look for a periodic discontinuity at clip-wrap, or (b) temporarily
  hard-freeze the clip (`mixer.timeScale=0`) at load and see if the glitch is
  gone across a whole session — no need to catch anything live.
- Read the research agent's report (dispatched today: audio-energy→head
  smoothing, envelope followers, 1€-on-pose, talking-head temporal stability,
  VTuber recipes) and re-tune the nod/bob from it: less constant pitch.
- Reconsider whether pitch bob should be the primary channel at all (real
  speaker head motion is more yaw/tilt than constant nod).

**Research agent status:** launched today, STOPPED at wrap-up before
finishing. Re-run tomorrow — question: how production talking-head / VTuber /
game systems smooth audio-energy→head-motion (envelope-follower attack/release
ms, 1€ filter on pose, temporal-stability techniques, whether discrete beats
are avoided in favor of continuous prosody-following).

---

## Ground rules

- **DON'T ASSUME — verify.** An item may start only when its blocking
  assumptions (register below) are verified, or consciously accepted with
  Antonios.
- **One variable per test run**, falsifiable prediction stated before the
  run. Antonios judges visually in the live widget; logs are advisory.
- Test loop: `npm run dev` → https://localhost:5173, hard refresh
  (Ctrl+Shift+R) after every change, watch `[NeckPose]` / `[gaze]` console
  lines. Server must be running for full conversation flow.
- **What does NOT change:** model owns the face (lipsync + expression, 52
  ARKit channels); server owns turn transitions (local signals are reflex
  inputs *within* states, never a competing state authority); OAC zip format
  locked; WebSocket protocol changes are additive only.

## Resolved decisions (2026-07-06)

Both external repos are **IN SCOPE** (Antonios approved) under the
change-management workflow below. No scope blockers remain.

## Multi-repo layout & change management

Verified layout (git-checked 2026-07-06):

| Repo | Path | Branch now | State | How consumed |
|---|---|---|---|---|
| **widget** (integration point) | `Desktop/avatar-chat-widget` | `feat/procedural-gaze` | WIP: `styles.ts`, `nyx.zip` modified + many untracked asset backups | — |
| **renderer** | `Documents/gsplat-flame-avatar-renderer` | `feat/neck-pose-callback` | **UNCOMMITTED WIP**: `GaussianSplatRenderer.js`, `ObjectPool.js` modified | Dev: Vite alias hard-wired to local `dist/*.esm.js` (`vite.config.ts:11-13`, bypasses node_modules; `dedupe: ['three','jszip']`). Prod: npm `@myned-ai/gsplat-flame-avatar-renderer ^1.2.0` |
| **server (working repo)** | `Desktop/avatar-chat-server` | `feat/e1-tbptt-stateful` | WIP: wav2arkit "E1" TBPTT stateful-GRU inference backend (settings/service/inference files) — **model work only, state paths untouched** | Local run; widget dev page connects to `ws://localhost:8080/ws` (`index.html:63`) |
| **server (deployed fork)** | `Desktop/nyx-chat-server` | `main` = origin (c3aa174) | clean; `chat_session.py` **byte-identical** to working repo → the §0.5.1 state audit applies to both | Cloud Run `nyx-chat-server`; pulls avatar-chat-server as `upstream` |

### Workflow per repo

**Widget** — keep working on `feat/procedural-gaze`. One commit per landed
item; commit message carries the falsifiable prediction + visual verdict.
Housekeeping (with Antonios): checkpoint-commit the current WIP before Phase
1; consider .gitignore for the `nyx_*.zip` experiment backups.

**Renderer** — ⚠ FIRST ACTION: the branch has uncommitted WIP I didn't
create — Antonios to confirm what it is, then checkpoint-commit it on
`feat/neck-pose-callback` before any new work. Phase 5 work happens on a new
branch `feat/idle-clip-amplitude` cut from `feat/neck-pose-callback`.
Dev loop: edit `src/` → `npm run build` → widget dev server picks the fresh
`dist/*.esm.js` via the alias → hard refresh. Gotchas (Part VI Q18): the dev
alias loads the UNMINIFIED bundle so `console.log` works there, but terser
strips `.log`/`.debug` from the min build — use `console.warn/error` for
anything that must survive; never point the alias at the `.min.js`.
Acceptance → version bump + publish per Antonios' npm process; the alias
stays for local dev.

**Server** — working repo is `Desktop/avatar-chat-server` (NOT nyx-chat-server
— corrected 2026-07-07). Never commit to `main` directly. Branches off `main`:
`chore/packet-timing-trace` for T7/T8 instrumentation (debug-flag logging,
mergeable), `feat/avatar-state-thinking` for 4.1/4.2. PRs to origin `main`;
Antonios reviews + deploys. Likely prod flow (confirm with Antonios at Phase
4): avatar-chat-server `main` → nyx-chat-server merges `upstream/main` →
Cloud Run auto-deploy. Both repos' mains are wired to Cloud Build triggers —
**merge to either main = production deploy**.
⚠ Naming collision (why our experiments are T-numbered): Antonios' audio2face
MODEL versions are named E1/E7 (`feat/e1-tbptt-stateful`, `e1_onnx_path`,
`e7_onnx_path`) — never label plan experiments "E*".

### Cross-repo compatibility rules (hard requirements)

1. **Server ships independently of widget:** old deployed widgets already map
   `Thinking→Responding` (`ChatManager.ts:376`) = today's behavior, so 4.1 is
   safe to deploy before any widget change.
2. **Widget tolerates old servers:** a widget with the Thinking pack must
   behave correctly against a server that never sends `Thinking` (it simply
   never enters the state).
3. **Renderer options default to current behavior:** `idleClipAmplitude`
   defaults to 1.0 — widget with old renderer and renderer with old widget
   must both render exactly as today.
4. **OAC zip format untouched** in all three repos.

---

## VERIFIED FACTS (code-read, 2026-07-06 — no longer assumptions)

| # | Fact | Evidence |
|---|---|---|
| V1 | Mic PCM **is** tappable in-widget: AudioWorklet (preferred) / ScriptProcessor PCM16 path delivers raw buffers via `onData`; `echoCancellation: true` requested. RMS tap = a few lines on existing buffers, no new permission. | `src/services/AudioInput.ts:99-205`, `src/config.ts:82` |
| V2 | The per-frame RAF state writer is **NOT legacy-only**: `useSyncPlayback` flips false on every `audio_start` and back on first `sync_frame` — the poll writer is live at the start of EVERY turn (and whole turns if server lacks wav2arkit). Arbiter must handle it as a first-class writer. | `ChatManager.ts:464, 500, 747-755` |
| V3 | Server sends only `Responding` + `Listening`; never Thinking/Processing/Idle. `Listening` means "avatar's turn ended", NOT "user speaking". No user-speech signal exists in the protocol. | `chat_session.py:209, 353, 514`; STATE_MACHINE.md §0.5.1 |
| V4 | On barge-in the server sends `interrupt` then `avatar_state: Listening` (in-order over WS); the widget's local `Idle` write lands in between → transient flap. | `chat_session.py:508-514`, `ChatManager.ts:739` |
| V5 | Widget→state writers: ~10 call sites, no arbitration (mapped list in STATE_MACHINE.md §0.5 item 1). | `ChatManager.ts` grep |
| V7 | **Server repos (corrected 2026-07-07):** the WORKING repo is `Desktop/avatar-chat-server` — many branches, currently on `feat/e1-tbptt-stateful` with uncommitted wav2arkit WIP (an "E1" TBPTT stateful-GRU inference backend + e7/v8–v11pca ONNX paths + LAM WSL daemon config; latest commits: V23-MP ONNX 2026-06-10, A2F-3D port 2026-05-18). This WIP touches ONLY the lipsync backend — `chat_session.py` state paths untouched and **byte-identical** to `nyx-chat-server` (the deployed fork, single clean `main` @ c3aa174, pulls avatar-chat-server as `upstream`). Cloud Run yaml exports show BOTH repos' mains auto-deploy via Cloud Build triggers (avatar-chat-server service from 6ad7980; nyx-chat-server from c3aa174). ⚠ **Merge to either main = production deploy.** T7 tracing runs LOCALLY only (existing `settings.debug` logging may suffice). | `git branch -a -v` both repos, `diff -q chat_session.py` = identical, yaml `commit-sha` labels |
| V9 | **F4 — the TTS energy signal NEVER reached the avatar** (found 2026-07-07 when speech-gating made the head fully still): `LazyAvatar` didn't forward `updateAudioRMS`, and ChatManager's optional call (`?.`) silently no-op'd. `smoothedAudioRMS` was 0 always → the RMS-driven rhythm bob, emphasis bursts, speech gate, AND the pause detector never ran (pause detector permanently "in pause" → speaking gaze used the away-biased returnProb constantly). All talking head motion ever seen = the free-running baselines — fully explains the original "motion doesn't track speech" observation. Fixed: LazyAvatar forwards RMS; `[NeckPose]` log now prints rms+gate for verification. **Lesson: optional-call (`?.`) interface seams silently eat wiring bugs — verify signal paths end-to-end with numbers.** | `LazyAvatar.ts` grep (no updateAudioRMS), `ChatManager.ts:315` |
| V8 | **F3 — the "broken neck" after talking was the renderer's OWN animation state machine** (found during the 2.3 live verify): `AnimationManager` gave each state a CLONE of the shared idle clip; entering a state did `action.time = 0` (instant body-pose snap), Speak played its clone LoopOnce+clampWhenFinished (body froze mid-turn), and transitions crossfaded between clones at different clip phases (pose lurch). This machine predates our work and explains earlier "head moves weirdly" reports that the widget-side blend (P1.3) could never fix. **Fixed:** renderer single-clip mode (commit `6e88a30`) — with exactly one body clip, it loops continuously and state updates are no-ops; procedural layers own all conversational motion. Consequence: the body clip now also keeps playing during long answers instead of freezing at clip end. | `AnimationManager.js` read; fix committed on `feat/camera-lookat-gaze` |
| V6 | **The running renderer dist is built from the uncommitted WIP** (dist contains marker `2026-06-11-neckdebug`; dist mtime 06-12 > src mtime 06-11). The WIP: (a) `animationConfig` plays ONLY the idle clip for ALL states — speak clips disabled ("locked decision 2026-06-11"); (b) implements the rig-agnostic Euler-YXZ POST-multiply delta contract exactly as documented (A4 source-verified); (c) contains the `[skinning-top10]` diagnostic that produced the 94.67% head-lock finding + a top-of-module build marker. Consequence: body energy is CONSTANT across states in the live widget — only procedural head motion differs between Idle/Listening/Responding. | renderer `git diff` + dist grep, 2026-07-07 |

## ASSUMPTION REGISTER (open — each has an experiment)

| # | Assumption | Risk if wrong | Verify via | Blocks |
|---|---|---|---|---|
| A1 | ✅ **VERIFIED (T1 run 2026-07-07)** — writer taxonomy confirmed + surprises recorded in T1 RESULTS below (avatar instance recreated on expand; `minimize`/`text-send`/`expand-reconnect` tags absent → those UI paths route differently than statically assumed; investigate during P1) | — | unblocks 1.1, 1.2 |
| A2 | ✅ **VERIFIED (T1)** — `playback-drained` beats server `Listening` every turn; server lag measured +591 / +907 / +999 ms. Fallback window 1.5–2 s is correct. | — | unblocks 1.2 |
| A3 | ✅ **VERIFIED (T1)** — no legitimate transition <300 ms observed; every sub-300 ms transition in the trace was flap we want suppressed | — | unblocks 1.1 |
| A4 | ✅ **VERIFIED** — contract source-verified (V6); T3 live: callbacks run at **60 Hz** (not the assumed 30 — docs corrected). Post-multiply/identity/YXZ per source. | — | unblocks 1.3, 2.3–2.5 |
| A5 | ❌ **FALSIFIED (T4 mesh-geometry probe, 2026-07-07)** — measured deg/unit: out 21.4, in 9.6, up 14.2, down 11.9 (vs assumed 30). Also ASYMMETRIC (out:in = 2.2×) → same-unit binocular drive had a built-in vergence error. Fixed with per-direction `EYE_DEG_PER_UNIT` in `applyGaze`. Estimates carry eyelid-follow contamination error; refine against visual test. Right eye assumed mirrored (probe pending). | — | 2.3 fixed |
| A6 | ✅ **VERIFIED (T3 live 2026-07-07)** — face frame is read BEFORE neck pose in ~99% of frames (300:2–6), both at 60 Hz → VOR uses the previous frame's neck delta = 16.7 ms lag, visually negligible. | — | unblocks 2.3 |
| A7 | Browser echo cancellation suppresses avatar TTS in the mic signal well enough that reflexes don't self-trigger | Avatar "reacts to itself"; reflexes unusable on speakers | **T5** | 3.2, 3.3 |
| A8 | RMS-only pause detection is a usable proxy for the low-PITCH backchannel cue across real noise environments | Nods fire on noise / never fire | **T6** | 3.2 |
| A9 | Gemini emits thought-text `model_turn` parts BEFORE first audio, reliably, and they're distinguishable from real content (`part.thought` flag?) | Thinking trigger unreliable; 4.2 fix mis-scoped | **T7** | 4.1, 4.2 |
| A10 | The Thinking window is long enough to matter (median >1 s — Shiwa: displays pointless below ~1 s) | Phase 4 is wasted effort for Gemini | **T7** | GATES Phase 4 |
| A11 | Delaying `response_start` until first AUDIO won't orphan early transcript deltas / break turn bookkeeping | Broken subtitles/transcripts | **T8** | 4.2 |
| A12 | ✅ **VERIFIED (T9 live probe 2026-07-07)** — `mixer.timeScale=0` froze the body completely in Idle (only blendshape-driven blink/eyes kept moving). The clip IS the Idle energy source. Structure found: `__nyxRenderer.animManager.{idle,listen,think,speak}.actions[0]` + `.mixer`. Runtime-confirmed V6: all four state slots share ONE clip — `yumi_h5_a3_idle` (weights all 1.0). | — | unblocks 5.1 |
| A13 | **T9 evidence in (2026-07-07):** naive `setEffectiveWeight(0.5)` on the shared idle clip = motion eases BUT posture sags (visible forward lean; restores at 1.0) — LERP toward bind pose, exactly the predicted artifact. Naive weight scaling is NOT usable as the amplitude knob → `makeClipAdditive` conversion over a base pose is REQUIRED. Remaining: T10 prototypes the additive path in the renderer. | 5.1 design now fixed: additive, not naive weights | **T10** | 5.1 |
| A14 | Literature parameter values transfer to our render scale (chest-up framing, head-locked rig inflation) | Tuned values still look wrong | Phase 2 runs ARE the experiments (falsifiable prediction each) | 2.1–2.5 |

## EXPERIMENTS (Phase 0 — verify before build)

**T1 — Widget state-write trace** *(pure logging, land immediately)*
Tag every `setChatState` call site with a source label; log
`[state] <source>: <prev>→<next> t=<ms> dwell=<ms>`. Run a scripted scenario:
connect → voice turn → barge-in → text turn → minimize/expand → reconnect.
Deliverable: the real writer timeline. Verifies A1, A3; feeds arbiter design.

### T1 RESULTS (live run 2026-07-07, Gemini agent, local avatar-chat-server)

**The barge-in produced FIVE state transitions in 145 ms** (10:20:02.763–.908):
1. `Responding → Idle` (`stop-all-playback`, local)
2. `Idle → Listening` (server interrupt signal, same millisecond)
3. `Listening → Responding` (+44 ms — **server re-fired `response_start` on
   stale packets of the CANCELLED turn**, with 2× `audio_start`)
4. `Responding → Listening` (+84 ms — second server interrupt cycle)
5. `Listening → Responding` (+17 ms — **the RAF poll writer fought the
   server**, V2 confirmed live)

Each transition restarts the 500 ms neck ramp + fires the turn-yielding gaze
snap → the "very bad" interruption Antonios saw. With arbiter + 300 ms dwell
+ no local Idle-forcer this collapses to ONE transition (Responding →
Listening).

**New findings:**
- **F1 (server bug): interrupt resurrection.** After `interrupted`, the
  Gemini agent's `(model_turn or output_transcription) and not is_responding`
  check (`gemini/sample_agent.py:437-452`) resets `_response_cancelled` on
  leftover packets of the cancelled turn → spurious `response_start` +
  double `audio_start` within 50 ms. Fix: guard new-turn detection with a
  turn/generation id, not a boolean. → added as Phase 4.4.
- **F2 (widget): late `stop-all-playback` stomps.** Stops at 10:20:08.913
  and 10:20:22.748 yanked `Listening → Idle` ~0.6–1.5 s AFTER turn end —
  candidates: the scheduled-stop timeout (`ChatManager.ts:658`, cancellation
  path suspect) and/or the minimize path. Arbiter must treat
  `stop-all-playback` as a NON-state-writing cleanup (state comes from the
  server's interrupt `Listening`).
- **Turn-start blindness measured:** avatar sat in stale state 5.3–6.7 s
  spanning user speech + Gemini latency — the Phase 3 justification,
  quantified.
- Lifecycle: expand recreates the avatar instance (fresh trace counters,
  dwell anchor ~10:20:12.6) — procedural state resets on minimize/expand.

**T2 — Server event-send trace**
Server debug mode already timestamps sends; log `avatar_state`/`audio_start`/
`audio_end` send times and correlate with T1 receive times (same wall clock).
Verifies A2; measures the real end-of-turn race (V4).

**T3 — Renderer contract probe** *(devtools, `__nyxRenderer`, no code change)*
**Scope narrowed 2026-07-07:** A4's contract (rig-agnostic Euler-YXZ
post-multiply, identity=clip wins) is now SOURCE-VERIFIED in the WIP that
built the running dist (V6). Remaining runtime checks only: `getNeckPose`
call rate (~30 Hz?) and call order vs `getArkitFaceFrame` (A6, feeds VOR
phase alignment). Optionally sanity-check yaw 10° → visible block rotation.

**T4 — eyeLook calibration probe** *(devtools)*
Force known eyeLook values, measure apparent gaze deflection (against a head
rotation that visually cancels it). Derive true deg/unit → the VOR gain.
Verifies A5.

**T5 — Mic RMS + echo-leakage measurement** *(build 3.1 behind a debug flag —
the sensor IS the experiment)*
Log user-silent mic RMS while the avatar speaks: (a) laptop speakers, volume
high (worst case); (b) headphones. Deliverable: leakage vs speech RMS
separation → go/no-go + thresholds for reflexes. Verifies A7.

**T6 — Noise-floor robustness**
RMS histograms in quiet room vs background noise (music/street). If a fixed
threshold can't separate, design adaptive noise-floor (slow EMA). Verifies A8.

**T7 — Server packet-timing trace (Gemini, and OpenAI if configured)**
Debug-run 10+ varied turns (short/long questions). Per turn record:
t(last user audio), t(first thought part), t(first transcript delta),
t(first audio part), t(turn_complete). Deliverables: Thinking-window
distribution (A10 gate), thought-part reliability + `part.thought` flag check
(A9), `speech_stopped` timing on OpenAI.

**T8 — Turn-bookkeeping safety harness**
Use the server's existing `scripts/test_client_simulation.py` against a
branch with delayed `response_start`; assert `transcript_delta` turnIds and
subtitle timing stay intact. Verifies A11.

**T9 — Idle-energy kill-switch probe** *(devtools, no code change)*
Via `__nyxRenderer` locate the AnimationMixer/actions. Set idle action weight
→ 0: expect the body freezes in ALL states (per V6 the one idle clip drives
every state) — verifies A12. Then 0.5: expect drift toward bind pose
(demonstrates why `makeClipAdditive` is mandatory — evidence for A13/5.1
design).

**T10 — Additive-idle prototype** *(local renderer build; only if Phase 5
approved)*
`makeClipAdditive` + static base pose + weight knob; visual check; scope the
interaction with speak-clip crossfades. Verifies A13.

**Ordering:** T1+T2 need the live stack (coordinate with Antonios); T3, T4,
T9 need only the dev server + devtools; E5–T6 ride Phase 3.1; E7–T8 precede
Phase 4; T10 precedes Phase 5.

---

## Phase 1 — Make the state machine real *(widget only)*

Basis: §0.5 items 1–2, Part IX Q26/Q29, Part VIII Q25.
**Prerequisites: T1 (+T2 for 1.2's fallback window).**

### 1.1 Single state-arbitration point
All avatar-state writes routed through one arbiter enforcing: (a) server
`avatar_state` events outrank local writes; (b) min dwell ~300 ms (value to
be sanity-checked against T1 data); (c) every transition logged with source.
The T1 source tags become the arbiter's permanent write-source taxonomy —
including the per-turn RAF poll writer (V2).
Files: `src/managers/ChatManager.ts`, new `src/managers/AvatarStateArbiter.ts`.

### 1.2 Remove the wrong Idle-forcing writers
- `onRecordingStart` → stop forcing `Idle` (ChatManager:177).
- `sendTextMessage` → stop forcing `Idle` (ChatManager:711).
- Barge-in `stopAllPlayback` → stop forcing `Idle` (ChatManager:739); let the
  server's `Listening` (V4) win.
- Playback-drain handler (ChatManager:784) → fallback only: `Idle` iff no
  server state event within a window sized from T2 measurements (placeholder
  1.5 s).
Check for side effects: `setChatState` carries turn-yielding gaze logic on
leaving Responding (GaussianAvatar.ts:499-506) — confirm removals don't skip
it (T1 trace covers).

### 1.3 Single-phase transition blend (replace fade-through-zero)
Replace the two-phase 500 ms ramp (GaussianAvatar.ts ~554–608) with one
~250 ms blend from *current output pose* → new state's pose; mid-blend state
change = fire-and-forget restart from current output (Bollo); oscillators
stay phase-continuous. Fixes the procedural→procedural formula-snap +
neutral-dip (~581–590).
**Prerequisite: T3** (renderer contract). Verify with a forced state-flip
stress test: log max per-frame pose delta; prediction: no visible dip through
neutral, no snap, under rapid flips.

---

## Phase 2 — Parameter fixes *(widget only; one visual test each — these runs verify A14)*

**Prerequisite: Phase 1 landed (tests untrustworthy on a flapping machine); T3/T4 for 2.3.**

| # | Change | Files/knobs | Prediction (falsifiable) |
|---|---|---|---|
| 2.1 | Microsaccade 3° → ≤0.25° (or remove re-pick jitter) | `SACCADE_MICROSACCADE_DEG` (GaussianAvatar.ts:83) | Visible eye "flick" on re-picks disappears; aversion rhythm unchanged |
| 2.2 | Gaze cadence → Andrist norms (aversions ~4.75 s speaking / 7.21 s listening, 1–2 s long) | `SACCADE_BY_STATE` (39–73); leave pace multiplier | Gaze changes feel occasional & deliberate |
| 2.3 | VOR: counter-rotate eyeLook by procedural head delta, gain from T4 | `applyGaze` + `getNeckPose` shared pose | Eyes visibly hold target during head sway |
| 2.4 | Listening: roll 8° → ≤1°; baseline near-still (≤1°, ≤0.5 Hz); keep cue nods | `LISTEN_SWAY` (135–140) | Attentive stillness + occasional nods; no rocking. NOTE: Listening body clip = idle clip, so full energy-ordering fix waits on Phase 5 |
| 2.5 | Responding: gate yaw 6°/roll 5° baselines by speech RMS envelope; breathe 3° → <1° | `SPEECH_HEAD` (173–193) | Head moves when she talks, settles in pauses; "wobble on top" gone |

---

## Phase 3 — Local mic sensor: the "ear" *(widget only)*

Server stays turn authority; this is a reflex layer inside states (Part VIII
Q22). **Prerequisites: T5 (echo), T6 (noise) — T5 is built as part of 3.1.**

### 3.1 Mic RMS signal (+ T5 instrumentation)
Tap the PCM16 buffers already flowing through `AudioInput.onData` (V1);
compute ~30 Hz RMS; expose to `GaussianAvatar` beside the TTS RMS. Ship
behind a debug flag first = experiment T5. Nothing leaves the browser.

### 3.2 Rewire the Listening nod trigger
Point the Ward & Tsukahara trigger (≥110 ms low → nod 200–400 ms later) at
user-mic RMS instead of the (silent) TTS stream. Threshold design from T6
(adaptive noise floor if needed). Honest note: RMS pause ≈ proxy for the
low-PITCH cue; if it tests poorly, the upgrade path is a cheap F0 estimator.
Prediction: nods land in *your* pauses.

### 3.3 Attend reflex
On user speech onset (RMS > threshold ~200 ms sustained): gaze → mutual,
brief aversion suppression, baseline stillness. During Responding: attentive
reaction within the barge-in validation window (~200–500 ms, LiveKit) while
the server confirms. Gate on T5 results (speakers vs headphones may need
different thresholds or reflex disable).
Prediction: she visibly "notices" the moment you start talking.

---

## Phase 4 — Thinking state *(server + widget — APPROVED; branch `feat/avatar-state-thinking`)*

Basis: Part VIII Q23; §0.5.1. **Prerequisites: T7 (A9 + A10 gate), T8 (A11).
If T7 shows median Thinking window <1 s on Gemini, descope to OpenAI-only or
drop — evidence decides.**

### 4.1 SERVER: emit `avatar_state: "Thinking"`
Gemini: first thought-text `model_turn` part (currently ignored,
`gemini/sample_agent.py:486-490`) → send `Thinking`. OpenAI:
`input_audio_buffer.speech_stopped` → `Thinking`. Additive protocol change;
old widgets already map unknown states → Idle (`ChatManager.ts:380`).

### 4.2 SERVER: hold `Responding` until first AUDIO
`response_start` currently fires on ANY `model_turn` content
(`gemini/sample_agent.py:452`) incl. thought-only text → speaking pack on
silence. Restructure per T8 so transcript bookkeeping survives.

### 4.4 SERVER: fix interrupt resurrection (F1, found by T1)
Guard the Gemini agent's new-turn detection with a turn/generation id so
stale packets of a cancelled turn cannot reset `_response_cancelled` and
re-fire `response_start` (+double `audio_start`) within ms of an interrupt
(`gemini/sample_agent.py:437-452`). Verify with T8 harness + a live barge-in
trace re-run.

### 4.3 WIDGET: Thinking parameter pack
Remove `Thinking→Responding` alias (ChatManager:376-377); add `Thinking` to
`ChatState`; pack = upward cognitive gaze aversion (Andrist ~3.5 s,
predominantly up), near-still head, normal blink.
Prediction: the silent pre-answer gap reads as "she's thinking"; users wait
longer before assuming she's broken.

---

## Phase 5 — Idle energy *(renderer — APPROVED; branch `feat/idle-clip-amplitude`, after WIP checkpoint)*

**Prerequisites: T9 (A12 — confirm the clip is the energy source BEFORE
writing renderer code), then T10 (A13 scope).**

### 5.1 Runtime idle-clip amplitude scaling
`AnimationUtils.makeClipAdditive(idleClip)` (delta vs frame 0) played
additively over a static base pose, `setEffectiveWeight(0–1)` exposed as a
renderer option. Conversion mandatory (blendMode alone overscales — Part IX
Q27).
**Upgrade per V6:** since ONE clip drives ALL states in the running build,
the right shape is a **PER-STATE amplitude** (e.g. Idle 0.3 / Listening 0.4 /
Responding 0.7–1.0), smoothly interpolated on state change — this knob alone
can restore the Speaking > Listening > Idle energy ordering without touching
clips or the OAC zip. Old speak-clip crossfade interaction (pre-V6 concern)
is moot unless the locked decision is reversed.
Prediction: per-state amplitudes as above make Idle the calmest state and
Responding visibly the most animated — energy ordering restored.

---

## Status

| Item | Status | Blocked by |
|---|---|---|
| T1 state-write trace | **implemented 2026-07-07** (source-tagged `setChatState` + dwell + redundant-write counts; typecheck clean) — awaiting live scripted run | live stack session |
| T2 server event trace | pending | live stack session |
| T3 renderer probe | **instrumentation ready 2026-07-07** (`[T3]` rate/order log in GaussianAvatar, rides next live run; REMOVE after) | next live run |
| T4 eyeLook calibration | pending | dev server only |
| T5 echo leakage · T6 noise floor | pending | rides 3.1 |
| T7 packet timing · T8 bookkeeping harness | pending | live server session; branch `chore/packet-timing-trace` |
| T9 idle kill-switch probe | pending | dev server only |
| T10 additive-idle prototype | pending | T9; renderer WIP checkpoint |
| 1.1 arbiter · 1.2 writers | ✅ **VERIFIED LIVE 2026-07-07**: clean turns = exactly 2 transitions; raf-poll spam dropped by precedence; fallback armed→cancelled every turn; minimize applied as lifecycle. Residual interruption badness = server latency + F1 resurrection (state legitimately re-enters Responding when the server re-sends it + audio) + P1.3 not yet built. | — |
| 1.3 blend | **implemented 2026-07-07** — single-phase 250 ms cubic-out blend from CURRENT output; fire-and-forget; Idle target = zero delta. **Verify = ❓ UNCONFIRMED** (Antonios): transition quality is masked by the "dizzy" baseline amplitudes — re-judge after P2.4/P2.5 land. | re-verify after P2.4/2.5 |
| 2.4 Listening calm-down | ✅ **ACCEPTED by Antonios 2026-07-07** — LISTEN_SWAY roll 8→0.8, yaw 3→1.0, pitch 2→0.7, breathe 1→0.4. "This is ok." | — |
| 2.1+2.2 gaze cadence pack | ✅ **ACCEPTED 2026-07-07** ("looks ok for now") — Idle holds ~5 s @ 70% return (aversion ~15-20 s, ≤8°), Responding holds 2.8 s @ 0.92 fluent / 0.55 pause return, microsaccade 3°→0.25°. Soften knob if too starey: Idle returnProb 0.70. | — |
| 2.5 speech-gating | **implemented 2026-07-07** — yaw 6°/roll 5° drift now scaled by a speech-envelope gate (attack ~100 ms, release ~400 ms; silent = still), breathe 3°→0.5°. Prediction: head moves WITH the voice, settles in mid-answer silences; wobble-on-top gone. Then RE-JUDGE P1.3 transition feel (the ❓). | live look |
| 2.3 gaze hold | **REDESIGNED per Antonios → renderer-side camera look-at** (commit `2b64350` on renderer branch `feat/camera-lookat-gaze`, dist rebuilt). Widget-side VOR was the wrong layer — it only saw the PROCEDURAL head delta; the baked clip's head motion was invisible to it ("kinda holds" verdict + wrong-sign pitch). Now: renderer solves eyes→camera against the TRUE head world pose each frame + adds the widget's behavioral offset via new `getGazeOffset` callback; per-direction T4 calibration (out 21.4 / in 9.6 / up 14.2 / down 11.9); gaze-zero = head-local camera dir captured at first frame; 1 Hz `[gaze-lookat]` numeric trace; sign knobs in renderer `GAZE_LOOKAT.gain*`. Widget publishes saccades as offsets; legacy channels kept for old renderers. Awaiting live verdict. | live look |
| T4 | ✅ COMPLETE — mesh-geometry probe measured the calibrations above (A5 falsified/fixed) | — |
| F9 holistic energy-signal redesign | Antonios: "revisit the energy smoothing, take a more holistic approach." The energy path had accreted 5 smoothing stages at mixed rates (fast EMA → slow EMA → rhythmAmpEma → speechGate → callback-rate pause detector) plus a discrete 2.2 Hz emphasis BEAT — the one component producing a genuinely FAST FORWARD dip, best match for the reported jerk. **Redesign:** a single **energy envelope follower** (`_energyEnv`, attack 0.20 ≈55 ms / release 0.04 ≈350 ms, asymmetric fast-attack-slow-release) advanced at RENDER rate from the latest raw RMS (stale feed ⇒ 0 ⇒ smooth release). `updateAudioRMS` now only captures raw. Everything derives from `_energyEnv`: pitch bob amplitude, the soft yaw/roll drift gate (`min(1, env/gateRef)`), and the pause detector (moved to render rate). **Removed the discrete beat entirely** (can return gentler later). Removed: smoothedAudioRMS, _slowRmsEma, _rhythmAmpEma, _speechGate, _beatStartMs/_beatAmpDeg, F5 decay hack, PAUSE_RMS_EMA_ALPHA, lastAudioRMSUpdateMs. `[NeckPose]` log now prints `energy=`. Research agent dispatched on standard audio-energy→head smoothing recipes (envelope followers, 1€ on pose, talking-head temporal stability). | typecheck clean; awaiting live verdict |
| F8 RMS at schedule-time (talking-glitch candidate) | **Antonios corrected a tunnel-vision: the glitch is DURING talking, no state change** (his trace: 12.5 s of unbroken Responding still glitched). Root mechanism found: `SyncPlayback.scheduleAudioFrame` emitted `onAudioRMS` at SCHEDULE time — ~150 ms ahead of the audio actually heard, and in bursts tied to frame delivery; whenever `frameBuffer` momentarily emptied, RMS went stale and the F5 decay cratered it, then it sprang back on the next batch = **head-motion pulsing during talking**. The F5 decay likely worsened it. **Fix:** RMS is now stored per-frame and emitted at PLAYBACK time inside `updateBlendshapeForCurrentTime` (same audio clock as blendshapes), steady ~60 Hz, with explicit 0 between frames. Head motion is now synced to the heard audio, no burst pulsing. F5 decay retained only for the post-playback tail. UNVERIFIED — needs Antonios' eye + `[NeckPose]` rms values during any residual glitch. | `SyncPlayback.ts:352` emitted at schedule time |
| F7 post-turn Idle glitch | ✅ **The "glitch" Antonios kept seeing.** After a turn the SERVER sets `Listening` (its real between-turns resting state — it never sends `Idle` during a conversation). The widget's `playback-drained` fallback then armed an `Idle` write; because the server's `Listening` arrived just BEFORE the fallback was armed, the arbiter's cancel-on-server-write never caught it, and 5 s later it fired: `Responding → Listening → Idle`. Classic widget-overrides-server. **Fix:** `playback-drained` now targets `Listening` (matches the server), making it a no-op when the server already did its job and a correct recovery otherwise. Exposed + fixed a latent **phantom-nod bug**: the Listening nod cue keys off accumulated audio-silence, which is stale between turns (no feed) → continuous nodding at rest; now guarded on a fresh RMS feed (`_lastRmsUpdateMs`). Architectural principle reinforced: the widget follows server state, never overrides it. | 20:54 trace: fallback armed AFTER server Listening |
| F6 mid-turn teardown | ✅ **ROOT CAUSE of the "breaks/restarts" reports.** SyncPlayback's `handlePlaybackEnd` fires on every buffer UNDERRUN (`frameBuffer empty && no active sources`), which happens in the gaps between Gemini's multi-segment answers. That set `playbackEnded` → the drain-cleanup block ran a full end-of-turn teardown (resetPlaybackState + disableLiveBlendshapes + arbiter→Idle fallback) up to 4× PER ANSWER (confirmed in 20:40 trace). The visual guards (face gate, RMS decay, blend) masked most of it, but one gap exceeded the 5 s fallback → real Idle drop mid-conversation. **Fix:** added `serverStreamClosed` flag (set by the server's authoritative `audio_end`, reset on `audio_start`); the drain-cleanup now requires `serverStreamClosed && buffer empty`, so mid-answer gaps no longer tear the turn down. Server `audio_end` per spec = "mark stream closed, do NOT stop playback." | `SyncPlayback.handlePlaybackEnd` fires on underrun; fix in ChatManager |
| T11 transition-break trace (NEW) | **instrumented 2026-07-07** — Antonios reports "animation breaks and restarts from neutral, sometimes". Known candidate paths: (a) drain-cleanup → `resetPlaybackState` → `disableLiveBlendshapes` = instant face-neutral snap at EVERY buffer drain, incl. mid-answer segment gaps; (b) arbiter drain-fallback → Idle when the server skips end-of-turn `Listening` (e.g. after barge-in F1 paths); (c) stale interrupt-scheduled stop. All teardown paths now log `[teardown] reason=...`; awaiting a captured incident. Fix queue: P1.4 face ease-out, mid-answer drain guard, barge-in Listening fallback. | repro run |
| 1.4 face ease-out on Responding-exit (NEW) | pending — on interrupt/turn-end the mouth currently freezes at the last live frame or snaps to neutral; needs Q1 fade (mouth ~180 ms, brow ~350 ms, cubic-out). NOTE: a previous attempt was REVERTED (`cbdbb97` → revert); find out why before re-implementing. | P1.3 first |
| 2.1–2.5 parameter fixes | pending | Phase 1; T3/T4 for 2.3 |
| 3.1 mic RMS · 3.2 nod trigger · 3.3 attend reflex | pending | T5/T6 |
| 4.1–4.3 Thinking | pending | T7 gate, T8 |
| 5.1 idle clip scaling | pending | T9/T10 |
| Renderer WIP checkpoint (Antonios confirms what the uncommitted changes are) | pending | Antonios |
| Widget WIP checkpoint + asset-backup .gitignore housekeeping | pending | Antonios |

*Update as items land; record the falsifiable prediction + visual verdict per
run. When an experiment kills an assumption, update the affected items here
AND note it in STATE_MACHINE.md §0.5.*
