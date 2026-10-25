# Milestone 03 — Real-World Capture Reliability & Accessibility

**Date:** 2026-10-25
**Branch:** `feat/capture-accessibility-reliability`
**Base:** merged PR #14, commit `6e20b4b60374775b43aa40d938306be8ac6f8b02`

## Scope and confirmed findings

- The two historical flaky Chrome cases were `representative DOM fixtures and native toolbar controls` and `compose and annotate separate elements in an editable canvas`.
- Their test activation helper triggered `Runtime.evaluate` through `Target.sendMessageToTarget` but did not await the response. It also could queue a `DOMContentLoaded` callback without confirming the capture button existed or that its click handler ran. A test could begin waiting for selector/editor UI before the popup action had executed. The earlier pass-after-retry evidence was therefore insufficient.
- Full-page capture checked page height and viewport stability, but did not wait for visible lazy images to decode before capturing each strip.
- Stitch bitmaps were closed on normal paths, but not guaranteed to close if canvas creation or `drawImage` failed.
- Canvas output checked total pixel count but not each dimension against a conservative canvas dimension limit.
- Editors exposed annotation pixels through canvas only. An expandable list of named annotation objects was missing.
- The annotation list is deliberately collapsed by default and passes pointer events through except on its summary and item buttons, so it does not permanently obscure or block canvas editing.

## Corrections

- Popup activation now waits for and validates the CDP `Runtime.evaluate` response, reports action failures, and detaches the popup session. Playwright retains failure-only screenshots, traces and video.
- Full-page capture waits for visible pending image decode for at most 1.5 seconds per strip and 12 seconds total. More than 128 visible pending images on one strip fails clearly. Capture continues only after image readiness or aborts and restores the source scroll position.
- Full-page canvas rejects output over 40 MP or 32,767 px in either dimension before allocation. Each frame bitmap closes from `finally`, including draw/allocation error paths.
- Reduced-motion preference chooses instant document scrolling during full-page capture. Preview interface transitions and scroll behavior respect `prefers-reduced-motion`.
- Selector host receives initial keyboard focus, selector Tab navigation wraps through its controls, and preview traps Tab within its dialog and restores prior focus on close.
- Annotation marks now have a native expandable list with named, keyboard-focusable buttons. Selecting a text mark starts in-place editing; selecting a non-text mark exposes its selected state and delete instructions.
- Added local full-page fixtures for sticky/fixed content, IntersectionObserver lazy image, animation, nested scroller, and dynamic document growth.
- Added a real 390 × 480 browser-window check verifying composition footer controls stay within the footer.

## Verification evidence

| Command / scenario | Result |
| --- | --- |
| `npm run check` | **Pass** at last run: strict TypeScript, ESLint, 46 Vitest tests and production build. |
| Focused Milestone 03 Chromium browser cases | **Pass:** keyboard/dialog semantics, 390 × 480 controls, annotation geometry and accessible object name, lazy-image/fixed/nested output pixels, dynamic-height failure/recovery, oversized-output rejection, and tab-switch cancellation/retry. |
| Historical flaky Chrome cases, `--repeat-each=3` | **6/6 passed** across three repetitions of each case on Chrome 155.0.8059.85. The original root cause was test synchronization, not a demonstrated service-worker failure. |
| `npm run test:integration` | **Pass: 48/48** (16 each on Chromium, Chrome and Brave; 3.3 minutes). |
| `npm audit --audit-level=moderate` | **Pass:** zero reported vulnerabilities. |
| Chrome repeat sample | **Pass: 6/6** after the popup acknowledgment change (three repetitions of each historical flaky test). |

Full-page lazy fixture uses headless Playwright Chromium 156.0.8078.4 on macOS, forced device scale factor 2, and browser zoom 125%. Pixel assertions verify all four bands, the decoded magenta lazy image, absence of unseen nested-scroller pixels, repeated fixed-bottom bar behavior, image dimensions and source scroll restoration. The same output dimensions were observed on Chrome and Brave. The dynamic-height fixture confirms failure is actionable, page scroll is restored, and a stable second capture succeeds. Tab-switch cancellation restores scroll and permits a new capture.

Failure artifacts from Playwright are retained under `test-results/` for failures. During development, the first broad run also caught an accessibility assertion querying the annotation buttons while their native details disclosure was collapsed. The test now expands the disclosure before inspecting the accessibility tree; all three engines passed the corrected test. Initial focused failures likewise exposed incorrect pixel samples and a macOS text-selection shortcut mismatch. These test issues were corrected. No claim of zero intermittent failures is made from the finite repeat count.

## Environment and measurements

- Host: macOS, Apple M4 Pro, 24 GiB RAM.
- Browser versions: bundled Playwright Chromium 156.0.8078.4; branded Chrome 155.0.8059.85; Brave 155.0.8059.40 (1.97.56).
- Browser automation is headless, DPR 2, local fixtures. This is not equivalent to native browser-window or other-OS coverage.
- The 40 MP ceiling corresponds to about 160 MB for a single decoded RGBA surface; multiple screenshot, canvas and encoded buffers can raise peak memory substantially. Peak memory at that ceiling was not measured. The cancellation test’s renderer JS heap was about 2.8–3.2 MB before and 3.1–3.3 MB after cancellation across these runs; this is one short, noisy JS-heap sample and excludes canvas/GPU/other-process memory.
- At 125% zoom/DPR2 the full-page fixture exported 2400 × 6565 px (63,024,000 decoded RGBA bytes). PNGs were 366,601–369,646 bytes and total capture-to-editor-download test time was 4.6–7.0 seconds across Chromium, Chrome and Brave (one run per engine). The fixture is highly compressible flat-color content; this does not predict real sites.
- The repeated Chrome cases reported selector-to-preview timings of approximately 130–183 ms in this run environment. The single viewport capture also logged screenshot API time of 39–42 ms and crop/export handoff time of 28–54 ms in the three browsers. These are test samples, not production latency guarantees.

## Accessibility status

Automated Chromium checks cover keyboard-only selector activation/cancel, Tab traversal and wrapping, preview dialog semantics, copy/download accessible names, focus wrapping, and a named annotation object button. Composition footer layout was checked geometrically at 390 × 480. The canvas image itself remains a bitmap and is not represented as a structured image description. No screen reader was run, so assistive-technology compatibility remains unverified.

## Supported behavior and limitations

- Full-page mode captures only the document’s vertical scroll. Nested scrolling content is not stitched.
- Animations and live data are not frozen. Each strip captures whatever state is rendered at that moment; same-height content changes cannot be detected.
- Sticky top-bar suppression is heuristic. Fixed bottom bars, floating widgets and unusual sticky elements can repeat.
- Visible pending images get bounded decode time; an image that does not settle in the wait budget aborts capture. Broken image decode is captured as the browser renders it.
- Browser capture APIs cannot abort an in-flight screenshot. A stale result is discarded after cancellation. Page state and scroll restoration require the source content script to remain alive.
- Peak memory, screen-reader behavior, Windows/Linux, and native-window Chrome/Brave visual behavior remain unverified.

## Release assessment

**PARTIAL.** Build, unit, dependency audit, full three-browser integration matrix and repeated Chrome stability sample pass. A real screen-reader review and peak-memory measurement remain outstanding, and documented limitations for nested scrolling, dynamic same-height content and fixed overlays remain. Keep these visible in release notes.
