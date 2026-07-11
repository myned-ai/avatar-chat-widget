// Avatar state arbiter — the single admission point for chat-state writes.
//
// Live tracing showed uncoordinated writers producing five state transitions
// within 145 ms of a barge-in (local teardown, the server's interrupt
// signal, a stale server turn-start, and a per-frame poll all writing
// concurrently), each restarting the avatar's transition animations. The
// arbiter collapses such bursts into a single transition.
//
// Source classes:
//   server    — server avatar_state events; authoritative
//   lifecycle — connection boundaries (connect / minimize / expand)
//   local     — inferred from playback machinery (audio-start, sync-frame-
//               adapt, raf-poll-*)
//   fallback  — playback-drained: held FALLBACK_MS and dropped if any server
//               write is admitted meanwhile (measured: the server's
//               end-of-turn Listening trails the local drain by 0.6–1.0 s)
//   cleanup   — teardown paths (stop-all-playback, text-send,
//               mic-record-start): never write state. Late scheduled stops
//               were observed stomping valid states, and forcing Idle on
//               mic/text activity contradicts turn semantics.
//
// Dwell rule: at least DWELL_MS between applied transitions (tracing showed
// no legitimate sub-300 ms transition). Requests inside the window are
// deferred; at expiry the latest highest-precedence deferred request is
// applied, which also absorbs stale server turn-starts that arrive within
// the window and are superseded before it closes.

import { logger } from '../utils/Logger';
import type { ChatState } from '../types/common';

const log = logger.scope('StateArbiter');

const DWELL_MS = 300;
// The drain-fallback exists only for abnormal turn ends (the server's
// end-of-turn Listening normally arrives well under a second after the local
// drain). The window must comfortably exceed mid-answer pauses between
// speech segments, or the avatar visibly drops to Idle inside an answer.
const FALLBACK_MS = 5000;

type SourceClass = 'server' | 'lifecycle' | 'local' | 'fallback' | 'cleanup';

const PRECEDENCE: Record<SourceClass, number> = {
  server: 3,
  lifecycle: 2,
  local: 1,
  fallback: 0,
  cleanup: -1,
};

function classify(source: string): SourceClass {
  if (source.startsWith('server:')) return 'server';
  if (source === 'ws-connect' || source === 'expand-reconnect' || source === 'minimize') return 'lifecycle';
  if (source === 'playback-drained') return 'fallback';
  if (source === 'stop-all-playback' || source === 'text-send' || source === 'mic-record-start') return 'cleanup';
  return 'local';
}

interface PendingRequest {
  state: ChatState;
  source: string;
  cls: SourceClass;
}

export class AvatarStateArbiter {
  private current: ChatState = 'Idle';
  private lastTransitionMs = -Infinity;
  private pending: PendingRequest | null = null;
  private pendingTimer: number | null = null;
  private fallbackTimer: number | null = null;
  private disposed = false;

  constructor(
    private readonly sink: (state: ChatState, source: string) => void,
  ) {}

  /** Route ALL state writes through here instead of avatar.setChatState. */
  public request(state: ChatState, source: string): void {
    if (this.disposed) return;
    const cls = classify(source);

    if (cls === 'cleanup') {
      log.debug(`[arbiter] DROP (cleanup) ${source}: → ${state}`);
      return;
    }

    if (cls === 'fallback') {
      // Arm (or re-arm) the fallback; it fires only if nothing authoritative
      // lands within FALLBACK_MS.
      this.clearFallback();
      log.debug(`[arbiter] FALLBACK armed ${source}: → ${state} in ${FALLBACK_MS}ms`);
      this.fallbackTimer = window.setTimeout(() => {
        this.fallbackTimer = null;
        log.debug(`[arbiter] FALLBACK fired ${source}: → ${state}`);
        this.admit({ state, source, cls });
      }, FALLBACK_MS);
      return;
    }

    this.admit({ state, source, cls });
  }

  public getState(): ChatState {
    return this.current;
  }

  public dispose(): void {
    this.disposed = true;
    this.clearFallback();
    if (this.pendingTimer !== null) {
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pending = null;
  }

  private admit(req: PendingRequest): void {
    const now = performance.now();
    const sinceLast = now - this.lastTransitionMs;

    // A server write cancels a pending drain-fallback: the authoritative
    // signal arrived, the local guess is obsolete.
    if (req.cls === 'server') this.clearFallback();

    if (sinceLast >= DWELL_MS && this.pending === null) {
      this.apply(req);
      return;
    }

    // Inside the dwell window (or a deferral already queued): keep the
    // highest-precedence, latest request.
    if (this.pending === null || PRECEDENCE[req.cls] >= PRECEDENCE[this.pending.cls]) {
      log.debug(
        `[arbiter] DEFER ${req.source}: → ${req.state}`
        + (this.pending ? ` (supersedes ${this.pending.source} → ${this.pending.state})` : '')
        + ` | ${Math.max(0, Math.round(DWELL_MS - sinceLast))}ms left in dwell`
      );
      this.pending = req;
    } else {
      log.debug(`[arbiter] DROP (precedence) ${req.source}: → ${req.state} | pending ${this.pending.source} wins`);
    }

    if (this.pendingTimer === null) {
      const waitMs = Math.max(0, DWELL_MS - sinceLast);
      this.pendingTimer = window.setTimeout(() => {
        this.pendingTimer = null;
        const p = this.pending;
        this.pending = null;
        if (p) this.apply(p);
      }, waitMs);
    }
  }

  private apply(req: PendingRequest): void {
    if (req.state === this.current) {
      // No visible transition — don't reset the dwell clock.
      return;
    }
    // Any real transition supersedes a pending drain-fallback (e.g. a new
    // turn starting inside the fallback window must not be stomped to Idle).
    if (req.cls !== 'fallback') this.clearFallback();
    this.current = req.state;
    this.lastTransitionMs = performance.now();
    this.sink(req.state, req.source);
  }

  private clearFallback(): void {
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
      log.debug('[arbiter] FALLBACK cancelled');
    }
  }
}
