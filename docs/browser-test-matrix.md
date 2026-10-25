# Browser test matrix

## Environment

Tests use Playwright 1.64.1 with the production `dist/` build, local fixture pages served on `localhost:4173`, real browser extension contexts, and actual `chrome.tabs.captureVisibleTab`. Screenshot cases use a forced device scale factor of 2. Element-capture image comparisons exercise 100%, 125%, and 150% browser zoom. These runs are headless and are not equivalent to branded-browser GUI coverage on every OS.

| Engine | Version | Status |
| --- | --- | --- |
| Playwright bundled Chromium | 156.0.8078.4 | Real-extension integration suite available; pixel capture, clipboard, download, element selection, viewport capture, composition and full-page paths exercised. |
| Google Chrome | 155.0.8059.85 | Installed and exercised through Playwright's extension-loading CDP support. |
| Brave | 155.0.8059.40 (1.97.56) | Installed and exercised through Playwright's extension-loading CDP support. |

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
