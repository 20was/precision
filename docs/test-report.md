# Milestone 01 test report

Run on 2026-10-25 on Apple Silicon macOS. Tests used a local HTTP fixture server, isolated browser profiles, the production `dist` build, the actual toolbar popup and `chrome.tabs.captureVisibleTab`. Screenshot capture was not mocked. Only test profiles received `clipboard-read`; production permissions remain unchanged.

## Automated outcomes

- `npm run check`: pass — strict TypeScript, ESLint, 38 Vitest tests and production build.
- `npm run test:integration`: pass — 9 tests across Chromium 156.0.8078.4, Chrome 155.0.8059.85 and Brave 155.0.8059.40 (1.97.56).
- Pixel capture, Clipboard API readback and downloaded PNG were verified at 100%, 125% and 150% browser zoom in all three browser families.
- Build output: content 18,320 bytes; worker 5,962; popup 643; CSS 4,993; popup HTML 1,331; manifest 1,080; PNG icons 192 bytes. The former standalone preview page is no longer shipped.

## Pixel and interaction evidence

A fixed fixture rectangle at CSS x=40, y=140, width=240 and height=160 used solid RGB (32,128,192). With the test browser configured for device scale factor 2, exports at 100%, 125% and 150% measured 480×320, 600×400 and 720×480. Clipboard and downloaded PNG data were decoded and every pixel matched the expected color in Chromium, Chrome and Brave. This also verified that the selector overlay was excluded from the result.

The tests exercised direct Copy without opening a tab, same-page Preview, Close, Escape cancellation, keyboard parent/child navigation, page-action suppression, small-button control placement without target overlap, control-origin click routing, and preservation of the selected button when opening Preview. The small button remained at zero activations. Tests also covered semantic and deeply nested HTML, scrolling, sticky and fixed elements, clipping, transformed bounds, `object-fit`, dark content, forms, contenteditable, iframe boundary selection, open Shadow DOM, large tables, repeated activation and navigation cleanup.

Fixture matrix: verified visible capture for semantic HTML, nesting, sticky/fixed UI, rectangular clipping, object-fit images, dark content, tables, forms, contenteditable, iframe boundary, open Shadow DOM and partially offscreen targets. Transformed geometry was verified as a rectangular approximation. Pinch zoom, closed Shadow DOM internals, screen readers, Chrome 120 and multi-monitor changes were not tested; see [known limitations](known-limitations.md).

## Measurements

On the test host, recent full-suite runs measured the browser screenshot call at roughly 45–52 ms and crop/export at roughly 26–45 ms for the fixture capture. These are worker event durations under automated headless load, not product-wide performance guarantees. Ten synthetic pointer steps plus two animation frames took roughly 169–200 ms end-to-end through Playwright. Heap after five cancellation cycles and forced collection was about 2.3 MB versus a 1.5 MB Chromium baseline, 2.3 MB versus 1.5 MB in Chrome, and 2.5 MB versus 1.9 MB in Brave. These values include page, fixture and test harness memory; they do not isolate extension allocations. Peak memory near the 40-megapixel input limit was not measured.

The UI direction follows Apple's guidance to keep contextual actions small and source-adjacent and avoid unnecessary context switches: [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers/), [Modality](https://developer.apple.com/design/human-interface-guidelines/modality/). The selection control moves beside a small target when it would otherwise obscure it; hover retargeting continues outside the control boundary. Actual browser pointer events verify target visibility, Preview, direct Copy and that clicking the selected site button does not activate it.

Test artifacts are in ignored `test-results/`. Run `npm run test:integration` to regenerate them.
