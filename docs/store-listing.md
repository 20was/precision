# Chrome Web Store listing draft

This is draft copy for review before a store submission. The Chrome Web Store dashboard's privacy answers must match the current build and this disclosure.

## Product name

Precision — Smart Element Capture

## Short description

Select a webpage element and copy or download its visible pixels.

## Detailed description

Capture just the part of a webpage you need.

Move over a page to highlight an element, then copy its visible pixels directly from the page or open a small preview to download a PNG. Precision keeps you on the current tab and does not upload or store screenshots.

**How it works**

- Select a visible page element with the pointer.
- Copy the capture in place, or preview and download it as PNG.
- Use the keyboard to move to a nearby parent or child element, capture, or cancel.

Captures include only the selected element's visible rectangular area. They may include content that overlaps the element. Full-page capture and editing tools are not included.

**Privacy**

Precision processes the selected page content and screenshot locally in your browser only to provide the capture you requested. It does not transmit this content, use analytics, or retain screenshot history. Copying or downloading happens only after you choose that action. Read the [Privacy Policy](https://github.com/20was/precision/blob/main/PRIVACY.md).

## Dashboard disclosure notes

- Single purpose: capture the visible pixels of a webpage element selected by the user, then copy or download that image on request.
- Page content is accessed only after the user invokes the extension and starts selection. It is processed locally and not transmitted to the developer or a third party.
- Screenshot and geometry data are temporarily held in memory during the requested operation and discarded when the operation/preview ends.
- No accounts, analytics, advertising, or remote code.
- Permissions: `activeTab`, `scripting`, `clipboardWrite`.
- Privacy policy URL: `https://github.com/20was/precision/blob/main/PRIVACY.md`.

## Listing assets to prepare

- Store icon: use `public/icons/precision-128.png` (128 × 128).
- Screenshots: the README captures are currently 1440 × 960 (3:2), so create store-sized 1280 × 800 or 640 × 400 captures from the product before submission. Do not stretch them; recapture at the target aspect ratio or crop with care.
- Small promo tile / marquee: optional; not required for the first listing draft.

## Submission checklist

- Confirm store listing and dashboard privacy answers against the exact uploaded build.
- Build and inspect the ZIP with `manifest.json` at its root.
- Verify name, version, icon, description and minimum Chrome version in the packaged manifest.
- Submit for review only after the owner has reviewed the final ZIP and listing.

