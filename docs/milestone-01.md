# Milestone 01 — Smart Element Capture

Original scope: hover → select visible element → actual PNG preview → copy/download. The local 0.1.4 work adds a separate vertically stitched full-page path that reuses the image editor.

1. Research API constraints and establish reproducible strict TypeScript build — complete.
2. Implement popup, isolated selector, privileged capture/crop and transient preview — complete.
3. Validate fractional geometry, clipping, targeting and message/session boundaries — complete for documented model.
4. Refine keyboard interaction, light/dark surfaces and actionable failure states — complete.
5. Audit cancellation, navigation, stale sessions, resource limits and permission scope — complete for this vertical slice.
6. Run checks and actual-extension browser tests; record measured evidence and gaps — complete; see [test report](test-report.md) and [known limitations](known-limitations.md).

Milestone status: PASS for the supported visible-area model in tested current Chromium, Chrome and Brave on macOS. Browser testing does not cover Chrome 120, every OS/display scaling combination or unsupported rendering cases. Do not interpret PASS as store approval or pixel-exact rendering of transformed, clipped-to-shape or occluded content.

## Full-page capture addition (0.1.4)

- Added a second popup action that scrolls and captures a vertically scrolling page, shows progress and cancellation, restores the original scroll position, and opens the annotated image in an extension-owned editor tab.
- Stitching derives independent horizontal and vertical scale from each screenshot bitmap and the measured CSS viewport. The extension rejects horizontal overflow, changing page height/viewports, pinch zoom, and images above 40 megapixels.
- Full-page browser integration now covers short and long fixtures, sticky/fixed content, 125% zoom, output pixels, scroll restoration and cancellation in Chromium, Chrome and Brave. Lazy-load stabilization on arbitrary sites, nested scrolling and peak memory remain unverified. See [test report](test-report.md) and [known limitations](known-limitations.md).

## Multi-element composition addition (0.1.5)

- Added a dedicated popup action. In selection mode, clicks add visible element captures while selection remains active; the pointer bar offers Undo add and Compose. Compose opens a separate editor tab.
- The composition editor treats each capture as a separate object with move, aspect-preserving resize, layer order, removal, undo/redo, fit/zoom, annotation tools, copy and PNG download. Annotation marks stay aligned with the editable objects and are flattened with them on PNG export; both are retained only during the open editor session.
- Automated browser validation covers repeated captures, editor handoff, object resize/move with undo/redo, rectangle and editable text annotation, PNG download, clipboard image equality, and Escape cleanup. Dense overlaps, comprehensive reorder/remove behavior, and memory limits still need dedicated tests; see [test report](test-report.md).

## Visible viewport capture addition (0.1.6)

- Added a popup action that captures the active tab's current visible viewport once and opens it in the existing annotated screenshot editor. It uses `activeTab`, local chunked handoff, and existing image-size limits; it does not inject a content script.
- Automated integration checks validate editor handoff and viewport-sized PNG dimensions in Chromium, Chrome and Brave. Brave's screenshot bitmap was 9 CSS pixels shorter than `innerHeight` in the automated headless test window; the editor reports dimensions from the actual PNG returned by Chromium's capture API.

## Product decisions

- Click the toolbar icon to open a small action popup; users explicitly start selection. The action bar stays beside the pointer, and users can copy directly or open an in-page preview after selecting.
- Capture only the visible, viewport-clipped rectangle. Preserve composited pixels and state the visible-area limit.
- Direct Copy is available beside the pointer. Copy/download also live in a compact, same-page preview; neither action opens another tab.
- Preserve local-only handling; do not add accounts, network calls, screenshot history or broad host permissions.
- Next milestone recommendation: manual rectangular region capture using the existing viewport-to-bitmap crop pipeline.
