# Precision Privacy Policy

**Last updated: October 25, 2026**

Precision is a browser extension that captures the visible pixels of a webpage element selected by you.

## Information processed

When you start a capture, Precision reads the selected element's on-screen geometry and captures the visible browser tab so it can crop the selected area. The webpage content and resulting screenshot are processed locally in your browser. They are held temporarily in memory for the capture and, if you open the preview, until you close it or leave the page.

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

