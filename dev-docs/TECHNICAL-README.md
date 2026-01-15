This a Manifest V3 browser extension (Chrome + Firefox variants) that injects a content-script “shim” into ChatGPT pages and implements DOM-level list virtualization (“windowing”) for the conversation transcript. 

The intent is to keep the rendered DOM shallow and cheap even when the underlying chat history is huge, because ChatGPT’s UI (deep nested nodes per message) can drive style recalculation, layout, paint, and main‑thread GC pressure into pathological territory as message count grows.

## What does this extension do, exactly?

At a high level it does four things:

1. Installs a content script on `chat.openai.com` and `chatgpt.com` that continuously swaps off-screen message `<article>` elements out of the DOM and replaces them with lightweight spacer `<div>`s of equal height (so scroll geometry remains approximately stable).

2. Tracks minimal state (enabled/debug flags, per-message IDs, stats) in a shared namespace `window.ChatGPTVirtualScroller`, and drives the virtualization on scroll, resize, and DOM mutations.

3. Exposes a tiny stats API over extension message passing so the popup UI can show “total messages vs rendered messages” and a derived “memory saved” percentage.

4. Adds user-facing micro-UI: an “active” badge, a donation “nudge” badge with rate limiting and milestone logic, and debug promo logging.

Below is how that’s realized, module by module, and why the design looks the way it does.

## How does this extension accomplish that?

### The extension architecture (MV3 mechanics, isolation boundaries, and data flow)

Two manifests exist because Chrome MV3 wants a background service worker, while Firefox MV3 support historically differed enough that many extensions ship a Firefox-specific manifest using a background script entry:

* `manifest.json` (Chrome): `"background": { "service_worker": "src/background.js" }`
* `manifest_firefox.json` (Firefox): `"background": { "scripts": ["src/background.js"] }` plus Gecko metadata.

Both manifests inject the same ordered set of content scripts at `document_idle`:

1. `src/constants.js`
2. `src/donation_badge.js`
3. `src/virtualization.js`
4. `src/boot.js`

> [!IMPORTANT]
> That ordering matters: each file is an IIFE that mutates a shared global object.

In the content-script execution environment, “global” means the isolated world global, not the page’s JS global; however, it shares the DOM with the page, which is the key capability being exploited. The **shared object** is:

* `window.ChatGPTVirtualScroller.config` (constants)
* `window.ChatGPTVirtualScroller.state` (mutable runtime state)
* `window.ChatGPTVirtualScroller.log(...)` (debug logger)
* `window.ChatGPTVirtualScroller.DonationBadge` (UI controller)
* `window.ChatGPTVirtualScroller.virtualizer` (public API of virtualization engine)

The background script is intentionally minimal: it just seeds default settings in `chrome.storage.sync` on install.

The popup runs in the extension UI context and communicates with the content script via `chrome.tabs.sendMessage` to request stats. There is no direct page script injection or privileged networking; all behavior is DOM manipulation plus extension storage + messaging.

## Why is this extension structured this way?

MV3 pushes you into three separate runtimes: background, content script, popup. The code keeps all performance-sensitive logic in the content script, where it can observe and mutate the page DOM in real time.

---

### Background initialization: `src/background.js`

On install (`chrome.runtime.onInstalled`), it sets synchronized defaults:

* `enabled: true`
* `debug: false`

This is stored in `chrome.storage.sync`, which is replicated across the user’s browser profile (and potentially across machines, depending on browser/account capabilities). It also logs install/update messages.

> [!IMPORTANT]
> The content script needs deterministic defaults without racing a missing-key read on first run.

---

### Bootstrapping and cross-context API: `src/boot.js`

`boot.js` is the content-script entry point. It binds together state, storage, lifecycle hooks, and the stats RPC. The important behaviors:

1. Settings hydration and live updates
   It reads `chrome.storage.sync.get({ enabled: true, debug: false })` and projects those values into `scroller.state.enabled` and `scroller.state.debug`. It also subscribes to `chrome.storage.onChanged` and updates the in-memory flags when the popup toggles change.

> [!NOTE] 
> **Design note**
> This is a classic “eventual consistency” pattern between persistent extension storage and in-memory hot state. Reads are async; changes are pushed.

2. Debug promo logging
   If `debug` is true, it prints a banner and repeats it every 5 minutes via `setInterval`. It tears that interval down on `beforeunload`.

> [!IMPORTANT]
> > Why: totally non-technical motive (self promotion), but technically it demonstrates the pattern of binding long-lived timers to page lifecycle.

3. Stats message handler (popup ←→ content script)
   It registers `chrome.runtime.onMessage` and responds to `{ type: "getStats" }` by returning:

* `totalMessages`
* `renderedMessages`
* `memorySavedPercent`
* `enabled`

Those come from `virtualizer.getStatsSnapshot()`.

> [!IMPORTANT]
> Why: MV3 popups are ephemeral; they cannot directly inspect the page DOM. Messaging gives you an RPC-like boundary.

4. Virtualizer lifecycle
   `initialize()` attaches:

* `window.addEventListener("resize", virtualizer.handleResize)`
* `virtualizer.bootVirtualizer()`
* `virtualizer.startUrlWatcher()`

> ![IMPORTANT]
> Why: ChatGPT is a single-page app (SPA). There is no reliable “page load per chat” boundary, so the extension must bootstrap once and then detect navigation and DOM churn.

---

### The shared namespace and invariants: `src/constants.js`

This file establishes the global object and centralizes both static config and mutable state.

#### Config highlights

* `ARTICLE_SELECTOR: 'article[data-testid^="conversation-turn-"]'`
  This is a brittle but pragmatic hook into ChatGPT’s DOM: it keys off `data-testid`, which is not a stable API but tends to be more stable than classnames in many React apps.

* `MARGIN_PX: 2000`
  This is the overscan margin. The virtualizer treats the “render window” as viewport ± 2000px so that near-viewport messages remain mounted. In windowed rendering literature, this reduces churn (mount/unmount thrashing) and hides pop-in during fast scroll.

* `SCROLL_THROTTLE_MS: 50`, `MUTATION_DEBOUNCE_MS: 50`, `URL_CHECK_INTERVAL: 1000`
  These are coarse-grained rate controls: throttle scroll-driven work, debounce mutation bursts, poll URL changes.

#### State highlights

* `articleMap: Map<string, HTMLElement>` maps a “virtualId” to the original `<article>` element.
* `nextVirtualId` is a monotonically increasing counter used to tag messages with `dataset.virtualId`.
* `scrollElement`, `cleanupScrollListener`, `observer`, `conversationRoot` track attachments.
* `stats.totalMessages` and `stats.renderedMessages` are the observables exposed to the popup.

#### Invariants the rest of the system assumes

* Every message-like unit in the transcript has a stable `virtualId`.
* For each `virtualId`, the DOM contains either the real `<article>` node or a placeholder spacer `<div data-chatgpt-virtual-spacer="1">`, but not both.
* `articleMap` retains a reference to the original `<article>` even when it is detached from the DOM.

That last invariant is crucial: it makes restoration O(1) by ID (replace spacer with stored article), at the cost of keeping detached DOM nodes strongly reachable (GC roots), which has nuanced memory implications discussed later.

---

### Core algorithm: `src/virtualization.js`

This is the engine. It implements a coarse but effective windowing strategy by rewriting the live DOM.

Conversation root discovery and scroll container selection

Because ChatGPT’s layout can vary (and changes over time), the virtualizer uses heuristics:

* `findConversationRoot()` tries a small set of selectors (`main[class*="conversation" i]`, `[role="main"]`, etc.), falling back to `<body>`.

* `findScrollContainer()` searches upward from the first message `<article>` to find the nearest ancestor that is scrollable by checking computed style `overflowY` and whether `scrollHeight > clientHeight + 10`. If none is found, it falls back to `conversationRoot`, then ultimately to `document.scrollingElement`.

> [!IMPORTANT]
> Why: in modern SPAs the scroll container is often an inner div with `overflow: auto` rather than the window. Virtualization needs viewport-relative coordinates in the correct coordinate system.

#### Viewport metrics

`getViewportMetrics()` returns `{ top, height }` where `top` is either 0 (window scrolling) or the scroll container’s bounding-rect top, and `height` is either `window.innerHeight` or `scrollElement.clientHeight`.

This is used to translate each node’s `getBoundingClientRect()` into coordinates relative to the scroll container viewport, so the “is outside window” predicate is consistent for both scrolling models.

#### The representation switch: Article ↔ Spacer

The fundamental operation is structural substitution:

* `convertArticleToSpacer(articleElement)`:

  * reads `getBoundingClientRect().height` (defaulting to 24px)
  * creates a `<div>` spacer with that height, `opacity: 0`, `pointer-events: none`
  * copies `virtualId` onto the spacer
  * `replaceWith(spacer)` in the DOM
  * stores the detached article in `articleMap`

* `convertSpacerToArticle(spacerElement)`:

  * retrieves original `<article>` from `articleMap` by `virtualId`
  * if it exists and is currently detached, `replaceWith(original)`

This is essentially the simplest external virtualization possible: instead of controlling rendering at the data/model layer (as React Virtualized would), it operates at the DOM layer, maintaining scroll height via fixed-height spacers.

#### The windowing predicate and overscan

`virtualizeNow()` is the core loop:

* Early exits:

  * If `state.enabled` is false, it returns immediately.
  * If `isStreaming()` detects ChatGPT is generating a response (`[data-testid="stop-button"]` exists), it returns immediately.

The streaming guard is defensive: during streaming, the DOM is actively mutating and heights are unstable; swapping nodes at that time risks visible jitter or interfering with ChatGPT’s incremental rendering.

* It queries a combined list of nodes: all real messages and all spacers:

  `${ARTICLE_SELECTOR}, div[data-chatgpt-virtual-spacer="1"]`

* It ensures every `<article>` in that list has a `dataset.virtualId` and is tracked in `articleMap`.

* For every node (article or spacer), it computes:

  * `rect = node.getBoundingClientRect()`
  * `relativeTop = rect.top - viewport.top`
  * `relativeBottom = rect.bottom - viewport.top`

  Then it defines “outside” as:

  * `relativeBottom < -MARGIN_PX` (too far above)
  * OR `relativeTop > viewport.height + MARGIN_PX` (too far below)

* If it’s an `<article>` and outside, convert to spacer.

* If it’s a spacer and inside, convert back to `<article>`.

In more formal terms, if you index messages by i with vertical interval Ii in viewport coordinates, the algorithm maintains:

* Rendered(i) ⇔ Ii intersects [-M, H + M], where M = 2000px and H = viewport height.

Everything else is represented by a spacer of height ĥi captured at eviction time.

#### Scheduling: coalescing, throttling, debouncing

A naive implementation would run this O(n) scan on every scroll event, which would be catastrophic. This code uses a multi-layer rate control scheme:

* Scroll handler is attached with `{ passive: true }`, which prevents the handler from blocking scroll on the main thread.

* `setupScrollTracking()` wraps scroll events in `requestAnimationFrame` to coalesce multiple scroll events per frame. On top of that it enforces a wall-clock throttle (`SCROLL_THROTTLE_MS = 50ms`) so even if the frame rate is high, virtualization doesn’t run more than ~20 Hz.

* `scheduleVirtualization()` adds another coalescing layer: it ensures at most one `virtualizeNow()` execution is pending per frame via `state.requestAnimationScheduled`.

* DOM mutations (new messages, reflows from React) are handled by a `MutationObserver` whose callback is debounced using `setTimeout` (`MUTATION_DEBOUNCE_MS = 50ms`). That collapses mutation storms into a single virtualization pass.

* Resize is debounced by 100ms before triggering virtualization.

This is all textbook “main-thread damage control”: admit that the algorithm is O(n), then limit the frequency aggressively and align execution with the browser’s rendering cadence.

#### Lifecycle: boot, teardown, and SPA navigation

`bootVirtualizer()`:

* refuses to run unless `state.lifecycleStatus === "IDLE"` (a simple two-state lifecycle gate)
* finds conversation root
* attaches the debounced MutationObserver on the root (subtree + childList)
* attaches or updates the scroll listener once messages exist
* triggers an initial virtualization pass

`teardownVirtualizer()`:

* disconnects observer
* removes scroll listener
* clears state fields
* clears `articleMap` and resets `nextVirtualId`
* resets the donation badge state
* removes all spacer divs
* resets “active badge shown” flag

`startUrlWatcher()`:

* polls `window.location.href` every second
* on change: updates `lastUrl`, logs, tears down, boots again

> ![NOTE]
> Why polling instead of something cleaner: content scripts don’t get a direct hook into the app’s router, and SPAs often update `history.pushState` without full reloads. Polling is crude but robust.

#### Stats and the popup-facing API

After each virtualization pass, the code computes:

* `totalMessages`: count of all nodes that are either `<article>` or spacer and have a `virtualId`
* `renderedMessages`: count of nodes that are actual `<article>`

Then it derives:

* `memorySavedPercent = round((1 - rendered/total) * 100)` if total > 0

These are exposed via `getStatsSnapshot()` and then returned to the popup through the boot.js message listener.

> [!CAUTION]
> **Technical nit:** “memorySavedPercent” is really “fraction of messages not currently mounted as full `<article>` DOM subtrees.” Since the extension retains detached `<article>` elements in `articleMap`, JS heap retention still exists. However, detaching nodes usually drops their layout/paint objects and reduces style/layout work, which is where the user-visible wins typically come from. The metric is therefore a proxy for “rendering complexity removed from the live DOM,” not a strict heap memory delta.

#### Activation badge + donation badge coupling

`virtualization.js` also contains a small badge that says “Lag Fixer active” near the prompt input, shown once per chat after the first successful virtualization pass. That’s gated by:

* `hasShownBadgeForCurrentChat` and `state.stats.totalMessages > 0`

It also triggers `DonationBadge.show()` shortly after displaying the active badge.

This is architecturally “side effect coupling”: the virtualization engine is both a performance mechanism and a UI event source. It’s slightly impure, but it keeps user feedback (and the donation prompt) synchronized with actual activation.

---

### Donation nudge mechanics: `src/donation_badge.js`

This file is a self-contained UI controller with three responsibilities for donation begging.

TODO: Remove the donation crap.

---

### Popup UI and the stats RPC: `src/popup.js`

The popup is purely an extension UI controller:

* On load, it reads `chrome.storage.sync` for `enabled` and `debug`, updates two toggles, and updates a status label (“Active” vs “Disabled”).

* When toggles change, it writes back to `chrome.storage.sync`. The content script listens and updates in-memory state.

* It queries the active tab, checks whether it is a ChatGPT URL, and if so sends `{ type: "getStats" }` to the content script.

* It caches the last stats per URL in `chrome.storage.local` so that reopening the popup can render immediately without waiting for the content script round trip, avoiding a “flash of zeros.”

There’s also a small heart animation in the popup support card, purely cosmetic.

---

## Why DOM-level virtualization is the chosen technique (and what tradeoffs show up)?

The core performance problem being targeted is not algorithmic complexity in ChatGPT’s server-side inference; it’s client-side rendering complexity. Long chats can create:

* huge DOM trees (deep nested nodes per message),
* expensive style recalculation (CSS selector matching cost increases with DOM size),
* heavy layout (more boxes, more fragmentation),
* higher paint costs,
* and more main-thread work during scroll.

Virtualization attacks that by reducing the *live* DOM subtree size for offscreen messages to a single div each, instead of a large nested tree.

The design is intentionally “outside-in” and heuristic because the extension cannot instrument ChatGPT’s React component tree. It is essentially performing “structural memoization” of message DOM: store the original node in a map, swap it out of the document when it is irrelevant, and swap it back when needed.

## The main tradeoffs

* Time complexity per pass is still O(n) in the number of messages/spacers because it scans all nodes and calls `getBoundingClientRect()` for each. The constant factor is reduced after virtualization because most nodes become trivial spacers, but it is not asymptotically optimal windowing (which would typically be O(log n) range finding with prefix sums of heights).

* Layout thrash risk: the loop interleaves layout reads (`getBoundingClientRect`) with DOM writes (`replaceWith`). Browsers can be forced into repeated synchronous reflow in such patterns. A more careful implementation would separate read and write phases or at least reuse the first computed height rather than re-reading it in `convertArticleToSpacer`.

* Height approximation: spacer height is captured at eviction time. If message height changes later (images load, code blocks expand, fonts swap), the spacer height becomes stale, and scroll position can drift.

* React ownership hazards: the extension mutates DOM nodes that a React app considers its own. If React later tries to reconcile or re-render those subtrees, it can produce inconsistencies. The MutationObserver + re-query approach is a mitigation, not a proof of correctness.

* “Disable” semantics are incomplete: `state.enabled` short-circuits `virtualizeNow()`, but it does not automatically restore all spacers to articles when disabled. If a user disables while virtualization has already swapped nodes out, scrolling will no longer rehydrate messages. A robust disable would call `teardownVirtualizer()` or explicitly “materialize everything.”

Even with those tradeoffs, the approach can yield a large perceptual win because the dominant cost in many slow chats is maintaining thousands of complex, styled, interactive message subtrees in the live DOM and layout tree.

---

In summary, this extension is an externally attached, heuristically bootstrapped, event-throttled DOM windowing engine for ChatGPT transcripts, augmented with a popup control plane and a couple of user-feedback overlays, built under the constraints and compartmentalization of MV3 extension runtimes.
