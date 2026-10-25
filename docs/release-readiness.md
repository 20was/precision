# Release readiness

**Status: PARTIAL — editor precision gates pass, but this is not a production-ready sign-off.** This work did not publish or submit the extension.

## Release gate

| Gate | Result | Evidence |
| --- | --- | --- |
| Manifest V3 build | Pass | `npm run build`, `npm run check`. |
| Strict typecheck, lint, unit tests, production build | Pass | `npm run check`; 46 Vitest tests. |
| Dependency audit | Pass | `npm audit --audit-level=moderate`; zero reported vulnerabilities. |
| Real extension in Chromium, Chrome, Brave | Pass for current matrix | `npm run test:integration`; 30/30 passed, 10 per browser. Versions and scope in [browser-test-matrix.md](browser-test-matrix.md). |
| Full-page representative fixtures | Pass | Long sticky-header/fixed-sidebar bands, short page, 125% zoom/DPR2, pixel checks, original scroll restoration, and Escape cleanup. |
| Composition and export | Pass for tested flow | Two opaque captures, overlap hit testing, move/vertical-only resize/reorder/remove, chronological history, annotation pixels, downloaded PNG and clipboard byte equality. |
| All annotation tools / dense overlap | Pass for tested scope | Real Chromium, Chrome, and Brave editor tests assert decoded pixels for pen, arrow, rectangle, text and spotlight, plus overlapping composition ordering. See [editor-precision-report.md](editor-precision-report.md). |
| Permission/privacy alignment | Pass for reviewed implementation | Narrow permissions and local-only source paths; see [security-review.md](security-review.md). |
| Accessibility and broad OS coverage | Not complete | No screen-reader audit; only macOS browser automation; Chrome 120/minimum version and other operating systems not tested. |
| Store submission metadata/review | Not in scope | Dashboard fields, listing assets, privacy URL, and Google's review outcome are not certified here. |

## Remaining work before public beta

1. Test composition at small editor windows and light/dark native-window conditions; current golden snapshot covers one desktop Chromium state.
2. Test full-page lazy images, animated/dynamic pages, nested scroll containers, cancellation during each stage, and size-limit behavior. Keep unsupported cases explicit.
3. Perform keyboard-only and screen-reader checks; canvas annotations still lack a structured accessible representation.
4. Re-check current Web Store listing/privacy disclosures and owner certifications before any submission.

## Safe packaging and loading

Run `npm ci`, then `npm run check`, then `npm run test:integration`. Load the generated `dist/` directory through `chrome://extensions` or `brave://extensions` with Developer mode and **Load unpacked**. Do not submit a source tree or claim Web Store approval from these tests.
