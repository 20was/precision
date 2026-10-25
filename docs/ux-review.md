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
- Composition selection, hit testing, movement, and resizing have more complex interactions than the simple selection path. The current real-browser coverage verifies basic resize/move and undo/redo but does not cover dense overlaps or all zoom levels.
- Composition resize uses one bottom-right handle and preserves the source aspect ratio; edge/corner handles and freeform resizing are not present.
- Annotation marks are canvas-based. Rectangle and text editing/export have browser coverage; pen, arrow, and spotlight need dedicated pixel expectation tests before relying on their output fidelity.
- Mobile-sized browser windows use responsive CSS, but keyboard/focus and actual control usability on a 390px editor were not exhaustively tested.
- Success/error copy and controls use the existing neutral direction. This audit did not introduce a visual redesign.

## Recommendations before public beta

1. Run a short screen-reader and keyboard-only review of both editor surfaces.
2. Add deterministic real-browser tests for overlapping composition objects and all annotation tools' exported pixels.
3. Capture and inspect editor screenshots at a small and standard window size in both light and dark modes, with empty/one/many layers.

These are validation tasks, not claims of known data corruption.
