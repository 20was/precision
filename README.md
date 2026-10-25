<div align="center">
  <img src="assets/precision-banner.svg" alt="Precision — capture the part you actually need" width="100%" />

  <p><strong>A local-first screenshot tool for Chrome and Brave.</strong><br />Capture a page element, custom area, visible viewport, or full page for annotation.</p>

  <p>
    <a href="https://github.com/20was/precision/actions/workflows/ci.yml"><img src="https://github.com/20was/precision/actions/workflows/ci.yml/badge.svg" alt="Continuous integration" /></a>
    <a href="https://github.com/20was/precision/actions/workflows/codeql.yml"><img src="https://github.com/20was/precision/actions/workflows/codeql.yml/badge.svg" alt="CodeQL analysis" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-34352f.svg" alt="MIT License" /></a>
    <a href="https://github.com/20was/precision/releases"><img src="https://img.shields.io/badge/status-early%20development-c8ee65?labelColor=34352f" alt="Early development" /></a>
  </p>
</div>

## See it in action

Real screenshots of the unpacked extension running on the included local showcase page.

<p align="center">
  <img src="docs/images/selection.webp" alt="Precision highlights a webpage element and places Copy and Preview controls beside the pointer" width="49%" />
  <img src="docs/images/preview.webp" alt="Precision shows the captured element in an in-page preview with Copy image, Download PNG, and Close actions" width="49%" />
</p>

## What it does

- Highlights useful DOM elements as you move the pointer.
- Lets you drag over any visible part of a page, then copy it directly or open the in-page preview and editor.
- Captures the current visible viewport in one step and opens it in the screenshot editor.
- Copies a visible element capture directly from the pointer controls, or opens an in-page preview.
- Adds pen, arrow, rectangle, text and spotlight annotations to the captured image, with color selection, undo and clear.
- Copies or saves the annotated image as PNG without changing the source webpage or opening another tab.
- Captures vertically scrolling pages, then opens the stitched image in the annotation editor in a new tab.
- Captures multiple page elements and places them as editable, movable objects on a composition canvas. Annotate the combined layout with the same pen, arrow, rectangle, text and spotlight tools; annotations are included in the exported PNG.
- Uses temporary tab access only after you invoke the extension.
- Keeps screenshots on your device and discards them when you close the preview.

Element captures include the visible pixels inside an element's bounds. Full-page capture scrolls through a vertically scrolling page and stitches the visible segments. Precision compensates for wide sticky bars at the top; fixed or sticky UI elsewhere can still repeat. Annotation tools draw on the screenshot canvas only; the source webpage is not edited. Images are processed locally, without screenshot history or cloud features.

## Install from source

Requires Node.js 22 or newer.

```sh
git clone https://github.com/20was/precision.git
cd precision
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Turn on **Developer mode** and choose **Load unpacked**.
3. Select the repository's `dist` folder.
4. Pin Precision, open a regular webpage, and choose **Start selecting**, **Select an area**, **Capture visible area**, **Capture full page**, or **Compose elements** from its toolbar popup.
5. For an area capture, drag across the visible page. Use the in-page **Copy** or **Preview** controls; Preview stays on the same webpage and offers annotation, copy, and download. For element selection, hover an element and choose **Copy** or **Preview** / press Enter.

After rebuilding, reload Precision from the extensions page and refresh the webpage. **Select an area** and **Capture visible area** capture only visible viewport pixels and use the in-page toolbar/preview. Full-page capture supports vertical scrolling only and opens the editor in a new tab. Composition mode lets you add up to 24 visible element captures, then move, resize, reorder, remove, undo, annotate, copy, or download them from its editor tab. Browser internal pages, the Chrome Web Store, PDF viewers, and file URLs do not allow capture access.

## Keyboard controls

| Key          | Action                                          |
| ------------ | ----------------------------------------------- |
| `Escape`     | Cancel selection and restore normal browsing    |
| `Enter`      | Capture the current target and open the preview |
| `Arrow Up`   | Select the nearest visible parent               |
| `Arrow Down` | Select the first visible direct child           |

In the screenshot editor, tall captures open fit to width so their content is easier to read; shorter images open fit to the whole view. Use the `−` and `+` controls to zoom, click the percentage to fit the whole image, or press `-`, `+`, and `0` from the keyboard. The image area scrolls when zoomed in; annotations stay aligned with the image.

Selection follows the pointer while the controls stay near it. When the selected element is too small, the controls move beside its bounds. The capture is limited to the visible portion of the element.

## Development

```sh
npm ci
npm run dev
```

`npm run dev` watches TypeScript files. Load `dist` as an unpacked extension, then reload it after changes. Run `npm run check` before submitting changes.

| Command                    | Purpose                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run build`            | Build the production extension into `dist`                                                |
| `npm run typecheck`        | Run strict TypeScript checks                                                              |
| `npm run lint`             | Run ESLint                                                                                |
| `npm test`                 | Run unit tests                                                                            |
| `npm run test:integration` | Run the actual-extension browser tests where Chrome, Brave, or test Chromium is available |
| `npm run screenshots`      | Rebuild the extension and regenerate the README WebP screenshots with test Chromium       |
| `npm run check`            | Typecheck, lint, unit tests, and production build                                         |

For integration tests, install Playwright Chromium with `npx playwright install chromium`. Chrome and Brave executable paths in the test configuration currently target macOS. The suite skips browser executables that are not installed; inspect [the test report](docs/test-report.md) for verified environments and cases.

The README images are generated from the real unpacked extension on [`showcase.html`](tests/fixtures/showcase.html). They contain no third-party site content.

## Privacy and permissions

Precision requests `activeTab`, `scripting`, and `clipboardWrite`. It processes screenshots locally. Full-page handoff briefly uses extension-origin IndexedDB and deletes the data when the editor consumes it. No screenshots are uploaded or kept as history. It does not request broad website access, browsing history, or download permission. See the [Privacy Policy](PRIVACY.md) and [architecture notes](docs/architecture.md) for details.

## Project notes

- [Architecture](docs/architecture.md)
- [Milestone 01 plan](docs/milestone-01.md)
- [Test report](docs/test-report.md)
- [Known limitations](docs/known-limitations.md)
- [Chrome Web Store listing draft](docs/store-listing.md)
- [Privacy Policy](PRIVACY.md)
- [Repository security settings](docs/repository-security.md)
- [MIT License](LICENSE)

Precision is in early development. Contributions and issue reports are welcome; please include browser version, operating system, and a reproducible page or test case for capture bugs. No store listing or release has been published.
