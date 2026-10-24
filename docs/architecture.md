# Architecture — Milestone 01

Repository inspection (2026-10-24): empty directory, no inherited repo instructions, code or dependencies. Node 24/npm 11 available; Chrome and Brave installed on macOS. Use TypeScript strict, esbuild, ESLint, Vitest and Playwright. No runtime dependencies or UI framework: this small UI needs DOM APIs only. Lockfile supports npm ci.

## Boundaries

- Action popup: explicit Start and actionable injection errors. No preview tab until selection succeeds.
- Isolated-world injected script: one closed Shadow DOM overlay, a temporary event shield, pointer coalescing, semantic target navigation, bounded lifecycle. The compact Copy button stays beside the pointer; if it would cover a small target, it sits flush beside that target. Preview and Escape cancellation remain alongside it. Hover retargeting resumes outside a narrow boundary around the controls; there is no target-sized pointer lock. Control-originated click events are recognized through the composed event path so keyboard-synthesized clicks cannot be mistaken for page clicks. No target mutations.
- Worker: sender/document/session checks, active window checks before and after capture, one capture in flight globally, OffscreenCanvas PNG cropping, short-lived memory handoff.
- Preview: after selection, the content script displays an extension-owned closed-shadow panel on the same webpage. It renders the cropped PNG to a canvas and provides Copy, PNG download and Close. Direct Copy writes on the selection control's explicit Copy gesture and leaves the webpage in place. No screenshot persistence or tab switch. Closing the preview releases temporary image resources.
- Shared pure geometry/protocol/session functions permit focused testing.

## Coordinates

Use DOM getBoundingClientRect CSS coordinates intersected with viewport and rectangular overflow ancestors. Only non-pinched visual viewports supported; reject visualViewport.scale != 1 or offsets != 0. Desktop browser zoom is supported by measuring screenshot width / measured viewport width and height / measured viewport height independently, never multiplying by devicePixelRatio. Use fractional visualViewport dimensions, adding reserved scrollbar space, to avoid integer innerHeight rounding at 125% zoom. Include scrollbar space in viewport dimensions to match capture bitmap. Round crop edges inward (ceil left/top, floor right/bottom, a 0.0001 bitmap-pixel tolerance for visualViewport float noise), excluding adjacent pixels at fractional boundaries. Reject subpixel-empty and excessive images. Screenshot captures composited pixels, including occlusion, not an isolated element rendering. Bounding boxes cannot precisely represent rotation, clipping paths, fragmented text or rounded corners.

## Synchronization and lifecycle

Hide overlay, await two animation frames, obtain fresh target geometry, then request capture. Recheck geometry after the screenshot and before returning the result. This prevents common scroll/resize races; it cannot freeze arbitrary page animations. Content timeout and Escape clean up locally and invalidate the worker session. No long sleeps for compositor synchronization. Worker invalidates on navigation, tab activation/closure and window focus changes; short expiry and content teardown handle restarts. A capture already in progress cannot be aborted at the browser API; stale results are discarded.

## Permissions and trust

activeTab: temporary user-invoked tab access/capture. scripting: inject selector only on request. clipboardWrite: explicit image copy from the page's isolated content script or the in-page preview. No host, tabs, storage, downloads, network or background content-script permissions. Strict extension CSP, no external code, no HTML interpolation. Website data is only used as text. Top-frame/document-bound messages only; popup endpoint checks exact sender URL. No externally_connectable entry. Overlay isolation protects styling, not against a malicious page removing/hiding its host or intercepting earlier capture listeners.

## Research

Read official references 2026-10-24:

- https://developer.chrome.com/docs/extensions/reference/api/tabs — capture active tab in specified window; max 2 calls/second.
- https://developer.chrome.com/docs/extensions/reference/api/scripting — scripting plus host/activeTab access.
- https://developer.chrome.com/docs/extensions/develop/concepts/activeTab — temporary grant, restricted pages.
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging — JSON messages; return true for asynchronous replies.
- https://developer.chrome.com/docs/webstore/program-policies/policies
- https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements — self-contained executable code.
- https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave — Chromium extension support, not a substitute for testing.

No third-party implementation copied; reference repository not needed. Store readiness requires separate listing/privacy/asset review; this milestone is not publication.

## Native-window regression fixes

The initial headless tests missed two macOS behaviors. While an action popup is open Chrome can report the parent window unfocused; startup now requires the correct active tab but defers window-focus enforcement until screenshot capture. Capturing `blur` on window also observes descendant element blur; cancellation now applies only when event.target is window. Both were reproduced through the native toolbar and a real mouse click, then verified through preview. These are reasons to retain the manual native-window checklist alongside headless tests.

## Visual system

Native utility direction: warm neutral surfaces, graphite text/buttons, restrained spacing, original monochrome crop mark and custom SVG line icons. No emoji or external icon library. PNG manifest icons are required by Chromium; their original vector source and generator are included. The closed-shadow selection control offers pointer-adjacent Copy and Preview plus Escape cancellation; parent/child navigation uses Arrow Up and Arrow Down. The in-page preview uses a single image canvas and slim action row, without dashboard or marketing content. This keeps selection results beside their source and avoids an unnecessary browser context switch, following Apple's guidance that popovers be small and source-anchored and that modal context switches need a clear benefit: https://developer.apple.com/design/human-interface-guidelines/popovers/ and https://developer.apple.com/design/human-interface-guidelines/modality/.
