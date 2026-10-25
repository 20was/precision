# Production readiness audit

**Audit date:** 2026-10-25  
**Build:** 0.1.6  
**Environment:** Apple Silicon macOS; Playwright bundled Chromium 156.0.8078.4, Google Chrome 155.0.8059.85, Brave 155.0.8059.40 (1.97.56).

## User journey reviewed

Toolbar action → popup mode → worker session and temporary injection → content-script selection or viewport scrolling → `captureVisibleTab` → crop/stitch in canvas → temporary extension-local handoff → editor → clipboard/download. Source references: [popup.ts](../src/popup.ts), [worker.ts](../src/worker.ts), [content.ts](../src/content.ts), [handoff.ts](../src/shared/handoff.ts), [editor.ts](../src/editor.ts), [composition-editor.ts](../src/composition-editor.ts), and [annotation.ts](../src/annotation.ts).

## Findings and fixes

| Severity | Finding | Outcome |
| --- | --- | --- |
| P1, fixed | At 125% browser zoom, Chromium could clamp the final full-page scroll to a fractional CSS coordinate. The loop reached 99% but could not advance its `covered` value, so the capture never completed. | Added a bounded final-frame remainder rule for at most 2 CSS pixels and stretched the final source slice only across that subpixel rounding remainder. The final output height continues to use the measured screenshot bitmap scale. Regression tests compare the actual downloaded PNG's size and color bands. See [content.ts](../src/content.ts#L499). |
| P2, contained | Page content can change while a full-page capture scrolls. The implementation checks viewport and document dimensions, waits for scroll settling, and restores the initial scroll position, but it cannot freeze animations, ads, video, lazy content, or live data. | Rejects detected layout/viewport changes; same-size visual changes remain a documented limit. |
| P2, documented | Composition and annotation histories are separate, and undo routing follows the active tool. Resize currently uses a single bottom-right, aspect-preserving handle. | Verified move, resize, undo/redo, PNG output, and clipboard/PNG pixel equivalence in the fixture workflow. Corner variants, overlap-heavy layouts, and zoomed editing are not comprehensively covered. |
| P2, documented | Extension-origin IndexedDB can retain a partial local handoff if a browser or editor closes between writing and consuming the chunks. | The handoff is random-session keyed and deleted on normal consume/cancel. There is no periodic stale-record sweep; an interrupted record remains local until browser data is cleared. |

No unresolved P0 or confirmed P1 defect was found in the tested workflows. This is not a production-ready declaration: high-risk behavior on unusual pages and some editor operations still need broader validation. See [release-readiness.md](release-readiness.md).

## Verified evidence

- `npm run check`: typecheck, lint, 38 unit tests, and production build passed.
- `npm run test:integration`: final run passed 24/24 across Chromium, Chrome and Brave after the focus-handling fix; see [test-report.md](test-report.md).
- Actual extension action and `captureVisibleTab` in all three browser environments; fixture PNG pixels, clipboard image bytes, and downloaded PNG contents were decoded and compared.
- Full-page fixture: short page, sticky header, fixed sidebar, distinct long-page color bands, transformed content, 125% browser zoom, device scale factor 2, original scroll restoration, and Escape cancellation.
- Composition fixture: two independent captures, object resize, keyboard movement with undo/redo, rectangle and text create/edit, exported PNG pixel checks, and clipboard image decoded and compared pixel-for-pixel with PNG download.
- `npm audit --audit-level=moderate`: zero vulnerabilities reported for the lockfile at audit time.

The suite does not mock `captureVisibleTab`; screenshots come from real loaded extension contexts on localhost fixtures. It is not a store review or a test of every OS, display arrangement, site, or accessibility technology.

## Not verified

- Full-page lazy-load stabilization, animated/sticky variants, nested scroll containers, navigation during every stitch stage, and very large near-limit images.
- Composition reorder/remove in an overlapping layout, each resize edge/corner, editing at several zoom values, and all annotation tools' pixel-level fidelity. Rectangle and text editing are exercised; the other mark tools need dedicated output assertions.
- Screen-reader behavior, actual user testing at small editor sizes, Chrome 120, multiple displays, non-macOS platforms, peak memory near size limits, and long repeated-session memory trends.
- Web Store dashboard disclosures, account certification, submission, and review outcome.
