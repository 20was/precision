# Precision Privacy Policy

**Last updated: October 25, 2026**

Precision is a browser extension that captures visible webpage elements or a vertically scrolling full page when you request it.

## Information processed

When you start an element capture, Precision reads the selected element's on-screen geometry and captures the visible browser tab so it can crop the selected area. For a full-page capture, it scrolls the page in viewport-sized segments and stitches the resulting viewport images locally. Full-page images are limited to 40 megapixels and vertically scrolling pages. The result is opened in a new extension editor tab.

Full-page image data and multi-element composition packages are briefly stored in extension-origin IndexedDB as numbered chunks so large captures do not need to be placed in a URL or sent through one oversized message. The editor reads and deletes these chunks when it opens. If the editor cannot consume an interrupted transfer, the data remains local until its browser data is cleared; it is not uploaded or used as screenshot history. Screenshots and element images are also held in memory while the relevant capture/editor is open and discarded when that workflow ends.

While selection mode is active, Precision also reads pointer movement and position, your selection click, and supported keyboard commands. This input is used only to identify and confirm the target element. It is not recorded, retained, or transmitted. Selection ends when you capture or cancel.

When you choose **Copy**, the resulting image is written to your system clipboard. When you choose **Download PNG**, the image is saved through your browser's download handling. These actions happen only when you request them.

## Collection and sharing

Precision does not send webpage content, screenshots, browsing history, or personal information to the developer or any third party. It has no accounts, analytics, advertising, remote code, or cloud storage. It does not keep a screenshot history. The extension makes no network requests.

Your browser or operating system may handle clipboard contents and downloaded files under its own settings and policies.

## Permissions

- `activeTab` gives temporary access to the current tab after you invoke Precision.
- `scripting` injects the selector into that tab after you start a capture.
- `clipboardWrite` lets Precision write the image to your clipboard after you choose Copy.

Precision does not request broad website access, browsing history, persistent storage, or download permission.

## Your choices and contact

You can cancel selection with Escape or close the preview at any time. Temporary capture data is discarded when the capture ends or the preview closes. For privacy questions or vulnerability reports, contact the maintainer through the repository: <https://github.com/20was/precision>.

