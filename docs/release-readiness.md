# Release readiness

**Status: PARTIAL — do not treat this audit as a production-ready sign-off.** This work did not publish or submit the extension.

## Release gate

| Gate | Result | Evidence |
| --- | --- | --- |
| Manifest V3 build | Pass | `npm run build`, `npm run check`. |
| Strict typecheck and lint | Pass | `npm run check`. |
| Unit tests | Pass | 38 Vitest tests. |
| Real extension in Chromium | Pass | Playwright persistent extension context, actual screenshots and downloaded PNG decoding. |
| Branded Chrome and Brave | Pass for tested flows | Installed versions in [browser-test-matrix.md](browser-test-matrix.md). |
| Full-page representative fixtures | Pass | Long sticky-header/fixed-sidebar bands, short page, 125% zoom/DPR2, pixel checks, original scroll restoration, and Escape cleanup. |
| Composition and export | Pass for tested flow | Two captured elements, move/resize and history, annotation editing, downloaded PNG and actual clipboard-vs-download pixel comparison. |
| All annotation tools / dense overlap | Partial | Rectangle and editable text have output coverage; pen, arrow, spotlight, dense mark/object overlap need dedicated image-content assertions. |
| Permission/privacy alignment | Pass for reviewed implementation | Narrow permissions and local-only source paths; see [security-review.md](security-review.md). |
| Accessibility and broad OS coverage | Not complete | No screen-reader audit; only macOS browser automation; Chrome 120/minimum version and other operating systems not tested. |
| Store submission metadata/review | Not in scope | Dashboard fields, listing assets, privacy URL, and Google's review outcome are not certified here. |

## Remaining work before public beta

1. Add real-browser pixel regression tests for pen, arrow, spotlight, mark movement, and difficult overlapping selections.
2. Test composition movement/resizing/reordering/removal at multiple zoom levels and smaller editor windows, including undo/redo and clipboard equality.
3. Test full-page lazy images, animated/dynamic pages, nested scroll containers, cancellation during each stage, and size-limit behavior. Keep unsupported cases explicit.
4. Perform keyboard-only and screen-reader checks; inspect responsive screenshots in light/dark mode on a native window.
5. Re-check current Web Store listing/privacy disclosures and owner certifications before any submission.

## Safe packaging and loading

Run `npm ci`, then `npm run check`, then `npm run test:integration`. Load the generated `dist/` directory through `chrome://extensions` or `brave://extensions` with Developer mode and **Load unpacked**. Do not submit a source tree or claim Web Store approval from these tests.
