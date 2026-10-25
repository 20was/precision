# Browser test matrix

## Environment

Tests use Playwright 1.64.1 with the production `dist/` build, local fixture pages served on `localhost:4173`, real browser extension contexts, and actual `chrome.tabs.captureVisibleTab`. Screenshot cases use a forced device scale factor of 2. Element-capture image comparisons exercise 100%, 125%, and 150% browser zoom. These runs are headless and are not equivalent to branded-browser GUI coverage on every OS.

| Engine | Version | Status |
| --- | --- | --- |
| Playwright bundled Chromium | 156.0.8078.4 | 10/10 real-extension tests passed, including editor pixel tests, clipboard/download equivalence, visible and full-page capture. |
| Google Chrome | 155.0.8059.85 | 10/10 real-extension tests passed through Playwright's extension-loading CDP support. |
| Brave | 155.0.8059.40 (1.97.56) | 10/10 real-extension tests passed through Playwright's extension-loading CDP support. |

## Behavior matrix

| Case | Status | Evidence / boundary |
| --- | --- | --- |
| Semantic HTML and nested targets | Verified working | Representative local fixture, element capture, and keyboard target navigation. |
| Long vertically scrolling page | Verified working | Four distinct color bands decoded from full-page PNG; output dimensions and scroll restoration checked. |
| Short document | Verified working | Full-page output decodes and has valid dimensions on all three engines. |
| Sticky top header | Verified working, fixture scope | Full-page stitch avoids repeating the fixture header. Unusual/header changes are not covered. |
| Fixed side navigation | Partially supported | The tested sidebar can appear in stitched pixels; only wide top-anchored bars are suppressed between strips. |
| CSS-transformed element | Partially supported | Selection and crop use an axis-aligned bounding rectangle, so rotated corners may include surrounding pixels. |
| `object-fit` image | Verified working | Visible screenshot pixels are captured as composited. |
| Dark/high-contrast page | Verified working, fixture scope | Local dark fixture; native contrast/accessibility audit is separate. |
| Large table | Verified working, fixture scope | DOM targeting and visible crop exercised. |
| Forms and `contenteditable` | Verified working, fixture scope | Selector input shield prevents activation while mode is active; source page is not edited. |
| Embedded iframe | Partially supported | The iframe boundary can be selected; traversal into the frame is not implemented. |
| Open Shadow DOM | Verified working, fixture scope | Hit testing and available parent/child navigation are exercised. |
| Closed Shadow DOM | Unsupported by design | The host is selectable; internal nodes are browser-isolated. |
| Partially off-viewport element | Verified working | Crop is clipped to the viewport bitmap. |
| Rapid pointer movement/cancel | Partially supported | Coalesced pointer selection and repeated Escape cancellation are tested; exhaustive high-rate input is not a deterministic benchmark. |
| Nested scroll containers | Unsupported by design for full-page mode | Full-page mode scrolls the document vertically only. |
| Pinch zoom / displaced visual viewport | Unsupported by design | Full-page mode rejects it; element geometry requires the normal visual viewport. |

## Core workflow results

Final command outcomes and total count are maintained in [test-report.md](test-report.md). The intended run is `npm run test:integration`; screenshot fixtures include actual clipboard readback and PNG decode, not only a successful button handler. The test-only profile grants `clipboard-read`; production asks for write-only workflow capability.

For manual native-window checks, use [README.md](../README.md#manual-smoke-check). Chrome and Brave headless results do not establish screen-reader support, OS clipboard behavior on every platform, or Web Store approval.

## Editor precision additions (2026-10-25)

| Case | Status | Evidence / boundary |
| --- | --- | --- |
| Pen, arrow, rectangle, text, spotlight output | Verified in Playwright Chromium | Real extension UI on a flat-color image; decoded PNG pixel assertions cover continuous/short strokes, arrow orientations, reverse rectangle drag, text create/edit/move/empty commit, spotlight boundary and dimming math, and undo/redo. |
| Composition dense overlap | Verified in Playwright Chromium | Two overlapping opaque fixture captures; topmost selection, move, resize, reorder, remove, annotation stacking, and undo/redo checked against decoded output pixels. |
| Editor zoom and world geometry | Verified in Playwright Chromium | CSS client/image pixel round trips at 0.5x, 1x, 1.5x, and 2x in unit tests; real editor zoom changes independently from browser zoom. Browser zoom 125%, DPR 2. |
| Download and clipboard equivalence | Verified in Playwright Chromium | Downloaded and read-back clipboard PNGs are decoded and their dimensions/RGBA bytes compared. |
| Composition visual snapshot | Verified in Playwright Chromium | Golden for a selected composition at desktop viewport. No automatic snapshot updates. |
| Branded Chrome editor precision cases | Verified | Annotation pixel/history and overlapping composition UI tests passed on Chrome 155.0.8059.85. |
| Brave editor precision cases | Verified | Annotation pixel/history and overlapping composition UI tests passed on Brave 155.0.8059.40. |

Final command: `npm run test:integration` — 30 passed across three real-extension browser projects (10 per project, 2.4 minutes). Browser runs were headless on macOS with forced DPR 2. They do not establish native-window, screen-reader, or other operating-system behavior.

## Milestone 03 additions (2026-10-25)

| Case | Status | Evidence / boundary |
| --- | --- | --- |
| Previously flaky Chrome integration cases | Repeated pass after harness fix | The popup action helper now waits for the `Runtime.evaluate` response and reports missing/failed actions. The two affected tests passed 3 repetitions each in Chrome 155.0.8059.85; this is a finite sample, not a guarantee of zero flake. Failure screenshots, traces and video are retained. |
| Lazy image loaded by IntersectionObserver | Verified, fixture scope | Full-page extension capture waits for visible pending image decode, then samples the expected magenta output pixel. |
| Dynamic page height | Verified failure/recovery | A fixture appends content on scroll; capture reports the layout change, restores initial scroll, and a stable retry succeeds. |
| Animated content | Partially supported | Captures each strip as rendered; no pause/freeze is applied. The fixture verifies capture completes, not that an animation has one consistent frame across all strips. |
| Sticky header and fixed bottom bar | Verified limitation | Sticky top header is not repeated in tested stitch; fixed bottom bar repeats as composited viewport pixels. |
| Nested scrolling region | Unsupported for stitching | Main document is captured; offscreen nested content is absent from the resulting PNG. |
| 125% browser zoom / DPR 2 | Verified, fixture scope | Decoded PNG dimension and flat-color pixel checks pass; effective screenshot scale measured from bitmap dimensions. |
| Oversized full-page output | Verified rejection | Tall fixture is rejected before canvas allocation; original scroll is restored and no editor tab is opened. |
| Full-page cancellation and recovery | Verified in existing Escape test and failure/retry case | Escape exits progress, restores the source scroll and prevents stale editor creation. Dynamic failure can be dismissed and followed by a successful capture. |
| Small/short composition editor window | Verified, all three engines | Real browser window resized to 390 × 480 CSS px; footer buttons remain inside the footer bounds. This does not cover all light/dark combinations or every desktop OS. |
| Keyboard selection and preview | Verified, all three engines | Selection host receives initial focus; Tab cycles selector controls; Escape cancels; preview exposes a dialog and named copy/download controls with focus wrapping. |
| Annotation list semantics | Verified, all three engines | The editable annotation object is exposed as a named button in the accessibility tree after the list is expanded; keyboard editing is exercised. |
| Custom region capture and corner resize | Verified in Chromium 156.0.8078.4, Chrome 155.0.8059.85 and Brave 155.0.8059.40 | Forward/reverse selection, all four corner resize geometries, viewport clamping, bottom-right resize before direct in-page Copy and top-left resize before Preview. Decoded copy and preview pixels are checked at 220 × 180 px with ±1 RGB channel tolerance; Escape cleanup and post-cancel page interaction pass. |
| Near-limit full-page memory | Verified twice in bundled Chromium on macOS | 39.19 MP capture/export completed both times; de-duplicated test browser process-tree peaks were 2.41 and 2.62 GiB. Chrome and Brave are not measured for this case; see `test-report.md`. |
| Screen-reader workflow | Not tested | No assistive technology was run. Automated accessibility tree inspection is not a substitute for VoiceOver/NVDA testing. |

New Milestone 03 scenarios were run through the real extension in all three available headless browser projects. The two historically flaky cases also passed three additional repetitions each on branded Chrome (6/6). See `milestone-03-report.md` for totals and limitations. No Linux or Windows run was performed.

Current Milestone 03 full command: `npm run test:integration` — **48/48 passed** (16 per project, 3.3 minutes). Final stability sample: `npx playwright test --project=chrome --repeat-each=3 --grep 'representative DOM fixtures|compose and annotate separate elements'` — **6/6 passed**.
