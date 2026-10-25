# Architecture — Milestone 01

Repository inspection (2026-10-24): empty directory, no inherited repo instructions, code or dependencies. Node 24/npm 11 available; Chrome and Brave installed on macOS. Use TypeScript strict, esbuild, ESLint, Vitest and Playwright. No runtime dependencies or UI framework: this small UI needs DOM APIs only. Lockfile supports npm ci.

## Boundaries

- Action popup: explicit element, custom-area, visible viewport, full-page, and composition capture actions with actionable injection errors. Element and custom-area previews stay in the current tab; full-page and composition results open an extension-owned editor tab.
- Isolated-world injected script: one closed Shadow DOM overlay, a temporary event shield, pointer coalescing, semantic target navigation, bounded lifecycle. Element mode places the compact Copy/Preview controls beside the pointer or selected bounds; custom-area mode draws a viewport rectangle and leaves Copy, Preview, and Cancel controls on the webpage. Both modes cancel without mutating the page, and their preview remains in the current tab. Hover retargeting resumes outside a narrow boundary around element controls; there is no target-sized pointer lock. Control-originated click events are recognized through the composed event path so keyboard-synthesized clicks cannot be mistaken for page clicks. No target mutations.
- Worker: sender/document/session checks, active-tab and original-window identity checks before capture, one capture in flight globally, OffscreenCanvas PNG cropping, short-lived memory handoff. It does not require `chrome.windows.get().focused` to remain true: Chromium may report the parent window unfocused while a toolbar popup is active. A real tab/window switch invalidates the session.
- Full-page pipeline: content script scrolls a vertical page in settled viewport steps, asks the worker for each active-tab screenshot (rate limited below Chromium's documented capture quota), and stitches document strips using bitmap-to-CSS viewport scale measured from each screenshot. It samples visible DOM hit-test paths once at the top for wide fixed/sticky bars and starts later strips below that occlusion, avoiding repeated top navigation while reusing document rows already covered by the previous segment. Other fixed/sticky pixels remain composited and may repeat. The source scroll position is restored before PNG encoding and before opening the editor. Horizontal overflow and changed viewport/document height are rejected.
- Full-page editor handoff: PNG base64 data is sent to the service worker in bounded chunks, stored briefly in extension-origin IndexedDB, then opened through an extension page URL containing only a random session identifier. The editor consumes and deletes the chunks. No `storage` permission or network access is used. An interrupted handoff can leave local temporary data until browser data is cleared; see privacy and limitation docs.
- Composition mode: the selector remains active across repeated captures. Each confirmed visible element is cropped through the normal worker pipeline and held in the content script's bounded in-memory item list (24 objects, 32 megapixel estimated board). The user can undo the last addition or cancel. On Compose, a JSON manifest containing PNG data URLs is transferred in bounded chunks through the same temporary local handoff. The extension editor decodes each image as a separate bitmap and lays them out as distinct canvas objects. Move, aspect-preserving resize, layer order, deletion, undo/redo, zoom, copy and PNG download operate on object geometry; export composites the objects to a white PNG. Source page DOM is never changed.
- Preview: element capture displays an extension-owned closed-shadow panel on the same webpage; full-page and composition captures use extension-owned editor tabs. Both editors reuse the annotation module. In the composition editor, the canvas redraws its editable DOM-image objects as the annotation base, so composition changes and marks stay aligned; PNG output flattens the current objects and marks. Marks and objects remain in memory only for the open editor session. Direct Copy on the selection control remains unannotated and leaves the webpage in place. No page element is modified. Editor close releases image resources.
- Shared pure geometry/protocol/session functions permit focused testing.

## Coordinates

Use DOM getBoundingClientRect CSS coordinates intersected with viewport and rectangular overflow ancestors. Only non-pinched visual viewports supported; reject visualViewport.scale != 1 or offsets != 0. Desktop browser zoom is supported by measuring screenshot width / measured viewport width and height / measured viewport height independently, never multiplying by devicePixelRatio. Use fractional visualViewport dimensions, adding reserved scrollbar space, to avoid integer innerHeight rounding at 125% zoom. Include scrollbar space in viewport dimensions to match capture bitmap. Round crop edges inward (ceil left/top, floor right/bottom, a 0.0001 bitmap-pixel tolerance for visualViewport float noise), excluding adjacent pixels at fractional boundaries. Reject subpixel-empty and excessive images. Full-page strip placement independently derives screenshot scale from bitmap dimensions and viewport CSS dimensions. Screenshot captures composited pixels, including occlusion, not an isolated element rendering. Bounding boxes cannot precisely represent rotation, clipping paths, fragmented text or rounded corners.

## Synchronization and lifecycle

Hide overlay, await two animation frames, obtain fresh target geometry, then request capture. Recheck geometry after the screenshot and before returning the result. This prevents common scroll/resize races; it cannot freeze arbitrary page animations. Content timeout and Escape clean up locally and invalidate the worker session. No long sleeps for compositor synchronization. Worker invalidates on navigation, tab activation/closure and focus changes to another browser window; short expiry and content teardown handle restarts. Element mode cancels on page-window blur, and full-page mode cancels if its page window blurs. A capture already in progress cannot be aborted at the browser API; stale results are discarded.

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

The initial browser checks exposed focus differences between headless Chromium and branded browsers. The worker now keys capture authorization to the live session, active tab and original window identity instead of relying on `windows.get().focused`, which can be false while a toolbar popup is active. A change to another browser window still invalidates the session, and page-window blur cancels selection/full-page work. This behavior is covered by the Chrome and Brave integration runs; native-window manual checks remain useful for platform variations.

## Visual system

Native utility direction: warm neutral surfaces, graphite text/buttons, restrained spacing, original monochrome crop mark and custom SVG line icons. No emoji or external icon library. PNG manifest icons are required by Chromium; their original vector source and generator are included. The closed-shadow selection control offers pointer-adjacent Copy and Preview plus Escape cancellation; parent/child navigation uses Arrow Up and Arrow Down. The in-page preview uses a single image canvas and slim action row, without dashboard or marketing content. This keeps selection results beside their source and avoids an unnecessary browser context switch, following Apple's guidance that popovers be small and source-anchored and that modal context switches need a clear benefit: https://developer.apple.com/design/human-interface-guidelines/popovers/ and https://developer.apple.com/design/human-interface-guidelines/modality/.
