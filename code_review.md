Here is the Final Code Review Report for the `refactor/sqa-code-review-2026` branch.

**Reviewer:** Principal Software Architect
**Target:** `myned-ai/avatar-chat-widget`
**Verdict:** **Production-Ready With Caveats**

### 1. Executive Summary
The codebase demonstrates a high level of maturity in system design, particularly regarding the handling of real-time audio streams and 3D rendering isolation. The `LazyAvatar` implementation and `BlendshapeBuffer` object pooling are standout features that show a concern for performance.

**However, the widget is not yet ready for general NPM/CDN distribution.** It contains specific "time-bombs" related to asset resolution (hardcoded relative paths), integration security (CSP violations), and memory management (event listener leaks) that will cause failures when embedded in third-party environments or Single Page Applications (SPAs).

---

### 2. Architecture & Separation of Concerns

**State Management**
*   **Distributed State (Risk):** State is fragmented across `ChatManager`, `TranscriptManager`, `GaussianAvatar`, and `DrawerController`. There is no single source of truth. While `ChatManager` acts as the primary orchestrator (Mediator pattern), the sync between the UI state (managed by `AvatarChatElement`) and the logic state (managed by `ChatManager`) relies heavily on callbacks and direct method calls.
*   **Lifecycle Management:** The `AudioContextManager` singleton is a good pattern for resource-heavy browser APIs. However, `ChatManager` holds references to DOM elements and multiple sub-services. Ensuring `dispose()` is called on every sub-service is critical to prevent memory leaks, especially with the `MutationObserver` in `ChatManager`.

**Modularity**
*   **Avatar Abstraction (Good):** The `IAvatarController` interface and `LazyAvatar` implementation are excellent. This effectively decouples the heavy 3D rendering logic from the chat business logic.
*   **Logic/UI Coupling (Risk):** The "Managers" (`TranscriptManager`, `SubtitleController`) are directly manipulating DOM elements (`appendChild`, `classList`). Ideally, these managers would emit state changes, and the `AvatarChatElement` (Web Component) would handle the rendering. Currently, business logic is tightly coupled to specific HTML structure/IDs within the Shadow DOM.

**Isolation**
*   **Shadow DOM (Good):** The widget correctly uses `attachShadow({ mode: 'open' })` to encapsulate styles and markup.
*   **Z-Index Wars:** The widget uses `z-index: 999999`. While common for widgets, this is a brute-force approach that can conflict with other overlays on the host site.

---

### 3. Performance & Resource Review

**Rendering & 3D Avatar**
*   **Optimization (Good):** `src/services/BlendshapeBuffer.ts` correctly uses an `ObjectPool` to manage frame data. This significantly reduces Garbage Collection (GC) pressure during the animation loop.
*   **Bottleneck (Eager Loading):** In `src/widget.ts`, the `initializeAvatar` method initializes `LazyAvatar` with `{ preload: true }`. Since `widget.init()` calls `mount()` immediately, the heavy 3D renderer and the avatar asset (`nyx.zip`) begin downloading as soon as the host page loads, even if the widget is collapsed. This negatively impacts the host site's Core Web Vitals.

**Memory Leaks**
*   **Risk:** `src/managers/ChatManager.ts`. The `setupEventListeners` method adds anonymous arrow functions as event listeners to `this.chatInput` and `this.micBtn`. The `dispose()` method cleans up services but does not remove these DOM event listeners. If the widget is unmounted and remounted (common in SPAs like React/Vue), duplicate listeners will accumulate.
*   **Risk:** `src/services/AudioContextManager.ts`. The `setupResumeListener` adds listeners to `document`. If the user never interacts with the page and the widget is destroyed programmatically, these document-level listeners remain attached.

**Network & Resilience**
*   **Resilience (Good):** `src/services/SocketService.ts` implements robust reconnection logic with exponential backoff.
*   **Circuit Breaker (Good):** `src/utils/ErrorBoundary.ts` implements a time-windowed circuit breaker to prevent the widget from hammering the server during failure loops.

---

### 4. Security & Resilience Audit

**Critical: Content Security Policy (CSP) Violation**
*   **Location:** `src/widget/styles.ts`
*   **Issue:** ` @import url('https://fonts.googleapis.com/css2?family=Inter...');`
*   **Impact:** When embedded on strict host sites (banking, enterprise) that define a `Content-Security-Policy`, this request will be blocked, rendering the widget unstyled or font-less.
*   **Remediation:** Do not use `@import`. Bundle fonts or use system fonts (`-apple-system`).

**High: Broken UI on Load Failure**
*   **Location:** `src/avatar/LazyAvatar.ts`
*   **Issue:** If `nyx.zip` fails to load (404/Network Error), `LazyAvatar` catches the error but `_showPlaceholder` is never reversed.
*   **Impact:** The user sees a permanent spinning loader.
*   **Remediation:** In `onError`, explicitly remove the placeholder and force the `DrawerController` into "Text Only" mode.

**Secure Input Handling (Good)**
*   User input is handled via `textContent` assignments in `TranscriptManager.ts`, effectively neutralizing XSS attacks.

---

### 5. Type Safety & Code Quality (From Loop 1)

**A. Type Safety Violations**
*   **Abuse of Non-Null Assertions (`!`):** Used frequently in `src/widget.ts` and `ChatManager.ts` (e.g., `this.shadow.getElementById('micBtn')!`). If the HTML template changes, this causes fatal runtime errors.
*   **Structural Casting:** `src/avatar/LazyAvatar.ts` casts the dynamic import via `as { start?: ... }` instead of enforcing `IAvatarController`.

**B. Hardcoding Issues**
*   **Asset Paths:** `src/widget.ts` hardcodes `avatarUrl: './asset/nyx.zip'`. This is a generic relative path that will break on any 3rd party domain. It must use the absolute `assetsBaseUrl` derived from the script tag.
*   **Layout Magic Numbers:** `DrawerController.ts` defines heights (56, 90) that are duplicated in `styles.ts`.

**C. Comments**
*   **Missing Context:** `SyncPlayback.ts` uses magic numbers for time offsets (`cutoffTime = currentTime - 1.0`) without explanation.

**Quick Wins (<10 mins)**
| File | Severity | Action |
| :--- | :--- | :--- |
| `src/widget.ts` | High | Replace `!` assertions with `if (!el) return/throw`. |
| `src/avatar/LazyAvatar.ts` | Medium | Cast `this._avatar` to `IAvatarController` once on load. |
| `src/widget/DrawerController.ts` | Low | Move layout constants to a shared `constants/layout.ts`. |
| `src/services/AudioInput.ts` | Low | Read sample rate from `CONFIG` instead of hardcoded const. |

---

### 6. Top 3 Critical Issues

1.  **Asset Resolution (Relative Paths):** The hardcoded `./asset/nyx.zip` in `widget.ts` is the biggest blocker. It guarantees 404s when the widget is deployed anywhere other than the root of the serving domain.
2.  **CSP Violation (`@import`):** This makes the widget unusable for enterprise clients with strict security policies.
3.  **Memory Leaks (Event Listeners):** The failure to remove event listeners in `ChatManager` and `AudioContextManager` creates memory leaks that will degrade host application performance over time.

---

### 7. Refactoring Roadmap

1.  **Immediate Fixes (Deployment Blockers):**
    *   Implement dynamic base URL detection for all assets (`nyx.zip`, worklets).
    *   Remove Google Fonts `@import` and implement a system-font fallback stack.
    *   Fix the `wss://` regex validation.

2.  **Stability & Safety:**
    *   Refactor `!` assertions to strict null checks with Error logging.
    *   Implement cleanup of anonymous event listeners in `dispose()` methods.
    *   Implement the UI fallback for Avatar load failures.

3.  **Performance:**
    *   Change `preload` default to `false`. Trigger avatar load only on `expand()`.
    *   Implement CSS Variables for shared layout constants between TS and CSS.

---

### 8. Code Snippet Examples

**Issue:** Loose Structural Typing in `LazyAvatar.ts`.
**Context:** We defined an interface `IAvatarController`, but we are ignoring it when loading the dynamic module, hoping the object shape matches.

**Current Code (Fragile):**
```typescript
// src/avatar/LazyAvatar.ts
const { GaussianAvatar } = await import('./GaussianAvatar');
this._avatar = new GaussianAvatar(this._container, this._assetsPath);

// Casting to an ad-hoc shape. If GaussianAvatar changes 'start' to 'init', TS won't catch it here.
if ('start' in this._avatar && typeof (this._avatar as { start?: () => Promise<void> }).start === 'function') {
    await (this._avatar as { start: () => Promise<void> }).start();
}
```

**Guru Recommended (Robust):**
```typescript
// src/avatar/LazyAvatar.ts
import type { IAvatarController } from '../types/avatar';

// Define the constructor type for the dynamic import
type GaussianAvatarConstructor = new (c: HTMLDivElement, p: string) => IAvatarController;

const module = await import('./GaussianAvatar');
const GaussianAvatarClass = module.GaussianAvatar as GaussianAvatarConstructor;

// TS now ensures this._avatar strictly adheres to IAvatarController
this._avatar = new GaussianAvatarClass(this._container, this._assetsPath);

// No "in" checks or structural casts needed. 
// If start() is missing from IAvatarController, TS errors here.
if (this._avatar.start) {
    await this._avatar.start();
}
```