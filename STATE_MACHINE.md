# Avatar State Machine, Head Motion & Gaze — Project Intro + Handover

*Restructured 2026-07-06 as the handover document for the agent taking over this
workstream. Part 0 is the project intro + implementation map + current problems.
Parts I–VII below it are the original research compilation (2026-06-10/11) that
the implementation cites — keep them; they are the parameter source of truth.*

---

# PART 0 — PROJECT INTRO & HANDOVER

## 0.1 Why this exists (the goal)

Nyx is a real-time conversational Gaussian-splat avatar (web widget, 30 fps).
The audio2face model drives the FACE (lipsync + expression, 52 ARKit
blendshapes). Everything else that makes an avatar read as *alive* —
**blinking, eye gaze, head/neck motion, per-state body animation** — is
procedural and owned by the widget. This split is a locked architecture
decision (memory: `project_nyx_motion_separation.md`): model owns
lipsync+expression channels, widget owns blinks/gaze/neck.

The state machine exists because these procedural behaviors must CHANGE with
the conversation phase: an avatar that stares and sways identically while
idle, listening, and talking reads as robotic. Target quality bar:
customer-service avatar (not film). The canonical design pattern (researched,
Part I Q3): a small discrete FSM where **each state is a parameter pack** for
continuously-running subsystems — never toggling subsystems on/off, only
retargeting their parameters with smooth transitions.

## 0.2 Where everything lives

| Thing | Repo / branch | File |
|---|---|---|
| State type (3 states) | `avatar-chat-widget` @ **`feat/procedural-gaze`** | `src/types/common.ts:7` — `'Idle' \| 'Listening' \| 'Responding'` |
| Transitions (who sets state) | same | `src/managers/ChatManager.ts` — server `avatar_state` events mapped at ~368-380; `'Responding'` on TTS start (466, 496, 752); `'Idle'` on stop/disconnect/errors |
| ALL per-state behavior | same | `src/avatar/GaussianAvatar.ts` (single file, ~1000 lines) |
| Renderer callback slots | `gsplat-flame-avatar-renderer` @ `feat/neck-pose-callback` (built dist consumed via widget `node_modules/@myned-ai/...`) | `getChatState`, `getExpressionData`, `getNeckPose` options |
| Body clips (baked) | inside each avatar's OAC zip | `animation.glb` — **CORRECTION 2026-07-07:** the renderer's COMMITTED code maps Responding → 3 speak clips (random + crossfade), Idle/Listening → idle loop. But the RUNNING dist is built from uncommitted WIP (marker `2026-06-11-neckdebug` present in dist) whose `animationConfig` plays **ONLY the idle clip for ALL states** ("locked decision 2026-06-11" — speak/listen/think clips disabled; procedural neck is solely responsible for conversational head motion). Body energy is therefore CONSTANT across states in the live widget. |

Widget repo path: `C:/Users/AntoniosMakrodimitra/Desktop/avatar-chat-widget`.

**Server → widget state mapping** (ChatManager ~373): `Idle→Idle`,
`Listening→Listening`, `Thinking→Responding`, `Processing→Responding`,
`Responding→Responding`. There is no widget-side Thinking or Hello state yet
(research Part I Q3 designed 5 states; only 3 are wired).

## 0.3 What is implemented today (v1) — map of GaussianAvatar.ts

All line numbers on `feat/procedural-gaze` as of 2026-07-06.

| Subsystem | Config | Logic | Notes |
|---|---|---|---|
| **Blink** | `BLINK_INTERVALS` (line 21) | `applyBlink()` (~832) | Per-state intervals: Idle 2-4 s, Listening 1.5-3.3 s, Responding 1.3-3.3 s. 7-frame patterns, random intensity. Overrides server eyeBlink. |
| **Gaze (saccades)** | `SACCADE_BY_STATE` (39), pace/pause consts (79-113) | `applyGaze()` (~885) | Eyes-Alive Markov model: mutual↔away targets, main-sequence durations, `GAZE_PACE_MULTIPLIER=2.0` (Pejsa). Responding: pause-detector swaps returnProb (fluent 0.85 / pause 0.25). Writes the 8 eyeLook* channels, overrides server. |
| **Head/neck pose** | `LISTEN_SWAY` (135), `NOD` (143), `SPEECH_HEAD` (173), `NECK_DIST*` (197-215) | `getNeckPose()` (~547) | Called by renderer per frame. Per state: **Idle → returns `null`** (baked idle clip alone drives body). **Listening** → multi-sine sway (yaw 3°, pitch 2°, roll 8°, breathe 1°) + damped-sine nod cue-triggered on 110 ms audio silence. **Responding** → RMS-driven: 1.6 Hz rhythm oscillator (amp ∝ RMS, clamp 10°) + high-pass RMS burst (clamp 8°) + breathe 3° + slow yaw 6° + roll 5°. Output → 1€ filter → distributed over head/neckUpper/neckLower (0.55/0.30/0.15). |
| **State transition ramp** | `STATE_ENTER_RAMP_MS=500` (208) | inside `getNeckPose()` (~554-608) | Two-phase: fade OUT previous state's pose over 250 ms → fade IN new state over 250 ms. Idle→X skips fade-out. |
| **Pause detection** | consts 103-106 | `updateAudioRMS()` (~763) | TTS RMS EMA + hysteresis (enter 400 ms low, exit 100 ms high). Feeds both gaze aversion clustering and the Listening nod trigger. NOTE: currently fed by TTS *output* audio — during Listening there is no user-mic RMS wired, so the nod trigger fires off the avatar's own (silent) output stream. |
| **Frame assembly** | — | `getArkitFaceFrame()` (~796) | live blendshapes → forceEyesClosed → applyBlink → applyGaze. |

Debug logging already in place: `[NeckPose]` (1 Hz, state/amp/pitch/yaw/roll)
and `[gaze]` per saccade (mode, target, transition, hold). Also
`__nyxRenderer` is exposed on window for devtools probes (commit 3d204c6).

## 0.4 USER OBSERVATIONS — the work order (2026-07-06)

These are the problems the user reports watching the live widget. They are
the reason for this handover. Treat the user's eye as the acceptance gate;
metrics/logs are advisory.

1. **Head movement is too wacky and out of sync.** The procedural head
   motion during speech doesn't track the speech — it reads as random
   wobble layered on top of talking, not as motion belonging to the speech.
2. **Idle moves MORE than talking — backwards.** The energy ordering is
   inverted: the Idle avatar visibly sways/moves more than the Responding
   avatar. Expected: idle ≈ calm breathing-level motion; talking ≈ the most
   animated state.
3. **Eye gaze changes far too frequently.** Saccades fire too often; the
   avatar's eyes flick around instead of holding gaze naturally.

### Starting-point analysis (hypotheses — NOT verified, verify before acting)

- Observation 2: in Idle the widget emits `null` neck pose and the **baked
  `animation.glb` idle clip** alone drives the body — so Idle's motion level
  is whatever was authored into the avatar's idle clip, which the widget
  cannot scale. Meanwhile Responding = speak clips + procedural degrees. The
  mismatch likely lives in the CLIP AMPLITUDES (per-avatar, inside the OAC
  zip), not in widget constants. Any fix purely in widget constants can only
  raise Responding motion, not calm Idle. Options to evaluate: renderer-side
  clip amplitude scaling, re-authoring idle clips, or driving Idle
  procedurally too (return a damped pose instead of null).
- Observation 1: Responding head driver uses **RMS as an F0 placeholder**
  (documented in the code comments as REV 3, and in Part II Q5: RMS is the
  weakest prosodic driver; real heads rise on PITCH peaks and nod at phrase
  boundaries). Also three uncorrelated multi-sine baselines (yaw 6°, roll 5°,
  breathe 3°) run simultaneously during speech — they move regardless of what
  is being said, which is plausibly the "wacky/out of sync" component.
  Directions: mute/shrink the non-speech baselines, gate them by RMS, or
  implement an F0 tracker (Part II Q5) so motion locks to prosody.
- Observation 3: current holds (mutual ~1-1.3 s × pace 2.0 ≈ 2-2.6 s; away
  200-280 ms × 2.0 ≈ 0.4-0.6 s) still produce a gaze change every ~2-3 s.
  Knobs, in order of bluntness: `GAZE_PACE_MULTIPLIER` (93), per-state
  `mutualMean`/`returnProb` (39-73), `SACCADE_MICROSACCADE_DEG=3` (83 — the
  ±3° jitter on EVERY mutual re-pick may itself read as flicking; Eyes Alive
  microsaccades are sub-degree in most implementations).

### Constraints the next agent MUST respect

- **Head-locked rig** (Part VII Q21): 94.67% of skinning weights sit on the
  `head` bone. The cervical 0.55/0.30/0.15 distribution is mostly cosmetic —
  neckUpper/neckLower shares barely move anything; the head share moves the
  whole upper body as a block. Large head angles therefore translate the
  torso visibly. Keep procedural amplitudes small, or fix the template
  weights (deferred; see Q21 pointers).
- **OAC zip format is locked** — animation.glb clip order/count is coupled to
  the renderer's hardcoded `animationConfig`.
- **Widget owns blink + gaze + neck.** Don't re-enable server eyeBlink /
  eyeLook pass-through.
- `getNeckPose`/`getArkitFaceFrame` run per frame at 30 Hz — no allocations,
  keep the cached-object pattern.
- Renderer POSTMULTIPLIES the neck delta onto the clip's bone rotation —
  identity delta = clip wins. Euler 'YXZ'. (Part VI Q17 for the math
  gotchas.)
- The user demands single-variable changes with a falsifiable prediction per
  run, and judges visually in the widget. Don't stack multiple tuning changes
  into one test.

### How to test

```
cd C:/Users/AntoniosMakrodimitra/Desktop/avatar-chat-widget
npm run dev        # https://localhost:5173 (HTTPS, mic permission needed)
```
Hard-refresh (Ctrl+Shift+R) after every asset/code change. Watch console for
`[NeckPose]` and `[gaze]` lines. Avatar asset = `public/asset/nyx.zip`.
A talk turn: click mic, speak, watch Listening → (server) → Responding →
Idle. The avatar-chat-server must be running for full conversation flow.

> **Action plan:** the fixes for everything in this audit are broken down,
> phased, and tracked in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 0.5 Design audit (2026-07-06) — literature verification + code ground-truth

*Four-agent research verification pass (HRI gaze, turn-taking/latency,
animation transition practice, listener/idle motion norms) plus a code audit
of the state-transition path. New research lives in Q7b, Q8b, and Parts
VIII–IX. Verdict summary:*

**Sound and verified:**
- The core architecture — discrete FSM as parameter packs over always-running
  subsystems, smooth retarget — is canonical (Anguelov Game AI Pro 2 ch. 12
  verified from full chapter; BML/SmartBody; motion-matching lineage).
- Eyes-only gaze (no head recruitment) is biomechanically correct below ~20°
  gaze shifts (Freedman & Sparks 1997). All our shifts qualify.
- Phase-continuous oscillators with amplitude-only ramps = correct practice
  (synth-envelope pattern; PFNN phase-averaging evidence).
- Keeping the gaze generator running in Idle is correct (BML gaze persists
  until redirected; humans saccade continuously at rest).

**Not solid (ranked by severity):**
1. **The FSM is not a machine — it is a shared variable.** `setChatState` has
   ~10 uncoordinated writers (server `avatar_state`, TTS start ×2, mic-record
   start→Idle, sendText→Idle, barge-in stop→Idle, RAF poll, playback drain,
   connect/minimize/error paths). Last writer wins; no arbitration, no
   transition legality, no dwell time, no mid-ramp policy. Industry treats
   mid-transition interruption as first-class configuration (Unity
   Interruption Source; Bollo fire-and-forget; Anguelov merge-vs-terminate).
   → Part VIII Q25, Part IX Q26/Q29.
2. **Two-phase fade-through-zero transition has no precedent found.** Every
   documented mechanism blends old→new directly in ONE phase of 200–300 ms.
   Code also diverges from this doc: for procedural→procedural changes BOTH
   ramp phases compute the NEW state (`GaussianAvatar.ts` ~581-590) — formula
   snap, then a dip through neutral. → Part IX Q26.
3. **Thinking→Responding aliasing is contradicted by every source found.**
   The documented processing display is a long UPWARD cognitive gaze aversion
   (3.54 s ± 1.26, starting ~1.3 s before the response) — not speech
   behavior; context-mismatched motion rates worse than doing nothing. A
   dedicated Thinking display is one of the best-attested wins in the corpus
   (4 independent studies, ~65% user preference). → Part VIII Q23.
4. **±3° "microsaccade" is a mislabel — it is a visible re-fixation.** Real
   microsaccades: median ~0.075°, classical bound ~0.25°, generous modern cap
   1–2°. Ours is 12× the classical bound and fires on every mutual re-pick.
   Aversion cadence is also ~5–10× human norms (Andrist 2014: aversions every
   4.75 s speaking / 7.21 s listening, lasting 1–2 s). Likely THE cause of
   user observation 3. → Q8b.
5. **Listening ±8° continuous roll sway has no basis.** Listener heads are
   still 40–90% of the time; listener motion ≈ intermittent pitch nods (−3°
   to +15°); roll is rare and episodic. The 8° figure misapplied a
   step-and-hold empathy-tilt GESTURE amplitude (Q7 catalog) as a continuous
   oscillation amplitude. Energy law: **Speaking > Listening > Idle**, ~7:1
   speaking:listening movement-time (Hadar 1983). Together with the
   unscalable idle clip this explains user observation 2. → Q7b.
6. **No VOR.** Procedural head sway drags gaze with it (no eye
   counter-rotation); Pejsa 2015 implements VOR explicitly. This adds
   continuous speech-locked gaze drift on top of the saccades. Cheap fix
   candidate. → Q8b.
7. **Server-authoritative state is too slow for listener gaze reactions.**
   Human listener gaze shifts cluster −50 ms..+0.9 s around turn end; our
   earliest flip = server endpoint (~700–1000 ms silence) + WS round trip.
   Literature prescribes a widget-local reactive layer (mic VAD/RMS, 50–200
   ms) with server state as slower authoritative correction; head/posture
   may legitimately lag (+0.8 s). → Part VIII Q22.
8. **Breathing ±3° head pitch too large** (real contribution <1°, belongs in
   chest; speech breathing is phrase-locked, not sinusoidal). Responding
   baselines (yaw 6°/roll 5°) are amplitude-plausible but running them
   speech-INDEPENDENT is the defect behind user observation 1's "wobble" —
   gate/scale them by the speech envelope. → Q7b.

### 0.5.1 Server ground truth (nyx-chat-server code audit, 2026-07-06)

Read from `C:/Users/AntoniosMakrodimitra/Desktop/nyx-chat-server`. This
CORRECTS §0.2's server→widget mapping table and revises audit item 7.

**The server only ever sends TWO avatar states:**
- `Responding` — `chat_session.py:209`, fired on `_handle_response_start`
  (first content back from the upstream agent).
- `Listening` — `chat_session.py:353` (end of `_handle_response_end`, i.e.
  "avatar finished talking") and `chat_session.py:514` (on barge-in).
- **`Thinking` / `Processing` / `Idle` are NEVER sent.** The widget's
  stateMap entries for them (ChatManager ~373) are dead code.

**There is NO user-speech signal in the protocol at all.** "Listening" means
"my turn ended", not "the user is speaking". While the user talks, the widget
receives ZERO events: Gemini's live input transcription is BUFFERED
server-side (`gemini/sample_agent.py:409-413`) and only flushed when the
MODEL starts responding (456-458). VAD lives upstream at the provider
(Gemini `START/END_SENSITIVITY_LOW` — deliberately conservative,
`gemini_settings.py:64-65`; OpenAI `semantic_vad`, default silence 500 ms,
`openai_settings.py:55,61`, threshold params commented out in
`openai/sample_agent.py:141-143`). OpenAI's
`input_audio_buffer.speech_started/stopped` events exist but are only used in
a debug skip-list (`openai/sample_agent.py:244-245`).

**Additional pathologies found:**
- **"Responding" can fire on Gemini THOUGHT text before any audio.**
  `response_start` triggers on any `model_turn` content
  (`gemini/sample_agent.py:452`), and the preview native-audio model emits
  thinking text as model_turn parts (ignored at 486-490, but the packet still
  starts the turn). So the widget enters the SPEAKING pack while Gemini is
  still thinking silently — the silent-Responding pathology, confirmed with
  mechanism (not via the stateMap as §0.2 implied). Corollary: those
  thought-text packets are a ready-made, zero-cost **Thinking trigger**.
- **`Listening` (turn-end) trails real audio end by ≥750 ms**: response_end
  waits for audio stabilization (15 × 50 ms polls, `chat_session.py:282`)
  plus queue/frame-task drains before sending the state.
- **Client-side race at playback end**: the widget's playback-drain handler
  writes `Idle` locally (ChatManager ~784) at roughly the same time the
  server's `Listening` arrives — last writer wins, so end-of-turn state is
  nondeterministic (`Idle` vs `Listening`).
- **Barge-in**: server sends `interrupt` then `avatar_state: Listening`
  immediately (good, matches Cao et al.), but the widget's interrupt path
  forces `Idle` in between (`stopAllPlayback`, ChatManager ~739) — transient
  flap, and the final state depends on message-handling order.

**Options for a user-speech signal (revises audit item 7):**
1. **Widget-local mic RMS/VAD tap** — audio is already captured in-browser
   for streaming; latency ~1 frame; provider-independent; no protocol change.
2. **Protocol upgrade** — forward provider events: OpenAI `speech_started`/
   `speech_stopped` (clean), Gemini first `input_transcription` delta
   (approximate, ASR-lagged) + thought-text→`Thinking`. Latency = provider
   VAD/ASR + backhaul; provider-dependent.
3. **Both (layered, literature-preferred)**: local signal drives fast gaze/
   nod reactions; server events stay authoritative for turn semantics.

---

# ORIGINAL RESEARCH (Parts I–VII, compiled 2026-06-10/11)
*Parameter source-of-truth cited by the implementation comments ("§" refs).*

## Q1 — Live→neutral transition timing (per channel group)

### Industry findings

| Source | Claim | Confidence |
|---|---|---|
| MetaHuman Audio Driven Animation (UE 5.6) | Returns to neutral via "Blend Out To Zero" + "Blend Out Rate" — described as "a few frames"; no published numeric default. Rate=0 disables blend (holds last frame). | High |
| NVIDIA ACE Unreal `Apply ACE Face Animations` node | Identical idiom (Blend Out To Zero + Blend Out Rate). No documented default; without the flag behaviour is **abrupt pop**. | High |
| NVIDIA A2F-3D production MotionSettings | `upper_face_smoothing=0.001`, `lower_face_smoothing=0.006` (EMA-strength, lower=stiffer, ratio 1:6 upper:lower). `blink_strength=1.0`, `blink_interval=3.0 s`, `lip_close_offset=0.0`. Per-region strength: `upper_face_strength=1.0`, `lower_face_strength=1.25`, `skin_strength=1.0`, `emotion_strength=0.6`. | High |
| NVIDIA A2F-3D paper (arXiv 2508.16401) | Confirms knobs exist; no fade defaults published. Idle motion is **baked into training data** (actor performed idle when silent), not switched on at runtime. | High |
| Unity legacy `Animation.CrossFade` | Default `fadeLength = 0.3 s`. | High |
| Unity Mecanim direct blend trees | Recommended primitive for independent blendshape control; no global fade default. | High |
| Unreal AnimGraph (inertialization) | Recommended blend duration **< 0.4 s**. | Medium |
| Faceware Live Link | Smoothing is a light low-pass on input, not fade-out. | High |

### Key pattern
No vendor publishes per-channel-group fade durations. Industry uses **two independent timescales**:
1. **Always-on smoothing** (EMA / 1€ filter) tighter on upper face than lower (NVIDIA's 1:6 ratio).
2. **Blend-out on stream end** — single global crossfade "over a few frames", uniform across face.

### Recommended numbers for our project

| Channel group | Smoothing τ | Fade-out on TTS-end | Curve |
|---|---|---|---|
| Mouth / jaw | 30–50 ms | **180 ms** | cubic-out |
| Cheek / nose | 80 ms | 250 ms | cubic-out |
| Brow | 120–150 ms | 350 ms | cubic-out |
| Eye-region expression | 100 ms | 300 ms | cubic-out |
| EyeLook (gaze) | widget owns — do not fade | — | — |
| eyeBlink | widget owns — independent | — | — |

Mouth fades fastest because residual jawOpen after silence reads as error; brow lingers slightly to match the 0.5–0.75 s human onset symmetry argument. Cubic-out is safe industry default; critically-damped spring only worth it if state changes mid-fade.

---

## Q2 — Emotional facial expression onset/decay constants

### Literature

| Source | Claim | Confidence |
|---|---|---|
| Schmidt & Cohn 2001 (PMC2843933) | **Spontaneous smile onset 0.50–0.75 s** (mean 0.544 s). **Spontaneous brow raise onset mean 0.738 s.** Deliberate brow raise FASTER (0.489 s) than spontaneous. Offset "very similar" to onset (treated symmetric). | High |
| Pantic & Patras 2005 dynamics survey | Onset:apex:offset ratio for spontaneous expressions ≈ 0.5 : 0.2 : 0.3 s — apex hold is the SHORTEST segment. | High |
| Micro/macro literature | Micro = 40–500 ms; **Macro = 0.5–4 s total**. 500 ms cutoff separates classes. | High |
| Cavé et al. 1996 / follow-ups | Brow raises ↔ rising F0 coupling is **functional, not reflexive**; brow leads/trails pitch by ~100–300 ms. Implication: don't lock brow rigidly to audio RMS. | High |
| Bavelas 2002 gaze window | Speaker→listener gaze window ~100–500 ms during turn. | High |
| Levinson turn-taking | Inter-turn gap median ~200 ms cross-linguistically; <400 ms most of the time. | High |
| 1€ Filter Casiez 2012 | Speed-adaptive low-pass. Two knobs: `min_cutoff` (Hz), `beta` (s). Practitioner-reported facial defaults: `min_cutoff ≈ 1.5–3 Hz`, `beta ≈ 0.01–0.05`. | High |

### Calibration vs our current settings
*(Note: the agent's calc gave τ≈0.12 s by assuming per-frame application; our EMA actually applies every `hold_chunks=3` = 1.5 s, so true τ ≈ 5.2 s wall-clock. Conclusion still stands — we're at the upper edge of macro-expression band.)*
- 1.5 s hold: inside macro-expression band (0.5–4 s) ✓
- τ≈5.2 s effective: SLOWER than human onset (0.5–0.75 s). Conservative anti-flicker, but lags conversational emotion shifts.

### Recommended numbers

| Quantity | Recommended | Rationale |
|---|---|---|
| Emotion onset τ | 250–500 ms | Half of literature mean; conversational AI shouldn't lag |
| Emotion apex hold | **1.0–2.0 s** (our 1.5 s is correct) | Macro-expression band |
| Emotion offset / decay | 400–700 ms | Slightly longer than onset (Pantic) |
| 1€ filter `min_cutoff` | 1.5 Hz face / 2.5 Hz mouth | Mouth needs more bandwidth |
| 1€ filter `beta` | 0.02 | Standard for 30-fps blendshape stream |
| Brow→F0 phase tolerance | ±300 ms | Don't hard-lock brow to audio RMS |
| Turn-transition response budget | ≤ 400 ms | Inside Levinson's inter-turn gap |

---

## Q3 — State machine architectures for layered conversational avatars

### Findings

| Source | Pattern | Confidence |
|---|---|---|
| **SAIBA** (Vilhjálmsson) | Three stages: Intent Planner → Behavior Planner → Behavior Realizer. FML between planners; BML between planner and realizer. **Realizer owns timing/blending** — discrete signals to continuous keyframes. | High |
| **GRETA** (SAIBA impl) | Each BML tag = one modality (head/torso/face/gaze/gesture/speech). Modalities scheduled independently but coordinated on shared timeline. | High |
| **Anguelov "Separation of Concerns" (GameAIPro vol 2 ch 12)** | **Canonical industry pattern**: gameplay FSM decoupled from animation FSM. Gameplay emits *animation orders* (verbs + parameters); animation owns *how* (clip choice, blend duration). | High |
| **Unity Mecanim** | Layered Animator: state machine + blend trees per layer + Avatar Masks for bone subsets. **Direct Blend Tree = recommended primitive for independent blendshape control**. Default `Animation.CrossFade` = 0.3 s. | High |
| **Unreal AnimBP** | StateMachine + AnimMontages + Behavior Trees. Modern recipe: **inertialization** instead of linear crossfade, <0.4 s blends. BT for high-level state; AnimGraph for continuous blends. | High |
| **Soul Machines** ("Human OS" / "Digital Brain") | Autonomous continuous dynamical system (not discrete FSM) driving facial/gaze/gesture. Patents US10504379, US7468728. No numeric constants public. | Medium |
| **UneeQ Synanim** | Closed; idle/listening/talking states acknowledged; no parameter sheet. | Low |
| **NVIDIA ACE / A2F-3D** | MotionSettings is a flat parameter struct attached to the **model**, not per state. Behaviour-tree composition is the Unreal/Unity layer's job. Idle motion is **trained-in**, not switched-on. | High |
| **Inworld Character Engine** | Three layers: Character Brain (LLM + personality/emotion) → Contextual Mesh → Real-Time AI. Emotional state blends "slowly over time" — explicit constants not public. | Medium |

### Canonical pattern (synthesis)
1. **Higher-level discrete state** (Idle/Listening/Responding/Hello/Thinking) lives in a small FSM driven by chat events.
2. **Each state is a parameter pack**, not a clip — it holds tuning constants for always-running sub-systems.
3. **Sub-systems run continuously** at render rate; state change re-reads parameters and smoothly retargets — does not toggle sub-systems on/off.
4. **Transitions interpolated** (not stepped) over 0.2–0.5 s.

### What each state typically holds

| State | Gaze policy | Neck sway | Blink rate | Emotion baseline | Mouth/jaw | Enter fade |
|---|---|---|---|---|---|---|
| **Idle** | wandering, ~30–40% on user | full procedural | 12–20/min | neutral, low intensity | closed | — |
| **Listening** | high mutual ~70–80% (Eyes Alive 2002) | reduced amp, slight forward lean | ~20/min | low-positive (subtle smile) | closed | 250 ms |
| **Responding** | reduced mutual ~40% (gaze aversion while planning) | full procedural + speech-aligned nods | normal | model-driven (emotion_strength~0.6) | model-driven | 300 ms |
| **Thinking** | gaze aversion up & away ≥70% | slow drift | slight ↓ | thoughtful brow inner-up | closed | 250 ms |
| **Hello** | direct mutual ~80% | brief greeting nod | normal | warm positive | smile baseline | 200 ms |

### Recommended numbers

| Knob | Value | Justification |
|---|---|---|
| State-transition crossfade | **300 ms cubic-out** default; 200 ms Hello; 400 ms Idle | Unity default 0.3 s; UE inertialization cap 0.4 s |
| Sub-system parameter blend on state change | linear over 500 ms | Continuous behaviour ramping, not snapping |
| Idle motion on TTS-end | follow MetaHuman/ACE: blend-out-to-zero on model output; sub-systems unaffected | Avoid pop |
| Emotion baseline per state | 1€-filtered target with `min_cutoff=0.5 Hz` (slow) | Baseline should never change abruptly |
| Face channel composition | mouth(model) + brow(model) + blink(widget) + microexpression(widget), additive, clamp [0,1] | Anguelov SoC + Mecanim additive layer |
| Listener response budget | switch ≤ 400 ms after speech-end detection | Levinson median 200 ms |

### Anti-patterns
- Don't fade the whole face in one duration (split mouth vs brow per Q1).
- Don't hot-swap clips in Responding (jarring); use additive overlay on a running base.
- Don't tie emotion 1:1 to audio RMS (Cavé: coupling is functional, not reflexive).
- Don't run FSM at audio-chunk rate; run at render rate with debounced inputs.

---

## Key load-bearing numbers
- **NVIDIA A2F production defaults**: `emotion_strength=0.6`, `upper_face_smoothing=0.001`, `lower_face_smoothing=0.006`, `upper_face_strength=1.0`, `lower_face_strength=1.25`, `blink_interval=3.0 s`.
- **Spontaneous smile onset**: 0.50–0.75 s (Schmidt & Cohn).
- **Spontaneous brow raise onset**: 0.738 s.
- **Macro-expression total duration band**: 0.5–4 s.
- **Unity default crossfade**: 0.3 s. **Unreal inertialization cap**: 0.4 s.
- **Levinson inter-turn gap**: ~200 ms median, <400 ms typical.
- Our **emotion EMA** (`hold_chunks=3` × `α=0.25`) gives τ ≈ 5.2 s wall-clock — at upper edge of macro band, conservative.

## Sources
- https://docs.nvidia.com/ace/audio2face-3d-microservice/1.0/text/param-tuning.html
- https://arxiv.org/html/2508.16401v1
- https://archive.docs.nvidia.com/ace/ace-unreal-plugin/2.5/ace-unreal-plugin-animation.html
- https://dev.epicgames.com/documentation/metahuman/audio-driven-animation
- https://docs.unity3d.com/ScriptReference/Animator.CrossFade.html
- https://docs.unity3d.com/ScriptReference/Animation.CrossFade.html
- https://pmc.ncbi.nlm.nih.gov/articles/PMC2843933/
- https://ibug.doc.ic.ac.uk/media/uploads/documents/PanticPatras-SMCB-2005-FINAL.pdf
- https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2016.01346/full
- https://www.mdpi.com/2076-328X/13/1/52
- https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1460-2466.2002.tb02562.x
- https://pmc.ncbi.nlm.nih.gov/articles/PMC9985971/
- https://gery.casiez.net/1euro/
- http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter12_Separation_of_Concerns_Architecture_for_AI_and_Animation.pdf
- https://arxiv.org/pdf/2503.15504
- https://www.soulmachines.com/meet-the-ai-avatar
- https://docs.inworld.ai/docs/unreal-engine/runtime/templates/character

---

# PART II — Neck / head motion (added 2026-06-11)

## Q4 — Cervical kinematics for procedural head motion

DAZ-style cervical chain `chestUpper → neckLower → neckUpper → head` requires rotation distribution along the chain to look natural. Single-bone "head" rotation looks like a rigid neck dolly.

| Motion plane | Upper cervical (≈ `head` bone, C0–C2) | Mid/lower cervical (`neckUpper`/`neckLower`, C3–C7) | Source |
|---|---|---|---|
| Flexion (nod down) | ~41–45% at C0-C1; ~33% total upper | ~67% mid-lower | Bogduk & Mercer 2000 |
| Extension (nod up) | ~69–71% at C0-C1 | ~30% | PMC 8149863 |
| Axial rotation (yaw) | **>50%** (mostly C1-C2 atlas-axis) | <50% | Bogduk & Mercer 2000 |

**Recommended distribution for small social motion (<10°):**

| Bone | Pitch | Yaw | Roll |
|---|---|---|---|
| `head` | 0.55 | 0.55 | 0.45 |
| `neckUpper` | 0.30 | 0.30 | 0.35 |
| `neckLower` | 0.15 | 0.15 | 0.20 |

Roll is more even than pitch/yaw because lower-cervical contributes more to lateral flexion (per Bogduk).

### Sources
- Bogduk & Mercer 2000 *Biomechanics of the cervical spine* — https://squareonephysio.com.au/wp-content/uploads/2021/08/Bogduk-2000-Biomechanics-Cervical-Spine.pdf
- PMC 8149863 — https://pmc.ncbi.nlm.nih.gov/articles/PMC8149863/
- Functional anatomy and biomechanics of the cervical spine — https://neupsykey.com/functional-anatomy-and-biomechanics-of-the-cervical-spine/

---

## Q5 — Speech-driven head motion (F0 vs RMS)

| Paper | Driver | Result |
|---|---|---|
| Yamamoto / Kuratate 1999 | F0 | r=0.88 English read speech |
| Graf, Cosatto, Strom 2002 *Visual prosody* | F0 + phrase boundary | nods cluster at phrase boundaries & pitch accents |
| Sargin et al. 2008 (HMM) | F0 + energy | prosody-driven head gesture |
| Ben-Youssef 2014 (DNN) | MFCC + F0 | F0 = strongest single feature |
| Audio2Head (Wang IJCAI 2021) | MFCC+FBANK+**pitch**+voiceless → RNN | "low-frequency holistic" head |
| LiveSpeechPortraits (Lu SIGGRAPH-A 2021) | Autoregressive prob. model | "head poses less related to audio than mouth" — they SAMPLE not regress |
| DiffPoseTalk 2024 | Diffusion (many-to-many) | best beat alignment by sampling |
| VividTalk 2023 | Learnable head-pose codebook | non-deterministic |
| **Haag & Shimodaira 2020 CCA-AE** (adversarial counterpoint) | natural-conversation CCA | global audio↔head coupling drops to ≈ **0.19** — strong-correlation numbers above only hold for read corpora |

**Convergent findings:**
- Head motion is low-frequency (<3 Hz dominant)
- F0 (pitch) > RMS energy as driver in read speech
- Head nods cluster at phrase boundaries and stressed syllables (McClave 2000)
- Conversational amplitudes: pitch ±5–15°, yaw ±10–20°
- Modern SOTA SAMPLES not regresses (deterministic regression collapses to mean)

**Verdict on RMS-only drivers:** weakest standard prosodic driver; inverted direction (real heads RISE on pitch peaks, RMS gives indistinct "lean into volume"). We currently use RMS as F0 placeholder.

### Sources
- Audio2Head — https://arxiv.org/abs/2107.09293v1
- LiveSpeechPortraits — https://arxiv.org/abs/2109.10595
- DiffPoseTalk — https://arxiv.org/abs/2310.00434
- VividTalk — https://humanaigc.github.io/vivid-talk/
- McClave 2000 *Linguistic functions of head movements* — https://www.semanticscholar.org/paper/Linguistic-functions-of-head-movements-in-the-of-McClave/edcbe6dc3b8f94eadb8999db8b7ef203ac0d4712
- Haag & Shimodaira 2020 CCA-AE — https://arxiv.org/pdf/2002.01869
- Sargin et al. 2008 — https://www.researchgate.net/publication/224711168_Prosody-Driven_Head-Gesture_Animation
- Ben-Youssef 2014 — https://link.springer.com/article/10.1007/s11042-014-2156-2
- Yehia, Kuratate, Vatikiotis-Bateson 2002 / Kuratate 1999 — https://www.isca-archive.org/eurospeech_1999/kuratate99_eurospeech.html

---

## Q6 — Listening-state head behavior (backchannel cues)

| Cue | Source | Use |
|---|---|---|
| Backchannel after ≥110 ms low-pitch region in speaker's audio | Ward & Tsukahara 2000 | trigger nod 200–400 ms later |
| Pause + low-pitch jointly | Cathcart et al. 2003 | higher-confidence trigger |
| Rule-based predictor still competitive vs ML | Morency et al. 2008 | cheap; ~5 ms |
| Nod = **3 cycles avg**, magnitude declines monotonically per cycle | PMC 12097566 (Mori, Den, Jokinen 2025) | damped-sine model |
| Single nod duration ≈ **0.94 s**, 5-cycle ≈ 1.53 s | same | envelope schedule |
| Nod amplitude **4–8° pitch typical**, 12–15° emphatic | Hadar et al. 1983 | cap defaults |

**Damped sine recipe:** `nod(t) = A · e^(-t/τ) · sin(2π·f·t)`, A=6° pitch, f=1.6 Hz, τ=0.4 s, dur ≈ 1.9 s.

**Periodic nods are robotic.** Use cue-triggered model: detect speaker low-pitch region ≥110 ms, fire nod 200–400 ms after. Floor with slow "still-listening" sway between cues.

### Sources
- Ward & Tsukahara 2000 — https://www.cs.utep.edu/nigel/abstracts/jprag00.html
- Cathcart et al. 2003 — https://aclanthology.org/E03-1069.pdf
- Morency et al. 2008 — https://link.springer.com/chapter/10.1007/978-3-540-85483-8_18
- PMC 12097566 *Structure of nods* — https://pmc.ncbi.nlm.nih.gov/articles/PMC12097566/
- Hadar et al. 1983 — https://journals.sagepub.com/doi/10.1177/002383098302600202 ; full PDF https://www.academia.edu/10013499
- Munhall et al. 2004 *Visual prosody and speech intelligibility* — https://www.queensu.ca/psychology/sites/psycwww/files/uploaded_files/Faculty/Kevin%20Munhall/Munhall_Psyc_Sci.pdf
- Heylen 2006 *Types of nods* — https://www.researchgate.net/publication/220746335
- Frontiers 2023 *Conversational head movements* — https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1183303/full

---

## Q7 — Head motion primitive catalog (full)

Reference table of distinct head-motion primitives during conversation. Each has axis, amplitude range, duration, frequency band, trigger, and source. Used as a procedural primitive menu.

| Name | Axis | Amp (deg) | Duration (s) | Freq (Hz) | Trigger | Source |
|---|---|---|---|---|---|---|
| Stress beat (down-dip) | pitch | small | 0.3–0.5 | 1.9–3.6 (OM band) | stressed syllable / loudness peak | Hadar 1983; McClave 2000 |
| Sharp emphasis stroke | pitch (compound) | 8.0–24.4 mean | <0.3 | 3.7–7.0 (rapid band) | major phonetic stress | Hadar 1983 |
| Affirmative nod (single) | pitch | listener active range −3° flex to +15° ext | mean 0.94 | 0.2–1.1 coherent; "fast" 2.6–6.5 | yes/agreement; turn-yield | Mori/Den/Jokinen 2025 |
| Multi-cycle nod (n=2–5) | pitch | first-cycle amp ↑ with n; linear declination; final ×0.7 | n=5 ≈ 1.53 | as above | strong agreement | Mori et al. 2025 |
| Lateral shake (negation) | yaw | ±30° | 0.5–1.5 | 1.9–3.6 (up to 7) | negation, lexical repair, uncertainty, intensification | McClave 2000 |
| Head tilt (roll) | **roll** | conversational "few degrees"; listener up to ±35–40 | hold 0.5–2+ | non-oscillatory | empathy, listening, uncertainty | Frontiers 2023; McClave 2000 |
| Slow yaw drift / orienting | yaw | up to ±60–80 max; mean amp 13.6–52.6 | seconds | 0.2–1.8 (slow) | locating referents, addressee shift | McClave 2000; Hadar 1983 |
| Phrase-boundary nod | pitch (compound) | medium (OM band) | 0.3–0.7 | 1.9–3.6 | intonational phrase boundaries | Hadar 1983 |
| Postural shift | compound | 36.8–39.5 mean | seconds | 2.2–7.0 envelope | discourse-level topic shift | Hadar 1983 |
| Stillness / freeze | none | 0 | variable | 0 (tremor: 35–45, 12–20, 4–6, 1–3 Hz layered) | major-juncture emphasis | Hadar 1983 |
| Prosody co-motion | pitch + small yaw | continuous, magnitude tracks F0 | continuous | matches F0 envelope | spontaneous; corr ≈ 0.83 sentence | Yehia, Kuratate, Vatikiotis-Bateson 2002; Munhall 2004 |
| Listener backchannel nod | pitch | small | 0.3–0.6 | 2.6–6.5 (fast nod) | speaker's BC-invite cue | Heylen 2006; Frontiers 2023 |
| Frame envelope max | any | up to 170° excursion | — | up to 7 | empirical upper bound | Hadar 1983 |

### Semantic associations (McClave 2000)
- **Side-to-side shake**: inclusivity, intensification, uncertainty, lexical repair
- **Lateral movement**: narrative referent location
- **Head-posture change**: direct/indirect discourse switch

### Procedural recipes (one-liner each)

| Primitive | Recipe |
|---|---|
| Stress beat | pitch impulse on HP-RMS derivative peak, A ≈ 3–6°, decay 200–300 ms |
| Sharp emphasis stroke | pitch damped sine, A ≈ 8–15°, f ≈ 4–6 Hz, τ = 150 ms, gated on loudness peak |
| Single affirmative nod | pitch damped sine, A ≈ 5–10°, 1 cycle, dur ≈ 0.9 s, f ≈ 1.1 Hz |
| Multi-cycle nod (n=2–5) | pitch sine, n cycles, dur ≈ 0.94 + 0.15·(n−1) s; first-cycle amp ↑ with n; linear declination; last cycle × 0.7 |
| Lateral shake (negation) | yaw oscillation, A ≈ 15–30°, f ≈ 2–3 Hz, 2–4 cycles, dur 0.7–1.3 s |
| Head tilt (empathy) | roll step+hold, A ≈ 8–15°, attack 300 ms, hold 0.8–2.0 s, release 400 ms |
| Slow yaw drift | yaw OU / Perlin noise, A ≈ 10–25°, band-limited 0.2–1.0 Hz |
| Phrase-boundary nod | pitch single damped sine at intonational boundary, A ≈ 4–8°, f ≈ 2 Hz, dur 0.4 s |
| Forward lean | pitch step (chin down), A ≈ 5–10°, attack 600 ms, hold ≥ 1 s |
| Backward draw | pitch step + roll bias, A_pitch ≈ 8°, A_roll ≈ 5°, attack 250 ms, hold 0.6–1.0 s |
| Stillness | clamp drivers to 0 for 300–800 ms |
| Prosody co-motion | low-pass(F0) → pitch + small yaw, gain ≈ Munhall sentence-correlation |
| Backchannel nod (listener) | pitch damped sine, A ≈ 4–8°, f ≈ 3–5 Hz, 2–3 cycles, on speaker BC-invite |

### Honest verdict — procedural vs neural

- Speech↔head-motion is **one-to-many**: same utterance produces different head motion across takes. Why GAN/diffusion exist; deterministic regressors mode-collapse to mean.
- Primitive literature exists because primitives are recoverable from signal (Mori 2025 fits structural model across nod lengths 1–19).
- Documented failures of neural-only: regression-to-mean (V16/V17b hit this; CodeTalker CVPR 2023 pathology).
- Documented failures of primitive-only: Yi et al. 2022 argue rule-based head motion cannot capture style/idiosyncrasy — need generative for diversity.
- **Recommended for our stack**: procedural primitive layer (correct *structure* — tilts, junctures, stillness, F0 co-motion) + future neural residual on top. Pejsa & Andrist 2013 *Stylized and Performative Gaze* is strongest precedent.

### Sources
- Yi et al. 2022 *Naturalistic Head Motion* — https://arxiv.org/pdf/2210.14800
- OSM-Net 2023 — https://arxiv.org/pdf/2309.16148
- 3DGS review Springer 2025 — https://link.springer.com/article/10.1007/s00371-025-04232-w
- Pejsa & Andrist 2013 *Stylized and Performative Gaze* — https://www.researchgate.net/publication/235838994
- Mishra & Skantze 2022 *Knowing Where to Look* (gaze planning, NOT head motion taxonomy — clarification note: arxiv.org/abs/2210.02866 is gaze, not head-motion catalog) — https://arxiv.org/abs/2210.02866

---

## Q7b — Speaker vs listener vs idle: motion-energy norms (added 2026-07-06)

Verification pass for the energy-inversion problem (§0.4 obs 2) and the
Listening sway amplitudes.

| Source | Load-bearing claim WITH NUMBERS | URL | Confidence |
|---|---|---|---|
| Hadar et al. 1983/84 (goniometry) | Head moves in **89.9% of frames while speaking** vs **12.8% while listening** (~7:1 movement-time ratio). Amplitude correlates with peak loudness. | https://link.springer.com/article/10.1007/BF00986881 | High |
| Hládek & Seeber 2025 (dyadic mocap) | Listener head motion ≈ nods only; "shaking, tilting, turning almost completely absent during listening". Listener "no movement" 40–50% of time vs speaker ~30%. | https://www.arxiv.org/pdf/2512.03636 | High |
| Active Listener 2024 (IEMOCAP) | Listener head motion is single-digit degrees: MAE roll 3.41°, pitch 4.00°, yaw 6.24°. Human-like response lag <250 ms. | https://arxiv.org/html/2409.20188v1 | High |
| Frontiers 2023 review | Listening nods −3° (flexion) to +15° (extension) pitch; listener–speaker pitch coherence 0.2–1.1 Hz at ~0.6 s lag; fast nods 2.6–6.5 Hz. Roll ROM ±35–40° is ANATOMICAL max, not conversational use. | https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1183303/full | High |
| Yamamoto 2015 + PLOS One 2019 (quiet stance) | Idle human sway: dominant ~0.3 Hz; trunk RMS 3–7 mm → angular ≈ **0.3–0.6°** (derived from geometry, not cited directly). | https://pmc.ncbi.nlm.nih.gov/articles/PMC4393163/ | High (Hz) / Med (deg) |
| Perlin & Goldberg 1996 (Improv) | Idle = coherent noise at octave-spaced frequencies (~1, 2, 4 cyc/s layers); listening behavior re-picks stance/gesture every **3–12 s**. Believability = matching the STATISTICS of motion, not exact trajectories. | https://www.cs.princeton.edu/courses/archive/spr01/cs598b/papers/perlin96.pdf | High |
| Egges, Molet, Magnenat-Thalmann 2004 | Idle = two layers: small continuous posture variation + occasional balance/weight shift. (Exact degrees locked in PCA space — not extractable.) | https://ieeexplore.ieee.org/document/1348342/ | High (classes) |
| Tam et al. 2014 | Seated posture-shift cadence ≈ every **2.5 min** (older adults, static sitting). | https://www.resna.org/sites/default/files/conference/2014/Wheelchair%20Seating/Tam.html | Med |
| Gratch et al. 2007 (Rapport Agent) | Listener policy = prosody-CONTINGENT nods + mirroring; contingency beats frequency (non-contingent feedback → speaker disfluencies 22.2 vs 11.8). No amplitudes published. Bailenson & Yee: 4 s mirror delay effective. | https://people.ict.usc.edu/~nwang/PDF/GratchIVA07-rapport.pdf | High |
| Speech-breathing literature | Rest breathing ~0.17–0.30 Hz; during speech irregular, inhalations at phrase boundaries (NOT periodic). Breathing head-pitch: no published value; reasoned **<1°** (estimate). | https://pmc.ncbi.nlm.nih.gov/articles/PMC11999658/ | High (Hz) / Low (deg) |

**Design law (energy ordering): Speaking > Listening > Idle — and steep.**
~7:1 speaking:listening movement-time; idle ≈ sub-1° at ~0.3 Hz.

**Verdicts on current constants:**
- `LISTEN_SWAY.rollPeakDeg = 8` — no basis; misapplies the Q7 catalog's
  step-and-hold empathy-tilt amplitude (8–15°) to a continuous oscillation.
  Listening should be intermittent pitch nods over a near-still baseline.
- `SPEECH_HEAD.breathePeakDeg = 3` / `LISTEN_SWAY.breathePeakDeg = 1` — too
  large for head pitch; breathing reads in chest/shoulders, <1° at the head,
  phrase-locked (not sinusoidal) during speech.
- `SPEECH_HEAD.yawSlowPeakDeg = 6`, `rollPeakDeg = 5` — inside single-digit
  norms, but running speech-INDEPENDENT is the defect; gate/scale by the
  speech envelope. Head-locked rig inflates visible block angles — treat
  published values as upper bounds.
- Idle target if driven procedurally: ≤1° total, ~0.3 Hz carrier,
  Perlin-style octave noise (not pure sines), posture-shift event every
  ~10 s–2 min.

**Honest negatives:** no published speaker:listener AMPLITUDE ratio in degrees
(only movement-time); no breathing head-pitch degrees; Egges amplitudes not
extractable (PCA space); Gratch publishes contingency/timing, not amplitudes.

---

# PART III — Eye gaze for conversational avatars

## Q8 — Eyes Alive / mutual-gaze ratios

Foundation paper for procedural eye-gaze in conversational avatars.

| Source | Numbers | Notes |
|---|---|---|
| **Eyes Alive (Lee, Marsella, Badler 2002)** | LISTENING ~75% mutual gaze; SPEAKING ~41% mutual; saccade rate driven by Markov state model | Counter-intuitive: speakers look AWAY more (planning) |
| Argyle & Cook 1976 | Conversational gaze: speaker 41% on partner, listener 75% on partner | Eyes Alive numbers come from here |
| Argyle 1990 | Mutual gaze episodes: 50–75% of conversation, typically 1–2 s windows | Bavelas window range |
| Bavelas 2002 | Speaker→listener gaze window 100–500 ms during turn | Q2 already cites |
| Levinson turn-taking | Inter-turn gap ~200 ms median | Q2 already cites |

## Q9 — Saccade pacing (Pejsa)

| Source | Knob | Value |
|---|---|---|
| Pejsa et al. 2013 *Stylized Saccade* | Saccade rate ×2 from default for stylized character "alive" feel | Used in our `Pejsa pacing 2.0×` knob |
| Pejsa & Andrist 2013 *Performative Gaze* | Style parameters: saccade amplitude, duration, asymmetry per character archetype | Parameterised primitive controllers |
| Andrist et al. 2012 *Look like me* | Mutual-gaze policy varies with role / personality | Underlies state-dependent mutual-% in Q3 |

## Q10 — Audio-RMS pause detection for gaze aversion clusters

| Source | Numbers |
|---|---|
| Our deployed gaze config (memory: project_procedural_gaze_deployed.md) | RMS threshold 0.01, 400 ms enter / 100 ms exit; turn-yielding gaze on Responding→Idle |
| Eyes Alive Lee et al. 2002 | Cluster gaze aversions at speech pauses (planning) | Why we lower mutual to 41% during Responding |
| Truong & Heylen *automatic BC timing* | Trigger backchannel ~500 ms after speaker's pause | Adjacent finding |

### Sources for Part III
- Lee, Marsella, Badler 2002 *Eyes Alive* — https://www.cs.cmu.edu/~illah/CLASSDOCS/lee.pdf  (also widely cited as SIGGRAPH 2002)
- Argyle & Cook 1976 *Gaze and Mutual Gaze* (book) — Cambridge UP
- Pejsa, Mutlu, Andrist 2013 *Stylized and Performative Gaze* — https://www.researchgate.net/publication/235838994
- Andrist et al. 2012 *Look Like Me* — https://dl.acm.org/doi/10.1145/2157689.2157810
- Truong, Poppe, Heylen 2010 *Automatic Backchannel Timing* — https://research.utwente.nl/files/6450290/Truong10automatic.pdf

---

## Q8b — Aversion cadence, microsaccade reality, eye-head coupling & VOR (added 2026-07-06)

Verification pass for §0.4 obs 3 ("gaze changes far too frequently").

| Source | Load-bearing claim WITH NUMBERS | URL | Confidence |
|---|---|---|---|
| Andrist, Tan, Gleicher, Mutlu 2014 (HRI '14; human dyad corpus, read in full) | **Cognitive** aversion: 3.54 s ± 1.26, starts −1.32 s ± 0.47 before the cognitive event. **Intimacy** aversion speaking: 1.96 s ± 0.32 every **4.75 s** ± 1.39; listening: 1.14 s ± 0.27 every **7.21 s** ± 1.88. **Floor-management**: 2.30 s ± 1.10; mutual gaze re-engaged **2.41 s ± 0.56 BEFORE** the end of a floor-passing utterance. Aversion magnitudes (head-only robot): vertical ≈20°, horizontal 28°, downward 22°; frequent intimacy aversions scaled **×0.4** because human versions are "more subtle eyes-only motions". | https://pages.cs.wisc.edu/~bilge/pubs/2014/HRI14-Andrist.pdf | High |
| Collewijn & Kowler 2008 | Microsaccades: 2–12 arcmin, median ~4.5 arcmin (**~0.075°**), classical cutoff ~0.25° (15 arcmin); calling 0.5–2° saccades "microsaccades" is "completely out of context". Rate 1–3/s. | https://pmc.ncbi.nlm.nih.gov/articles/PMC3522523/ | High |
| Freedman & Sparks 1997 | Head does NOT contribute to gaze shifts **<20°**; recruitment rises linearly above; eye amplitude saturates ~35°. | https://pubmed.ncbi.nlm.nih.gov/9163361/ | High |
| Pejsa, Andrist, Gleicher, Mutlu 2015 (ACM TiiS, read in full) | OMR 45–55°; head starts 0–100 ms AFTER eyes (visual targets); default velocities eye 150°/s, head 50°/s, trunk 15°/s. **Implements VOR explicitly**: "the eyes automatically move in the opposite direction to compensate and maintain their lock on the target". | https://graphics.cs.wisc.edu/Papers/2015/PAGM15/tiis15-pejsa.pdf | High |
| Argyle & Cook 1976 (via Frontiers 2021 review) | Gaze at partner ~60% overall, ~30% mutual; **71% listening / 41% speaking**; glances ~3 s, mutual episodes ~1 s. | https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.616471/full | Med |
| Mutlu et al. 2009 (Footing) | Robot gaze built from human proportions: turn-yielding gaze read correctly 99% of the time; offered turns taken 97%. | https://pages.cs.wisc.edu/~bilge/pubs/2009/HRI09-Mutlu-Footing.pdf | Med |
| Trutoiu et al. 2011 | Blink DYNAMICS only: fast close / slow open, preferred duration ≈300 ms (9 frames @30 fps), rates 6.6–27/min across actors. Does NOT establish blink–saccade coupling (don't cite it for that). | https://la.disneyresearch.com/wp-content/uploads/Modeling-and-Animating-Eye-Blinks-Paper.pdf | High |
| Gaze-evoked blink physiology (J Neurophysiol 1998; Exp Brain Res 2011) | Blink probability rises with gaze-shift amplitude (~20%+ for large shifts). At our small amplitudes, omitting blink–gaze coupling is defensible. | https://journals.physiology.org/doi/full/10.1152/jn.1998.79.6.2895 | Med |

**Verdicts on current constants:**
- `SACCADE_MICROSACCADE_DEG = 3` is a **mislabel**: 12× the classical
  microsaccade bound; every mutual re-pick is a visible re-fixation saccade.
  True microsaccades (≤0.25°) are below render salience — drop to ≤0.25° or
  remove per-re-pick jitter entirely.
- Re-pick cadence ~2–3 s is **5–10× more frequent** than measured human
  aversion cadence (4.75 s speaking / 7.21 s listening, holds of 1–2 s).
- Eyes-only architecture is CORRECT below ~20° (all our shifts qualify), but
  the missing **VOR term** means procedural head sway drags gaze —
  continuous, speech-locked drift layered on the saccades. Counter-rotate
  the eyeLook channels by the procedural head delta.
- Andrist's ×0.4 eyes-only scaling validates subtle amplitudes for FREQUENT
  aversions — but "frequent" is still ~5–7 s apart.

**Honest negatives:** Masuko & Hoshino parameters unverifiable (no open
source); Peters & Qureshi "97% blink at >33°" is a single indexed mention
(Low); Eyes Alive listening holds (~237.5 frames mutual / ~13 away) from
indexed full text, not opened directly.

---

# PART IV — Audio2Face / Lipsync research lineage

## Q11 — Our V_n model series (canonical index)

See [project_audio2face_experiment_tracker](../.claude/projects/--wsl-localhost-Ubuntu-22-04-home-antonios-research/memory/project_audio2face_experiment_tracker.md) for the authoritative table. Summary:

| V | Architecture | Status |
|---|---|---|
| V8 | Trunk: W2V2-Base ASR-tuned + 169→52 MLP head | Production for months; baseline |
| V9 | V8 + Charsiu phoneme aux head | Live; "very basic lipsync" |
| V10b | V8 trunk + Charsiu phoneme-tuned W2V2 encoder | Best skin_r 0.847 vs V8 0.820 |
| V11pca | V8 conv stack MINUS GRU + NVIDIA emotion concat | GRU not needed |
| V12 | LAM-id2-baked + A2E emotion concat + dual-teacher | Not built |
| V13 | V12 arch + NVIDIA loss recipe (MSE + motion×10 + vol_stab×100) | Built |
| V14b | Variants | Mixed |
| V15 | Per-frame learnable implicit + LossNormalizer + loss_exp curriculum | Duration 49%→105% vs NIM |
| V16 | V15 + peak_loss + vol_stab restored | Beats V13 on mouth_L1 BUT brows static |
| V17/V17b | STFT loss / variance matching | FAILED (mean-collapse not fixed) |
| V19 | V16 + JL Corpus expansion | Less expressive vs V13/V16 |
| V20 | V19 minus calm-class | CONFIRMED hypothesis; deployed |
| V21 | V20 + multi-task emotion head + unfreeze W2V2 last 2 | First trunk-unfreeze |
| V22 | V21 + emo-divergence loss + Kaiming non-zero init | Emo revived |
| V22-es1 | V22 + NIM teacher es=1.0 | Lipsync regressed (this session) |
| V23-MP-hybrid | V22 warm-start + MediaPipe eye teacher + v13 blink mask | Live |
| V24-visemefit | V23-hybrid warm-start + Charsiu→Oculus→ARKit viseme mouth teacher | Trained (this session, 17.6 min) |

## Q12 — NVIDIA A2F-3D production knobs (load-bearing)

Already in Q1. Repeated here for quick lookup:
- `emotion_strength = 0.6` (default)
- `upper_face_smoothing = 0.001`
- `lower_face_smoothing = 0.006` (ratio 1:6 upper:lower)
- `upper_face_strength = 1.0`, `lower_face_strength = 1.25`, `skin_strength = 1.0`
- `blink_strength = 1.0`, `blink_interval = 3.0 s`
- `lip_close_offset = 0.0`

## Q13 — Lipsync evaluation metrics that actually catch perceived quality

From `eval_lipsync_post_v21.py` (this session): Pearson r alone is misleading. We use 9-metric chunked-mode eval:

| Metric | Direction | What it catches |
|---|---|---|
| r_mouth (Pearson r vs LAM) | + | Per-channel correlation (shape) |
| L1_mouth | − | Absolute amplitude error |
| velL1_mouth | − | First-derivative L1 (jitter) |
| jitter_ratio_mouth | =1 | std(diff(pred)) / std(diff(LAM)); ≠1 means wobbles more/less |
| accel_p99_ratio_mouth | =1 | p99(|diff²(pred)|) / p99(|diff²(LAM)|); freaky shape changes |
| boundary_jolt | − | Mean delta at chunk seam / mean interior delta; chunk artifacts |
| rms_xcorr_max | + | Cross-correlation between audio RMS envelope and jawOpen |
| rms_xcorr_lag_ms | 0 | Phase lag between speech and jaw motion |
| silent_mouth_rate | − | Fraction of voiced frames with jawOpen below threshold (gaps) |

V21 composite penalty 10.89 < all V22/V23 (V22-es1 worst at 20.20).

### Audio2face research references (this lineage)
- NVIDIA A2F-3D paper — https://arxiv.org/html/2508.16401v1
- NVIDIA A2F-3D param tuning — https://docs.nvidia.com/ace/audio2face-3d-microservice/1.0/text/param-tuning.html
- A2F-3D Open Model License weights — HuggingFace
- LAM_Audio2Expression — https://github.com/aigc3d/LAM_Audio2Expression
- Charsiu phoneme encoder — https://github.com/lingjzhu/charsiu
- CodeTalker CVPR 2023 (regression-to-mean pathology) — https://doubiiu.github.io/projects/codetalker/
- MakeItTalk — https://github.com/yzhou359/MakeItTalk
- FaceFormer — https://github.com/EvelynFan/FaceFormer
- FaceDiffuser — https://github.com/uuembodiedsocialai/FaceDiffuser
- UniTalker — research

---

# PART V — Visemes & phoneme→ARKit mapping

## Q14 — Open-source viseme tools

For Gemini PCM input (no TTS-emitted viseme timing):

| Tool | License | Input | Output | Real-time | Notes |
|---|---|---|---|---|---|
| **TalkingHead (met4citizen)** | MIT | text or audio | Oculus 15-viseme → ARKit-52 weights | yes | https://github.com/met4citizen/TalkingHead — published Oculus→ARKit map: blender/build-visemes-from-arkit.py |
| **HeadAudio (met4citizen)** | MIT | raw PCM 16 kHz | 15 Oculus visemes | yes (AudioWorklet ~50 ms) | https://github.com/met4citizen/HeadAudio — 14 kB MFCC+Gaussian |
| **Charsiu phoneme W2V2-CTC** | MIT | audio | 42 IPA phoneme posteriors | yes | https://github.com/lingjzhu/charsiu — `charsiu/en_w2v2_fc_10ms` |
| Rhubarb Lip-Sync | MIT | WAV file | 9 mouth shapes | offline batch only | https://github.com/DanielSWolf/rhubarb-lip-sync |
| Oculus LipSync SDK | Permissive | PCM stream | 15 visemes | yes | Unity/Unreal/C only |
| Azure Speech viseme events | Paid | their TTS only | 22 visemes + 55-position blendshape JSON @ 60 fps | yes | TTS-coupled |
| Amazon Polly speech marks | Paid | their TTS only | viseme JSON | yes | TTS-coupled |
| ElevenLabs alignment | Paid | their TTS only | char/word timestamps; no visemes | yes | — |

## Q15 — Phoneme → Oculus 15-viseme grouping (used in V24)

```
P, B, M    → PP          (bilabial lip closure)
F, V       → FF          (labio-dental)
TH, DH     → TH          (interdental)
T, D       → DD          (alveolar stops)
K, G, NG, HH → kk        (velar)
CH, JH, SH, ZH → CH      (palato-alveolar)
S, Z       → SS          (alveolar fricatives)
N, L       → nn          (alveolar nasal + lateral)
R, ER      → RR          (rhotic)
AA, AE, AH, AO, AW, AY → aa  (open vowels)
EH, EY     → E           (front mid)
IH, IY     → I           (high front)
OW, OY     → O           (mid-back rounded)
UH, UW, W, Y → U         (high-back rounded)
[SIL]      → sil
```

## Q16 — Oculus viseme → ARKit-52 weight table (TalkingHead, MIT)

Published at https://github.com/met4citizen/TalkingHead/blob/main/blender/build-visemes-from-arkit.py

```
sil → {}
aa  → jawOpen 0.6
E   → mouthPressL/R 0.8, mouthDimpleL/R 1.0, jawOpen 0.3
I   → mouthPressL/R 0.6, mouthDimpleL/R 0.6, jawOpen 0.2
O   → mouthPucker 1.0, jawForward 0.6, jawOpen 0.2
U   → mouthFunnel 1.0
PP  → mouthRollLower 0.8, mouthRollUpper 0.8, mouthUpperUpL/R 0.3
       (+ our addition: mouthClose 0.6 — Apple ARKit captures show /m/-/p/-/b/ at 0.5-0.7 mouthClose)
FF  → mouthPucker 1.0, mouthShrugUpper 1.0, mouthLowerDownL/R 0.2,
       mouthDimpleL/R 1.0, mouthRollLower 1.0
DD  → mouthPressL/R 0.8, mouthFunnel 0.5, jawOpen 0.2
SS  → mouthPressL/R 0.8, mouthLowerDownL/R 0.5, jawOpen 0.1
TH  → mouthRollUpper 0.6, jawOpen 0.2, tongueOut 0.4
CH  → mouthPucker 0.5, jawOpen 0.2
RR  → mouthPucker 0.5, jawOpen 0.2
kk  → mouthLowerDownL/R 0.4, mouthDimpleL/R 0.3, mouthFunnel 0.3,
       mouthPucker 0.3, jawOpen 0.15
nn  → kk + tongueOut 0.2
```

### Sources for Part V
- TalkingHead Oculus→ARKit map — https://github.com/met4citizen/TalkingHead/blob/main/blender/build-visemes-from-arkit.py
- TalkingHead main — https://github.com/met4citizen/TalkingHead
- HeadAudio — https://github.com/met4citizen/HeadAudio
- HeadTTS (Kokoro+viseme) — https://github.com/met4citizen/HeadTTS
- Azure 22-viseme + 55-position blendshape — https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
- Amazon Polly speech marks — https://docs.aws.amazon.com/polly/latest/dg/using-speechmarks.html
- ElevenLabs alignment — https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- Bear & Harvey 2018 *Phoneme-to-viseme mappings: good/bad/ugly* — https://arxiv.org/pdf/1805.02934
- HRI 2026 dynamic-viseme co-articulation — https://arxiv.org/html/2604.01756v1
- Rhubarb — https://github.com/DanielSWolf/rhubarb-lip-sync
- Oculus 15-viseme reference — https://developers.meta.com/horizon/documentation/unity/audio-ovrlipsync-viseme-reference/
- Apple ARKit blendshape names — https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation
- ARKit blendshape visual reference — https://arkit-face-blendshapes.com/

---

# PART VI — Three.js / framework specifics

## Q17 — Three.js bone composition gotchas

- `bone.quaternion` is **local** rotation relative to parent. Writing into multiple bones in a chain **compounds**, not sums. For total rotation θ across the chain, shares' PRODUCT must equal θ — NOT their sum.
- For small angles <15°, sum ≈ product so it visually works, but bias grows.
- Euler `(pitch, yaw, 0, 'YXZ')` is head-stable composition. Set via `bone.quaternion.setFromEuler(...)`. NOT axis-angle on diagonal `[pitch, yaw, 0]` — that biases head 45° between axes above ~5°.
- Renderer post-multiplies: `bone.quaternion.multiply(delta)` — identity-delta means clip wins. Allows ramping procedural amplitude 0→1 without snapping the bone to bind pose at amp=0.

### Sources
- Three.js Skeleton docs — https://threejs.org/docs/api/en/objects/Skeleton.html
- Three.js DeepWiki — https://deepwiki.com/mrdoob/three.js/5.2-skeletal-animation-and-skinning
- Three.js forum *manual bone rotations* — https://discourse.threejs.org/t/solved-manual-bone-rotations/6249

## Q18 — Vite + monorepo workflow (this project)

- Vite caches `node_modules` with `Cache-Control: max-age=31536000, immutable`. F5 doesn't bypass. `node_modules/.vite/deps` is a separate optimizer cache.
- Rollup terser config in `gsplat-flame-avatar-renderer/rollup.config.js`: `pure_funcs: ['console.log', 'console.debug']` — strips `.log` from .min.js. Use `console.warn` / `console.error` for debug that survives minification.
- Package.json `exports.import` points to `dist/gsplat-flame-avatar-renderer.esm.min.js` (NOT the unminified `.esm.js`).
- For local renderer development: Vite `resolve.alias` to local repo's `dist/gsplat-flame-avatar-renderer.esm.js`, PLUS `resolve.dedupe: ['three', 'jszip']` (otherwise dual three.js instances → Object3D prototype mismatch → `updateMatrixWorld` undefined).

## Q19 — OAC ZIP contract (immutable)

```
<name>/
  offset.ply         — gaussian splat neutral positions
  skin.glb           — FLAME SkinnedMesh + 52 ARKit morph targets; root bone = 'hip'
  animation.glb      — Three.js AnimationClip[]
  vertex_order.json  — splat sort indices
  iris_occlusion.json — optional
```

Extensions must be additive (new optional files) and backward-compatible.

## Q20 — Open-source procedural avatar controllers (reference)

| Project | License | What to lift |
|---|---|---|
| **SmartBody (USC ICT)** | LGPL | Saccade state machine, BML nod/shake controllers, gaze controllers. https://smartbody.ict.usc.edu/ |
| privacypuppet | MIT | Multi-sine idle sway (yaw 0.7+1.3 Hz, pitch 0.5+1.1 Hz, jitter 18+14 Hz, breathe 0.8 Hz, all <1.3° peak) |
| OneEuroFilter | BSD | 1€ filter (Casiez 2012); dozens of language ports. https://github.com/casiez/OneEuroFilter |
| three-vrm | MIT | Bone-vs-blendshape applier pattern |
| amirbar/speech2gesture | research | Reference for audio→motion but head-poor |
| LiveSpeechPortraits (Lu) | research | Autoregressive head-pose; not real-time browser |
| DiffPoseTalk | research | Best published head pose, but diffusion = too slow for browser CPU |

---

# PART VII — Avatar rigging (2026-06-11 night finding)

## Q21 — Head-locked rigging on current Nyx avatars

Skinning weight distribution introspected via `[skinning-top10]` diagnostic in `GaussianSplatRenderer._applyNeckPose`:

```
   1.  94.67%  head
   2.   1.84%  chestUpper
   3.   1.51%  neckLower
   4.   1.12%  neckUpper
   5.   0.43%  lCollar
   6.   0.43%  rCollar
   7+   0.00%  hip, pelvis, lThighBend, ...
```

- 262 bones in skeleton (DAZ-Genesis convention: hip → pelvis → abdomen → chest → neck → head + arms/legs/fingers)
- 20,018 vertices, 4-bone-per-vertex skinning
- Hierarchy correct, bones named correctly
- **The skinning weights are wrong**: body splats weighted to head bone (lazy face-only-rig conversion)

**Implication:** rotating `head` tilts whole upper body as rigid block. Procedural neck control via bone rotation is impossible without rebuilding weights in template_file.fbx.

**Root cause located:** `LAM/assets/sample_oac/template_file.fbx`. The Python pipeline (`generateARKITGLBWithBlender.py`) is correct; it just injects vertex positions into this template and inherits all weights. Fix is to redistribute weights in the template FBX itself; no model retraining needed.

Fix script: `LAM/tools/fix_template_body_weights.py` — Blender headless, K-nearest distance-based weight redistribution. ASCII → binary FBX preconversion needed via `LAM/tools/_ascii_to_binary_fbx.py`.

### Investigation pointers (for next session)
1. First pass redistributed 1,237 / 20,018 verts only — face-vert criterion (head-weight ≥ 0.9) was too aggressive. Iteration needs Y-coordinate-based criterion (verts above `neckUpper` bone head = face).
2. Verify there's not a "working" version of template_file.fbx somewhere in the LAM repo — maybe a face-only version that the body verts should have been merged WITHOUT inheriting head weights.
3. Compare with `lbs_weight_20k.json` (referenced in `generateGLBWithBlender_v2.py`) — old face-only paradigm with EXPLICIT per-vertex weights might give hints about how the body weights should look.

### Sources
- 2026-06-11 session findings — see `.claude/projects/memory/project_avatar_head_locked_rigging.md`
- DAZ Genesis 8 rig reference — https://www.daz3d.com/genesis-8

---

# PART VIII — Turn-taking timing, latency displays, interruption (added 2026-07-06)

## Q22 — Turn-transition timing vs server-authoritative state

| Source | Load-bearing claim WITH NUMBERS | URL | Confidence |
|---|---|---|---|
| Levinson & Torreira 2015 | Modal floor-transfer offset **100–200 ms** (typical gaps 100–300 ms); Switchboard gaps median 205 ms, mean 275 ms; speech-production latency 600–1500 ms → humans plan responses IN OVERLAP with the incoming turn. | https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.00731/full | High |
| Skantze 2021 (review) | Dialogue-system endpoints typically **700–1000 ms** of silence — simultaneously sluggish AND interruption-prone; 200 ms human gaps require PREDICTION, not reaction. | https://www.sciencedirect.com/science/article/pii/S088523082030111X | Med-High (full text paywalled; corroborated) |
| Roberts et al. 2013 | Silence >**600 ms** after a request already reads as unwillingness (n=380; significant degradation 700–800 ms). | https://pubmed.ncbi.nlm.nih.gov/23742442/ | High |
| Holler & Kendrick 2015 | Listener gaze shift to next speaker: modal **−50 ms** (BEFORE turn end); >60% predictive. (Caveat: triadic, unaddressed-participant data.) | https://pmc.ncbi.nlm.nih.gov/articles/PMC4321333/ | High |
| Hadley et al. 2022 | HEAD turns toward the new talker are legitimately slow: mean **+0.81–0.87 s** after speech offset; only ~17% begin before turn end. | https://pmc.ncbi.nlm.nih.gov/articles/PMC9807761/ | High |
| Gravano & Hirschberg 2011 | Turn-yielding cues live in the **final 200–300 ms** of speech; turn-taking-attempt probability rises linearly with cue count (r²=0.969); 80% of overlapping starts begin during the final word. | https://www.utdt.edu/ia/integrantes/agravano/files/gravano_hirschberg_2011.pdf | High |
| Skantze & Irfan 2025 (VAP) | Predictive turn-taking vs silence threshold: median response **1.5 s vs 2.7 s**; perceived interruptions **6.9% vs 16.6%**; predictive preferred p<0.001. | https://arxiv.org/html/2501.08946v1 | High |
| Schlangen & Skantze 2009/11; Skantze & Hjalmarsson 2010 | Incremental principle: react to PARTIAL input, don't gate fast behavior on authoritative pipeline states. Incremental speech onset 0.58 s vs 2.84 s; **50 ms** micro-silence threshold for fast reactions running alongside the slow authoritative endpoint. | https://aclanthology.org/W10-4301/ | High |
| Thórisson (Ymir/Gandalf) | Layered timing budgets: reactive layer **<500 ms** perceive-act cycles (gaze, small gestures); process/dialogue layer 0.5–2 s. | http://alumni.media.mit.edu/~kris/ftp/CompModTurnTak.pdf | High |

**Implication:** eye-gaze reactions at turn boundaries belong in a
WIDGET-LOCAL reactive layer (mic VAD/RMS, 50–200 ms loop); server state is
the slower authoritative corrector. Head/posture may legitimately follow at
+0.8 s — matching human layering. Our current single path (server endpoint +
WS round trip) lands ~1 s+, outside natural listener-reaction windows.

## Q23 — "Thinking" displays during system latency

| Source | Load-bearing claim WITH NUMBERS | URL | Confidence |
|---|---|---|---|
| Shiwa et al. 2008/2009 | User preference peaks at **1 s** response time; robot should react ≤**2 s**; conversational filler moderates long-delay penalties. | https://link.springer.com/article/10.1007/s12369-009-0012-8 | High |
| Andrist et al. 2014 | Correct thinking display = **cognitive gaze aversion, predominantly UPWARD**, 3.54 s, starting ~1.3 s before the response. Well-timed: users waited 608 ms before interrupting vs 329 ms (static or badly timed). **Badly-timed aversions rated WORSE than static gaze** (F=27.97, p<.001). Silent display alone never survived a 2–4 s pause uninterrupted. | https://pages.cs.wisc.edu/~bilge/pubs/2014/HRI14-Andrist.pdf | High |
| Kum & Lee 2022 (VR digital human) | Thinking-gesture fillers reduce perceived latency (all p<0.001); context-MISMATCHED gestures INCREASE it (p=0.004). | https://www.mdpi.com/2076-3417/12/21/10972 | High |
| Glémarec et al. 2025 | Thinking filler beats idle base: response-time appropriateness 5.83 vs 4.04 (p<0.001); preferred by 66.7% vs 8.3% for base idle. | https://arxiv.org/html/2508.11781v1 | High |
| Lee et al. 2025 (LLM IVAs) | Latency >**4 s** degrades experience; natural fillers (head turn, chin touch, "Hmm…") preferred by 64.8%; an artificial spinner did NOT help. | https://arxiv.org/html/2507.22352v1 | High |

**Implication:** Thinking→Responding aliasing runs the WRONG parameter pack
per every source found; a dedicated Thinking display (upward aversion +
optional audio filler) is among the best-attested wins available. Unnecessary
below ~1 s, engage by ~2 s, mandatory above ~4 s.

## Q24 — Barge-in / interruption handling

| Source | Load-bearing claim WITH NUMBERS | URL | Confidence |
|---|---|---|---|
| Cao et al. 2025 | 76% of user interruptions are disruptive; human YIELD = stop speaking + **prolonged MUTUAL GAZE at the interrupter**; HOLD = gaze aversion; overlap in the final **2 s** of planned speech = normal turn-taking, not interruption. | https://arxiv.org/html/2501.01568v1 | High |
| Crook et al. 2010 (Companions ECA) | On barge-in: pause TTS immediately + reactive facial expression, then continue/replan/abort. (Thresholds not published.) | https://www.csc.kth.se/~jboye/publications/aamas2010_interruptions.pdf | High |
| LiveKit 2025 (industry) | Median **216 ms** of audio to classify a barge-in; **51% of naive VAD barge-ins are false positives** (backchannels, coughs) — validate 200–500 ms before killing playback. | https://livekit.com/blog/adaptive-interruption-handling | High (vendor) |

**Implication:** our barge-in path (`stopAllPlayback`→Idle) is wrong twice:
state should go to attentive-mutual-gaze Listening (not Idle), and there is
no validation window.

## Q25 — Dwell time / hysteresis / mid-ramp policy

**Honest negative:** no published dwell/hysteresis constants exist for
social-agent behavior FSMs (games or HRI). Defensible assembled bounds:
- **200–300 ms debounce** on state events (Fry 1975: 210 ms minimum human
  verbal reaction).
- **≥1 s minimum dwell** for display states (shortest meaningful gaze event
  1.14 s, Andrist 2014).
- **500 ms overlap-classification window** before acting on barge-in
  (LiveKit).
- A mid-transition interruption policy MUST exist, whatever the values —
  Unity exposes it as first-class config (Interruption Source):
  https://docs.unity3d.com/Manual/class-Transition.html

---

# PART IX — Transition mechanics & FSM implementation practice (added 2026-07-06)

## Q26 — Inertialization vs crossfade vs fade-through-zero

| Source | Load-bearing claim WITH NUMBERS | URL | Confidence |
|---|---|---|---|
| Bollo, GDC 2018 (primary slides) | Inertialization: at switch, capture pose offset x₀ + velocity v₀ (1 frame of pose history); decay to zero with a quintic; overshoot guard t₁=min(t₁, −5x₀/v₀); worked examples t₁ = 0.3–0.5 s. Mid-transition interruption = **"fire and forget": re-inertialize from the CURRENT OUTPUT**, never stack transitions. Goals: momentum preservation; "no changes when not transitioning". | https://media.gdcvault.com/gdc2018/presentations/bollo_david_inertialization_high_performance.pdf | High |
| Engine defaults | UE state-machine transition default **0.2 s**; Unity Animator default **0.25 s**; Holden "dead blending" cites 0.2 s as a normal blend time. | https://theorangeduck.com/page/dead-blending | Med-High |
| BML 1.0 spec | Block composition = **MERGE (default) / APPEND / REPLACE**; only REPLACE reverts to a neutral state first — the bluntest mode. | https://projects.cs.ru.is/projects/behavior-markup-language/wiki | High |
| SmartBody (AAMAS 2008) | Interrupt = schedule edits on blend weights; base Pose controller of indefinite duration "to which it returns when there are no overriding motions" — endorses identity-delta idle FOR THE NECK layer (not for gaze: gaze persists until redirected). | https://www.ifaamas.org/Proceedings/aamas08/proceedings/pdf/paper/AAMAS08_0779.pdf | High |
| Kopp et al. 2014 (BMLA/AsapRealizer) | `bmla:parametervaluechange` retargets a RUNNING behavior without restart; graceful interruption = retraction, not halt; anticipation constant **0.1 s** (start speaking 0.1 s before predicted turn end). | https://noah.nrw/ubbihs/download/pdf/5127974 | High |

**Verdict on our two-phase ramp:** fade-through-zero has **zero instances**
in the industry/academic record — the only revert-to-neutral precedent is
BML REPLACE, the bluntest composition mode. Correct pattern = single-phase
interpolation of the PARAMETER PACK old→new over 200–300 ms, oscillators
phase-continuous (= Anguelov "merge" / BMLA parametervaluechange); where the
pose delta must jump, inertialize from current output. This also fixes the
doc/code mismatch at `GaussianAvatar.ts` ~581-590 (procedural→procedural
transitions compute the NEW state in both phases: formula snap + neutral dip).
Mitigating nuance: our "zero" is identity-delta over a live baked clip, not a
T-pose — and never summing old+new oscillators incidentally avoids beating.

## Q27 — Runtime clip amplitude scaling (idle-energy fix path)

| Source | Load-bearing claim | URL | Confidence |
|---|---|---|---|
| three.js official example + docs | `AnimationUtils.makeClipAdditive(clip)` (delta vs frame 0) + `setEffectiveWeight(0..1)` = continuous runtime amplitude knob over a base pose; example crossfades base actions at 0.35 s. | https://threejs.org/docs/#api/en/animation/AnimationUtils.makeClipAdditive | High |
| three.js forum | Setting `AdditiveAnimationBlendMode` WITHOUT `makeClipAdditive` → overscaled bones. The delta conversion is mandatory. | https://discourse.threejs.org/t/changing-animationactions-blendmode-to-additiveanimationblendmode-leads-to-incorrect-results/46994 | High |
| UE Layered Animations | Additive delta scaled by a runtime Alpha — same knob, cross-engine precedent. | https://dev.epicgames.com/documentation/unreal-engine/using-layered-animations-in-unreal-engine | Med-High |

**Honest negative:** no published case study of runtime-attenuating an
over-animated idle BASE clip instead of re-authoring ("fix it in data" is the
unwritten norm) — but the machinery is first-class in our renderer's stack.

## Q28 — Phase handling when blending procedural motion

- PFNN (Holden, Komura, Saito 2017): blending misaligned-phase cyclic motion
  "dies out" toward the mean pose → carry ONE phase variable across blends.
  https://www.pure.ed.ac.uk/ws/files/35467734/phasefunction.pdf
- Audio-synthesis practice: never jump amplitude; ramp ≥10–30 ms with
  continuous phase. Our current pattern (phase-continuous oscillators,
  amplitude-only ramps) is CORRECT. If moving to single-phase pack
  interpolation, interpolate frequency slowly or share a phase accumulator to
  avoid transient beating.

## Q29 — Anguelov "orders" pattern (verified from full chapter, 2026-07-06)

Gameplay orders are **fire-and-forget**; SAME-type order → **merge** (update
the running behavior's parameters in place, no restart); DIFFERENT-type →
terminate old via its stop stage + crossfade to new; order spam absorbed by
overwrite ("greatly reduces the visual glitches"). Translation logic
(state→blend weights, input damping) lives in the ANIMATION layer, not
gameplay. Mapping to us: parameter tweaks within a state = merge (no ramp);
state change = ONE blend; `setChatState` spam = overwrite policy — and the
~10 writers need a single arbitration point.
http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter12_Separation_of_Concerns_Architecture_for_AI_and_Animation.pdf

---

# Appendix — Master citation list (alphabetised, deduplicated)

(Build this by running `grep -oE 'https?://\S+' THIS_FILE | sort -u` if you need a flat list later.)

## Update protocol

- This file is the canonical research index for the avatar project. When research is added or revised, update sections in place. Don't append duplicates; merge into existing tables.
- Cite paper URL, year, and load-bearing claim (not just title).
- For empirical claims, include the measured number (degrees, ms, Hz) — not just the trend.
- For losses / model knobs, include the exact value if cited (e.g. NVIDIA's `emotion_strength=0.6`).
- For honest negatives (failures), include them too. The most useful research is "X tried Y, it failed because Z."

**Last comprehensive update:** 2026-07-06 — four-agent literature
verification + expansion (added §0.5 design audit, Q7b, Q8b, Parts VIII–IX).
Previous: 2026-06-11 night session.
- https://yelzkizi.org/metahuman-facial-motion-with-faceware/
