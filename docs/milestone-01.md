# Milestone 01 — Smart Element Capture

Scope: hover → select visible element → actual PNG preview → copy/download. No history, cloud, annotations or stitching.

1. Research API constraints and establish reproducible strict TypeScript build — complete.
2. Implement popup, isolated selector, privileged capture/crop and transient preview — complete.
3. Validate fractional geometry, clipping, targeting and message/session boundaries — complete for documented model.
4. Refine keyboard interaction, light/dark surfaces and actionable failure states — complete.
5. Audit cancellation, navigation, stale sessions, resource limits and permission scope — complete for this vertical slice.
6. Run checks and actual-extension browser tests; record measured evidence and gaps — complete; see [test report](test-report.md) and [known limitations](known-limitations.md).

Milestone status: PASS for the supported visible-area model in tested current Chromium, Chrome and Brave on macOS. Browser testing does not cover Chrome 120, every OS/display scaling combination or unsupported rendering cases. Do not interpret PASS as store approval or pixel-exact rendering of transformed, clipped-to-shape or occluded content.

## Product decisions

- Click the toolbar icon to open a small action popup; users explicitly start selection. The action bar stays beside the pointer, and users can copy directly or open an in-page preview after selecting.
- Capture only the visible, viewport-clipped rectangle. Preserve composited pixels and state the visible-area limit.
- Direct Copy is available beside the pointer. Copy/download also live in a compact, same-page preview; neither action opens another tab.
- Preserve local-only handling; do not add accounts, network calls, screenshot history or broad host permissions.
- Next milestone recommendation: manual rectangular region capture using the existing viewport-to-bitmap crop pipeline.
