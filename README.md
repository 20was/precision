# Precision

A local Chrome / Brave extension for capturing the visible part of a webpage element. Hover, select, copy or download a PNG. No accounts, uploads, analytics or screenshot history.

## Install and load

Requires Node.js 22 or newer.

```sh
npm ci
npm run build
```

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Enable **Developer mode** and choose **Load unpacked**.
3. Select this repository's `dist` folder (not the repository root).
4. Pin Precision from the browser's Extensions menu.
5. Open an ordinary HTTP/HTTPS page. Click Precision, then **Start selecting**.
6. Hover an element. A compact **Copy / Preview / Esc** control appears beside the pointer. When it would cover a small target, it sits flush beside it to keep it visible; click **Copy** for an immediate in-page copy or **Preview** / press Enter to open the image on the same webpage.
7. In the in-page preview, choose **Copy image**, **Download PNG**, or **Close**.

After rebuilding, click **Reload** on Precision's extension card and refresh the webpage to remove any old injected selector. Current build: **0.1.2**, shown in the popup.

## Selection

- **Escape** or the visible **Esc** control exits and restores browsing.
- **Arrow Up** selects the nearest visible parent.
- **Arrow Down** selects the first visible direct child. This is not arbitrary DOM traversal.
- The compact Copy control stays close to the pointer; when it would cover a small target, it sits flush beside that target. Hover continues to retarget elsewhere; only a narrow boundary around the controls is ignored for hit testing.
- Scrolling retargets the element under the pointer. Resize, navigation, tab changes and browser focus loss cancel selection.
- The outline shows only the supported visible rectangle. Captures include overlapping page content; they are not isolated DOM renders.
- Selection expires after two minutes; a pending capture times out after 15 seconds. Direct Copy requires a secure page context and clipboard access; if unavailable, use Enter to open the in-page preview and copy there.

Chrome/Brave internal pages, extension pages, the Web Store, PDF viewers and file URLs are unsupported. Use a regular webpage. Pinch zoom is unsupported; desktop browser zoom is tested at 100%, 125% and 150%.

## Development and verification

| Command                           | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `npm ci`                          | Reproduce locked dependencies                                       |
| `npm run dev`                     | Watch TypeScript; reload the extension to pick up changes           |
| `npm run build`                   | Clean production build into `dist`                                  |
| `npm run typecheck`               | Strict TypeScript checks                                            |
| `npm run lint`                    | ESLint                                                              |
| `npm test`                        | Unit tests                                                          |
| `npx playwright install chromium` | Install test Chromium                                               |
| `npm run test:integration`        | Actual-extension tests in installed Chrome, Brave and test Chromium |
| `npm run check`                   | Typecheck, lint, units, production build                            |
| `npm run format`                  | Format source and documentation                                     |

Restart `npm run dev` after editing files in `public/`. Tests use isolated disposable profiles and original production permissions. The Chrome and Brave executable paths in `tests/extension.spec.ts` target macOS; change those paths for another OS. Missing installed browsers are explicitly skipped. Tests require a modern browser implementing the DevTools extension-testing domain; the extension itself declares Chrome 120+ but older releases are not verified.

Integration tests use the documented DevTools extension action to grant real `activeTab` access, execute the actual popup Start button, and then send real mouse/keyboard events. Only the test browser gets clipboard-read permission to verify PNG readback. Production requests clipboard-write only. Tests never add broad host permissions or mock screenshots. Artifacts and detailed logs are in `test-results/`.

For a visible native-window check, run `python3 -m http.server 4173 --directory tests/fixtures`, then `node scripts/manual-browser.mjs`; use the toolbar or Option+Shift+P in the isolated Chrome for Testing window. The script saves a preview screenshot to `docs/manual-preview.png`. Close the disposable window when finished.

## Privacy and permissions

- `activeTab`: temporary access to the tab where you invoke Precision, including screenshot capture.
- `scripting`: inject the selector on request.
- `clipboardWrite`: copy PNG on an explicit button click.

No broad host access, storage, downloads permission, remote executable code or network requests. The full screenshot exists only transiently during cropping. The cropped PNG lives in the webpage's closed-shadow preview only for the current capture; closing it releases temporary image resources. There is deliberately no screenshot history.

Download uses a standard PNG link. The UI can report initiation, not completion or disk/OS failures; check browser Downloads. Filenames include a timestamp and random suffix.

See [architecture](docs/architecture.md), [milestone plan](docs/milestone-01.md), [test report](docs/test-report.md) and [known limitations](docs/known-limitations.md). Nothing has been published or submitted to a store.
