# Release readiness

**Status: PARTIAL — editor precision gates pass, but this is not a production-ready sign-off.** This work did not publish or submit the extension.

## Release gate

| Gate | Result | Evidence |
| --- | --- | --- |
| Manifest V3 build | Pass | `npm run build`, `npm run check`. |
| Strict typecheck, lint, unit tests, production build | Pass | `npm run check`; 46 Vitest tests. |
| Dependency audit | Pass | `npm audit --audit-level=moderate`; zero reported vulnerabilities. |
| Real extension in Chromium, Chrome, Brave | Pass for current matrix | `npm run test:integration`; current run 48/48 passed, 16 per browser. Versions and scope in [browser-test-matrix.md](browser-test-matrix.md). |
| Full-page representative fixtures | Pass for tested cases | Long and short pages, lazy image, sticky/fixed content, dynamic-height rejection/recovery, 125% zoom/DPR2, tall-output rejection, Escape/tab-switch cancellation, pixel checks and scroll restoration. |
| Composition and export | Pass for tested flow | Two opaque captures, overlap hit testing, move/vertical-only resize/reorder/remove, chronological history, annotation pixels, downloaded PNG and clipboard byte equality. |
| All annotation tools / dense overlap | Pass for tested scope | Real Chromium, Chrome, and Brave editor tests assert decoded pixels for pen, arrow, rectangle, text and spotlight, plus overlapping composition ordering. See [editor-precision-report.md](editor-precision-report.md). |
| Permission/privacy alignment | Pass for reviewed implementation | Narrow permissions and local-only source paths; see [security-review.md](security-review.md). |
| Accessibility and broad OS coverage | Not complete | No screen-reader audit; only macOS browser automation; Chrome 120/minimum version and other operating systems not tested. |
| Store submission metadata/review | Not in scope | Dashboard fields, listing assets, privacy URL, and Google's review outcome are not certified here. |

## Remaining work before public beta

1. Perform a screen-reader review with VoiceOver or NVDA; no screen reader is available in the automated test run. The annotation list has accessible object controls, while canvas pixels remain unstructured.
2. Investigate the approximately 2.5 GiB near-limit peak and validate an appropriate limit on lower-memory hardware before promoting 40 MP captures in public beta.
3. Re-check current Web Store listing/privacy disclosures and owner certifications before any submission.

## Safe packaging and loading

Run `npm ci`, then `npm run check`, then `npm run test:integration`. Load the generated `dist/` directory through `chrome://extensions` or `brave://extensions` with Developer mode and **Load unpacked**. Do not submit a source tree or claim Web Store approval from these tests.

## Milestone 03 update (2026-10-25)

Current status remains **PARTIAL** pending completion of the current full browser matrix and a real screen-reader review. New work has addressed the prior flaky test synchronization, bounded full-page image settling, dimension guards, bitmap cleanup on stitch failures, accessible annotation listing and narrow-window layout checks. See [milestone-03-report.md](milestone-03-report.md) and the updated [browser-test-matrix.md](browser-test-matrix.md).

| Gate | Current evidence | Remaining boundary |
| --- | --- | --- |
| Popup action readiness | Test helper awaits CDP popup-action acknowledgment. Two historically intermittent Chrome cases passed three repeated repetitions each (6/6), plus 48/48 full-matrix tests. | Finite repeat sample; cannot guarantee zero intermittent failures. |
| Full-page handling | Lazy image decode, dynamic-height rejection/recovery, 125% zoom/DPR2 pixels, tall-output rejection and tab-switch cancellation/retry passed in Chromium, Chrome and Brave. | Animated content is captured per strip; nested scrolling is unsupported; fixed bottom content can repeat. |
| Responsive editor | All three browser projects resized to 390 × 480; footer controls were geometrically verified within the footer. | No full matrix of window sizes, themes or native-window light/dark appearance. |
| Accessibility | All three browser projects verified keyboard navigation, Escape, preview dialog semantics, focus wrapping and the annotation-object accessible name. | No screen reader run; canvas image content itself is not a structured accessible scene. |
| Resource limits | Two isolated Chromium samples completed 39.19 MP capture and PNG export. De-duplicated browser process-tree peaks were 2.41 and 2.62 GiB. | High peak on the 24 GB test host; lower-memory devices and branded Chrome/Brave near-limit behavior remain unmeasured. The pixel cap is not a demonstrated memory-safety threshold. |
