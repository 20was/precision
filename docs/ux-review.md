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

- Canvas pixels are not exposed as text, but editable annotations now have a compact, expandable list of named controls. This lets keyboard and screen-reader users find/select a mark and edit text without duplicating a second canvas editor. The screenshot itself remains a labelled canvas.
- Composition selection, hit testing, movement, resize, reorder, removal, and history now have deterministic real-browser overlap coverage. The topmost source receives a hit, and source stacking order follows the source list.
- Composition resize uses one bottom-right handle and preserves the source aspect ratio; edge/corner handles and freeform resizing are not present. Vertical-only pointer movement now changes size proportionally.
- Annotation marks remain canvas-based. Pen, arrow, rectangle, text and spotlight have decoded image-content assertions, including text edit/move and history. See [editor-precision-report.md](editor-precision-report.md).
- A Chromium run at 390 × 480 CSS px confirmed composition footer buttons remain within the footer and the screenshot editor retains its named actions. Other short-window sizes and branded-browser responsive runs are not yet covered.
- The annotation list starts collapsed so it does not cover the image. When expanded, its non-control area passes pointer input through to the canvas; its summary and item buttons remain interactive.
- The selection surface now receives focus on activation; selector controls cycle with Tab, preview traps focus, and Escape closes/restores focus. Automated browser keyboard and accessibility-tree checks passed; no screen reader was run.
- Full-page capture waits at most 1.5 seconds for visible pending image decoding per strip and 12 seconds total. This improves lazy-image readiness but deliberately aborts when the bounded wait expires.
- Success/error copy and controls use the existing neutral direction. This audit did not introduce a visual redesign.

## Recommendations before public beta

1. Run a short screen-reader review of both editor surfaces with VoiceOver or NVDA; no screen-reader validation has been performed.
2. Expand visual snapshots to small windows and light/dark appearances with empty, one, and many objects. Current golden coverage remains one Chromium desktop composition state.

These are validation tasks, not claims of known data corruption.
