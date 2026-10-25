# Editor precision report

**Date:** 2026-10-25. **Scope:** composition and annotation editor geometry, history, image output, and overlap behavior. No permissions or runtime dependencies changed.

## Confirmed defects and corrections

| Priority | Finding and evidence | Correction |
| --- | --- | --- |
| P1 | A vertical-only drag of the bottom-right composition resize handle did not resize the object. The original resize path used only horizontal pointer delta; the real-extension test reproduced an unchanged blue-pixel count on baseline. | Resize derives an aspect-preserving width from both pointer axes, clamps to documented minimum/available canvas bounds, and has a vertical-only UI regression test. |
| P2 | Annotation and composition editors duplicated client-to-image coordinate conversion, with no shared tested contract. | `src/shared/editor-geometry.ts` now owns bounded CSS-client/image-world conversion and aspect resize projection. Round trips and invalid rectangles are unit-tested. |
| P2 | Layout and annotation edits had separate histories, so undo/redo could follow tool-dependent rather than chronological order. Composition history now records a shared edit-domain timeline while keeping each domain's existing snapshots. | Added an end-to-end sequence alternating annotation and layout edits; undo/redo restores the expected pixels and selected source. |
| P2 | Composition pointer cancellation could leave a move/resize applied without a matching history entry. Annotation cancellation could retain a partial draft/drag. | Pointer cancellation restores the pre-gesture geometry or mark state and discards unfinished drafts. |
| P2 | Editing text could replace the existing text color with the current global picker color even when the user had not changed color during the edit. | Existing mark color is retained unless the picker is changed in that edit session. The text regression test checks old and new output pixels. |

## Coordinate and rendering model

Annotations and composition layout are stored in image-world pixels. Canvas pointer positions are mapped from the rendered canvas client rectangle to its intrinsic image dimensions through the shared conversion utility. Editor zoom changes the rendered rectangle, not stored geometry. Composition sources render in array order (last item is visually topmost); hit testing walks that same order in reverse and uses rectangular bounds. Captured screenshot crops are opaque composited pixels, so alpha-through selection is not meaningful for current inputs. Annotations render above all composition sources. There is no annotation-under-source layer control.

## Verification coverage

`tests/extension.spec.ts` now exercises the actual extension UI and decodes rendered/exported PNGs against known flat-color fixtures:

- Pen: continuous stroke, flat-color position, one-operation undo/redo, move, and editor zoom.
- Arrow: horizontal, short, vertical, diagonal direction samples, and no-paint control pixel.
- Rectangle: reverse drag direction, edge pixels, and zoom-independent image-world geometry.
- Text: create, edit without duplicate old pixels, explicit color change, move, empty commit, undo/redo, and output pixels.
- Spotlight: boundary position, interior/exterior flat pixels, fixed 58% dimming math, replacement, and history.
- Composition: two overlapping opaque elements; topmost hit, move, vertical-only proportional resize, reorder, remove, undo/redo, annotation above sources, and chronological annotation/layout history.
- Download and clipboard: decoded PNG dimensions and every RGBA byte are compared for an annotated composition in Chromium, Chrome, and Brave.
- Visual UI: a Chromium-specific composition-selected snapshot is stored beside the Playwright spec. It is not auto-approved on change.

Unit tests cover coordinate round trips at 0.5x, 1x, 1.5x, and 2x display scales, out-of-bounds clamping, invalid geometry, and two-axis aspect resizing. The real browser fixture uses DPR 2; editor zoom is changed independently through approximately 50%, 100%, 150%, and 200%, and browser zoom is set to 125% in a separate interaction. The full integration suite passed 30/30: Playwright Chromium 156.0.8078.4, Chrome 155.0.8059.85, and Brave 155.0.8059.40, headless on macOS.

## Performance observations

In the passing integration run, pointer-driving 10 steps and two animation frames took about 171–202 ms; element preview decode and handoff took about 208–312 ms. Worker instrumentation logged viewport screenshot capture at about 44–55 ms and crop/export handoff at about 30–59 ms. These are single-run local test observations, not product performance guarantees. The runner logged renderer heap before and after cancellation (about 1.5 MB and 2.3 MB in Chrome); this is too small a sample to establish leak or memory-retention behavior.

## Known boundaries

- Annotation stroke width and selected annotation colors are tested. Pen/arrow/rectangle opacity remains the existing opaque rendering behavior; no opacity control exists. Spotlight opacity is fixed at 58%; there is no opacity setting.
- Composition source captures are opaque; transparent-hole hit-through is unsupported/not applicable. Annotation z-order below composition source images is not supported. There is one bottom-right aspect-locked resize handle, not freeform or multi-handle resizing.
- Screenshot edge antialiasing varies; assertions use flat interiors, exact RGBA where deterministic, and directional color predicates for arrow raster edges.
- Automated browser runs are headless macOS runs. They do not establish accessibility with screen readers or clipboard behavior on other operating systems.

## Commands and environment

Run results, exact browser versions, and the final integration outcome are recorded in [browser-test-matrix.md](browser-test-matrix.md) and [release-readiness.md](release-readiness.md). Test artifacts, including failed-run screenshots/traces, are written by Playwright under `test-results/`.
