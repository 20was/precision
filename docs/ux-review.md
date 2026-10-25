# UX review

**Review date:** 2026-10-25. Scope: toolbar popup, in-page selector and preview, full-page progress, screenshot editor, composition editor, keyboard paths, and responsive CSS.

## Confirmed strengths

- The popup exposes the capture modes directly and selection returns to the source tab.
- Element selection uses one closed Shadow DOM surface, and controls stay near the pointer/target. A page-action shield prevents the selection click from activating underlying controls.
- Direct Copy is available from the selection surface; Preview is an explicit second choice. Capture errors remain in the page context.
- Full-page capture has progress and an Escape/cancel path. The initial scroll position is restored on success and tested cancellation.
- The editor uses native buttons, accessible labels, focus styles, status text, keyboard shortcuts, and prefers-color-scheme styling. Composition and annotation do not mutate the captured source page.
- The composition editor has a dedicated sidebar, zoom control, annotation toolbar, and separate PNG/clipboard actions.

## Issues and limits

- Canvas accessibility is limited: the screenshot is a labelled canvas, not a structured accessible representation of the pixels or annotations. Keyboard shortcuts and side controls help but do not replace assistive-technology testing.
- Composition selection, hit testing, movement, resize, reorder, removal, and history now have deterministic real-browser overlap coverage. The topmost source receives a hit, and source stacking order follows the source list.
- Composition resize uses one bottom-right handle and preserves the source aspect ratio; edge/corner handles and freeform resizing are not present. Vertical-only pointer movement now changes size proportionally.
- Annotation marks remain canvas-based. Pen, arrow, rectangle, text and spotlight have decoded image-content assertions, including text edit/move and history. See [editor-precision-report.md](editor-precision-report.md).
- Mobile-sized browser windows use responsive CSS, but keyboard/focus and actual control usability on a 390px editor were not exhaustively tested.
- Success/error copy and controls use the existing neutral direction. This audit did not introduce a visual redesign.

## Recommendations before public beta

1. Run a short screen-reader and keyboard-only review of both editor surfaces.
2. Exercise screen-reader semantics and keyboard-only workflows with assistive technology; canvas pixels are still not exposed as structured accessible content.
3. Expand visual snapshots to small windows and light/dark appearances with empty, one, and many objects. Current golden coverage is one Chromium desktop composition state.

These are validation tasks, not claims of known data corruption.
