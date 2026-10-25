# Chrome Web Store listing draft

This is draft copy for the local package, version 0.1.6. It does not change any package already submitted to the dashboard; update the store listing and privacy answers only when uploading this build.

## Product name

Precision — Smart Element Capture

## Short description

Capture the visible viewport, webpage elements, or a full page, then compose, annotate, copy or download.

## Detailed description

Capture just the part of a webpage you need.

Capture the visible viewport in one step, or move over a page to highlight an element and copy its visible pixels directly from the page or open the editor to annotate and download a PNG. Choose **Capture full page** to scroll through a vertically scrolling page and open the stitched capture in the editor. Choose **Compose elements** to add separate page elements to a canvas, then move, resize, reorder, annotate and export them together. Precision processes screenshots locally and does not upload them.

**How it works**

- Select a visible page element with the pointer.
- Capture the current viewport and open it in the screenshot editor.
- Copy the capture in place, or preview and download it as PNG.
- Use the keyboard to move to a nearby parent or child element, capture, or cancel.
- Capture a vertically scrolling page, then annotate, copy or download the resulting PNG.
- Add separate visible element captures to an editable composition canvas.

Element captures include only the selected element's visible rectangular area and may include overlapping content. Composition captures include up to 24 separate elements, limited to their visible rectangles. Full-page captures support vertical scrolling; fixed and sticky elements may repeat. Horizontal scrolling is not supported.

**Privacy**

Precision processes page content and screenshots locally only to provide the capture you requested. Editor handoffs briefly use local extension IndexedDB and delete chunks when consumed. It does not transmit this content or retain screenshot history. Copying or downloading happens only after you choose that action. Read the [Privacy Policy](https://github.com/20was/precision/blob/main/PRIVACY.md).

## Dashboard disclosure notes

- Single purpose: capture webpage pixels selected by the user, then compose, annotate, copy or download the image on request.
- Page content and pointer/key input are accessed only after the user invokes the extension and starts selection. They are processed locally for target selection and capture, and are not transmitted to the developer or a third party.
- Screenshot data is temporarily held in memory; full-page transfer chunks are briefly stored in extension-origin IndexedDB and deleted when the editor consumes them. No history is kept.
- No accounts, analytics, advertising, or remote code.
- Permissions: `activeTab`, `scripting`, `clipboardWrite`.
- Privacy policy URL: `https://github.com/20was/precision/blob/main/PRIVACY.md`.

## Listing assets to prepare

- Store icon: use `public/icons/precision-128.png` (128 × 128).
- Screenshots: ready in `store-assets/selection.png` and `store-assets/preview.png`. These are real captures of the unpacked production build at 1280 × 800. The website shown is a local demonstration fixture.
- Small promo tile / marquee: optional; not required for the first listing draft.

## Submission checklist

- Confirm store listing and dashboard privacy answers against the exact uploaded build.
- Build and inspect the ZIP with `manifest.json` at its root.
- Upload `store-assets/selection.png` and `store-assets/preview.png` as listing screenshots.
- Verify name, version, icon, description and minimum Chrome version in the packaged manifest.
- Submit for review only after the owner has reviewed the final ZIP and listing.

