# Known limitations

## Rendering model

- Element capture uses the visible, axis-aligned bounding rectangle only. Full-page capture is a separate mode; element capture does not stitch or include offscreen content.
- The screenshot is composited browser pixels: overlapping fixed/sticky elements and other occlusion remain in the crop. No isolation, transparency extraction or removal of other content.
- Rotated/skewed/transformed elements, fragmented inline text, rounded corners, masks and clip-paths are represented by rectangular bounds. Rotation may include background pixels. Rectangular overflow ancestors are intersected; transformed overflow padding boxes remain approximate.
- Open Shadow DOM supports hit testing and parent/first-child navigation. Closed roots expose their host only. Iframes can be selected as a whole; internal frame DOM traversal is not implemented.
- Pointer events are intercepted by an extension shield during selection; hit testing temporarily disables it. This prevents iframe clicks and page controls from activating, but normal hover interactions and nested-container wheel routing are not preserved during selection.
- No guarantee against malicious pages: a page can remove the host, open a top-layer dialog above it or have earlier capture listeners. Shadow DOM is styling isolation, not a security boundary against the page. Earlier event side effects cannot be undone.
- Pages can animate/change between geometry checks without changing bounds. Two animation frames and post-capture verification reduce races; they cannot freeze arbitrary rendering.

## Full-page capture

- Captures vertically scrolling pages by scrolling and combining visible viewport screenshots. Horizontal overflow is rejected; nested scroll containers are not stitched.
- The page is scrolled smoothly while a compact progress/cancel control is shown. Precision restores the original scroll position before opening the editor. Cancellation also restores the initial position when the content script remains alive.
- Precision detects wide fixed/sticky bars at the top through a small set of DOM hit tests and adjusts subsequent strip boundaries to avoid pasting the bar repeatedly. Detection can miss unusual or changing headers. Fixed/sticky elements elsewhere (including bottom bars and floating widgets) can repeat. Dynamic ads, lazy content, video, animations, and live data may change between segments; a changed document height or viewport cancels the capture, but same-size visual changes cannot be frozen.
- The image is limited to 40 megapixels and canvas-supported dimensions. Very long pages and large viewport screenshots may be rejected to keep memory use bounded. Browser screenshot capture is rate limited, so long pages take time proportional to the number of viewport segments.
- Full-page screenshots are temporarily chunked in extension-origin IndexedDB for the editor-tab handoff. The editor removes the chunks when it consumes them. Interrupted handoffs may leave local temporary data until browser data is cleared; it is never uploaded or presented as screenshot history.
- Full-page zoom is derived from screenshot bitmap dimensions relative to measured CSS viewport dimensions. Pinch zoom is rejected. OS scaling and unusual window arrangements are not comprehensively verified.

## Visible viewport capture

- Captures one PNG of the active tab's visible browser viewport and opens the shared screenshot editor. It does not include browser chrome or content outside the viewport. It uses `activeTab` and the same 40-megapixel / 110 MB encoded handoff limits as other image captures.
- Verified in automated Chromium, Chrome and Brave on the local fixture. In the headless Brave run the returned bitmap was 9 CSS pixels shorter than `innerHeight`; the editor uses the actual bitmap dimensions returned by the browser. Native window sizing may vary by browser and environment.

## Multi-element composition

- Composition captures each element's visible rectangular pixels, then starts with a vertical stack on a white artboard. Objects remain separate until exported: move, preserve-aspect resize, reorder, remove, undo/redo and zoom are supported. The shared pen, arrow, rectangle, text and spotlight tools annotate the composition; copy/download flattens the artboard and annotations into a PNG. Annotations and layout are not saved as a project after the editor closes. Transparent backgrounds, freeform crop and saving for later editing are not included.
- Maximum 24 objects, estimated artboard 32 megapixels, 32,767-pixel canvas dimension, and 80 MB handoff payload. Capture items remain in memory while selecting and the editor handoff is temporary local IndexedDB; the editor deletes it when consumed.
- Real-browser tests verify repeated capture, composition editor handoff, object move/resize, keyboard undo/redo, rectangle and text edit/export, download, and decoded clipboard-vs-download image equality in Chromium, Chrome and Brave. Dense overlapping-object selection, reorder/remove edge cases, all resize directions, and high-memory composition limits still need dedicated real-browser validation.

## Coordinates and browser coverage

- Measured screenshot dimensions and fractional visual viewport dimensions drive crop scale. Reserved scrollbar space is added when present. Inward edge rounding intentionally excludes partially covered edge pixels; tiny subpixel elements can be rejected.
- Browser zoom 100/125/150% and forced DPR 2 (effective 2/2.5/3) have real screenshot comparisons in Chrome, Brave and Chromium. Native macOS Retina capture has been manually checked.
- Pinch zoom / displaced visual viewports are rejected. Non-overlay scrollbar geometry, OS scaling configurations other than the test environment, multiple-display transitions, split view, very large displays, minimum supported Chrome 120 and assistive technologies are not comprehensively verified.
- Chrome/Brave internal pages, the Web Store, other extension pages, PDF viewers and file URLs cannot use this selector.

## Lifecycle and export

- Editor zoom changes only the canvas display size (5%–400%). Fit resets to the whole-image view; keyboard shortcuts are `-`, `+` and `0`. Zoom is implemented, but composition transforms at multiple zoom levels have not had comprehensive real-browser assertions.

- Annotation marks are flattened into copied/downloaded PNGs; they are not editable after export and are discarded when the editor closes. Text placement is single-line; one rectangular spotlight region is supported. There are no annotation layers, blur/redaction, crop refinement or shape resizing.

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
