# Known limitations

## Rendering model

- Visible, axis-aligned bounding rectangle only. No stitching or offscreen content.
- The screenshot is composited browser pixels: overlapping fixed/sticky elements and other occlusion remain in the crop. No isolation, transparency extraction or removal of other content.
- Rotated/skewed/transformed elements, fragmented inline text, rounded corners, masks and clip-paths are represented by rectangular bounds. Rotation may include background pixels. Rectangular overflow ancestors are intersected; transformed overflow padding boxes remain approximate.
- Open Shadow DOM supports hit testing and parent/first-child navigation. Closed roots expose their host only. Iframes can be selected as a whole; internal frame DOM traversal is not implemented.
- Pointer events are intercepted by an extension shield during selection; hit testing temporarily disables it. This prevents iframe clicks and page controls from activating, but normal hover interactions and nested-container wheel routing are not preserved during selection.
- No guarantee against malicious pages: a page can remove the host, open a top-layer dialog above it or have earlier capture listeners. Shadow DOM is styling isolation, not a security boundary against the page. Earlier event side effects cannot be undone.
- Pages can animate/change between geometry checks without changing bounds. Two animation frames and post-capture verification reduce races; they cannot freeze arbitrary rendering.

## Coordinates and browser coverage

- Measured screenshot dimensions and fractional visual viewport dimensions drive crop scale. Reserved scrollbar space is added when present. Inward edge rounding intentionally excludes partially covered edge pixels; tiny subpixel elements can be rejected.
- Browser zoom 100/125/150% and forced DPR 2 (effective 2/2.5/3) have real screenshot comparisons in Chrome, Brave and Chromium. Native macOS Retina capture has been manually checked.
- Pinch zoom / displaced visual viewports are rejected. Non-overlay scrollbar geometry, OS scaling configurations other than the test environment, multiple-display transitions, split view, very large displays, minimum supported Chrome 120 and assistive technologies are not comprehensively verified.
- Chrome/Brave internal pages, the Web Store, other extension pages, PDF viewers and file URLs cannot use this selector.

## Lifecycle and export

- Selection expires after two minutes. Browser focus loss, navigation, switching tabs or resizing cancels it. Screen capture requires the original tab/window still active.
- Browser capture cannot be aborted once the API call begins. Results from cancelled/stale sessions are discarded.
- Worker restart invalidates pending selection sessions; the next operation gives a retry message. An already displayed in-page preview remains available because it is owned by the content script.
- Reloading or navigating the page closes the in-page preview. No screenshot history or recovery is implemented.
- Maximum input bitmap: 40 megapixels. A viewport capture temporarily allocates screenshot/base64 buffers before validation. Peak process memory has not been profiled at that limit.
- Direct Copy uses `navigator.clipboard.write()` from the isolated content script on a secure page. Some origins/browser policies may deny it; an actionable message recommends Preview or Enter to open the in-page preview. The tested Chromium, Chrome and Brave builds preserved fixture dimensions and pixel values. Clipboard behavior on every operating system and site policy is not comprehensively verified; preview remains available when a site denies direct Copy.
- Anchor downloads do not expose final success or disk errors to the extension. The UI says the request was sent, not that a file was saved.
- Current image filenames include a timestamp and random suffix, but filesystem collision behavior remains the browser's responsibility.

## Release status

This is an unpacked local milestone build. Chrome Web Store submission, packaging review, store listing and broader browser/OS QA are not included.
