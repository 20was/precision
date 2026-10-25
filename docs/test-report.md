# Production reliability test report

**Run date:** 2026-10-25

**Host:** Apple Silicon macOS

**Build:** 0.1.6 production `dist/` extension

**Browsers:** Playwright Chromium 156.0.8078.4, Google Chrome 155.0.8059.85, Brave 155.0.8059.40 (1.97.56)

The browser tests use isolated profiles, local fixtures, the real toolbar popup and extension service worker, and actual `chrome.tabs.captureVisibleTab` results. Capture is not mocked. Test profiles grant `clipboard-read` only to inspect real clipboard output; that permission is not in the production manifest.

## Commands and outcomes

- `npm run check` — passed: TypeScript strict typecheck, ESLint, 38 Vitest unit tests, production build.
- `npm run test:integration` — passed: 24/24 tests across Chromium, Chrome and Brave (full run completed after the focus-guard fix).
- `npm audit --audit-level=moderate` — passed: zero reported vulnerabilities at audit time.

An earlier full run exposed browser-dependent focus handling; individual retries passed, so that result was not treated as evidence of a fix. The worker's additional `windows.get().focused` requirement was removed while retaining live-session, active-tab, original-window, navigation and focus-change checks. After this change, the representative Brave fixture passed and the complete 24-test cross-browser run passed.

## Screenshot and interaction evidence

- Element capture: actual downloaded and clipboard PNG pixels were decoded and compared at 100%, 125% and 150% browser zoom with forced device scale factor 2. Fixture dimensions/colors matched. Chrome, Brave and Chromium covered semantic and deeply nested HTML, scroll/sticky/fixed content, clipping, transforms, `object-fit`, dark content, tables, form/contenteditable, iframe boundary, open Shadow DOM, partially offscreen targets, repeated activation and navigation cleanup.
- Full-page: long colored bands, sticky header, fixed sidebar, transformed content, short page, 125% zoom and scale factor 2. Tests decode the output PNG and verify dimensions/band colors, scroll restoration, cancellation cleanup, and no editor opening after cancellation. The final fractional-scroll remainder fix prevents a 99%-complete loop from stalling.
- Composition: repeated capture of two elements; resize, keyboard move, undo/redo; rectangle annotation and text creation/editing; downloaded PNG checks; actual clipboard PNG decoded and compared with download pixel-for-pixel. Existing integration suite ran these flows in all three engines.
- Visible viewport: real API screenshot returned and opened in the editor. Output dimensions are read from the bitmap, not inferred by multiplying CSS dimensions by DPR. Headless Brave returned a bitmap 9 CSS pixels shorter than `innerHeight`; this is recorded as environment/browser variation.
- Cancellation: Escape, repeated sessions, page navigation, full-page interruption and editor close cleanup are covered by integration cases.

The app content script uses animation-frame synchronization and post-capture geometry validation. Fixture screenshots do not freeze arbitrary site animations or prove pixel-exact behavior for every layout.

## Performance observations

Observed under automated fixture load (not product-wide guarantees):

- `captureVisibleTab`: approximately 44–95 ms.
- Crop/export/handoff: approximately 29–334 ms, with test-host scheduling jitter.
- Ten synthetic pointer steps plus two animation frames: approximately 177–209 ms end-to-end through Playwright.
- After five cancellation cycles and forced collection, page-plus-test heap was approximately 1.54→2.30 MB (Chromium), 1.54→2.29 MB (Chrome), and 1.90→2.54 MB (Brave). This is not extension-isolated memory profiling.
- Full-page fixture action-to-editor time was approximately 3.2–3.7 seconds, depending on capture rate limiting and zoom.
- `dist/` artifacts measured after build total approximately 107,666 bytes: content.js 47,694; editor.js 47,421; worker.js 12,932; popup.js 875; popup.html 2,332; ui.css 5,132; manifest.json 1,088; icons 192 bytes.

Near-limit memory follow-up (macOS 26.6.2, Apple M4 Pro, 24 GB RAM, Playwright Chromium 156.0.8078.4, isolated extension profile): two successful 39.19 MP captures (2,400 × 16,328 px; 156,748,800 decoded RGBA bytes; approximately 844 KB PNG) took 9.5 s and 18.0 s from activation through export. macOS `footprint` sampled the test browser process tree every 0.2 s for 30 seconds (151 samples per run), with peaks of 2,471.3 MiB and 2,683.1 MiB. This is total browser-process-tree footprint, including GPU and renderer helpers, not extension-only memory. The large peak is a release risk; branded Chrome and Brave were not tested for this case, and memory behavior on lower-memory hardware is unknown.

Custom region capture and corner resizing were exercised through the unpacked extension in Playwright Chromium 156.0.8078.4, Chrome 155.0.8059.85, and Brave 155.0.8059.40. The flow covers forward/reverse rectangle drags, bottom-right and top-left corner resizing, same-page Copy and Preview, decoded 220 × 180 PNG pixel content, Escape cleanup, no tab opened, and normal page interaction afterward. Pure geometry tests cover all four corners, fixed opposite corners, viewport clamping, and prevention of crossing the anchor. Flat-color RGB checks allow a maximum per-channel difference of one because Brave's screenshot surface produced that browser-specific conversion delta; alpha is exact.

Existing cancellation JS-heap numbers include the fixture page and harness and should not be interpreted as extension-only memory. Long repeated-session memory trends were not measured.

## Not covered

Screen-reader testing, multi-monitor transitions, non-macOS systems, minimum Chrome 120, full-page nested scroll containers, lazy-load stabilization on arbitrary sites, near-limit images, every annotation tool's pixel output, dense overlapping composition selection, and every editor operation at multiple zooms still need verification. See [browser-test-matrix.md](browser-test-matrix.md), [known-limitations.md](known-limitations.md), and [release-readiness.md](release-readiness.md).
