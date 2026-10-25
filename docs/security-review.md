# Security and privacy review

**Review date:** 2026-10-25. Audit was performed against source and the built Manifest V3 extension, not only documentation.

## Permissions and boundaries

Manifest: [public/manifest.json](../public/manifest.json).

| Permission | Implemented use |
| --- | --- |
| `activeTab` | Temporary access to the user-invoked current tab for selection and visible screenshot capture. |
| `scripting` | Injects the selector/content script after a user action. |
| `clipboardWrite` | Writes the PNG only after the user chooses a Copy control. |

There are no host permissions, `tabs`, `storage`, `downloads`, `webRequest`, or persistent content-script declarations. Chrome documents `activeTab` as a temporary host grant following a user invocation and `captureVisibleTab` as a Tabs API screenshot operation: [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs/), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

The extension-page CSP is `script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'`. Source scanning found no `fetch`, XHR, `sendBeacon`, `eval`, `new Function`, or unsafe `innerHTML` use in application code. The bundle has no remote script, analytics, account, or upload path. `npm audit --audit-level=moderate` reported zero vulnerabilities at audit time; this does not replace future dependency monitoring.

## Message validation and lifecycle

- Worker routes check extension sender identity. Start is restricted to the popup URL; editor close is restricted to the editor URL; content messages require top frame, current session token, expected document ID, and a live tab session. See [worker.ts](../src/worker.ts#L278).
- Capture payloads validate message kind, UUID-shaped session, rectangle, viewport dimensions, finite numeric values, and size bounds in [protocol.ts](../src/shared/protocol.ts).
- Handoff IDs are generated in the worker; chunks are bounded and keyed by session in [handoff.ts](../src/shared/handoff.ts). Normal completion, close, and cancel delete handoff data. Interrupted transfers may remain in extension-origin IndexedDB until browser data is cleared; no scheduled stale-data sweeper is implemented.
- Content scripts use text content for webpage-derived labels and closed Shadow DOM for style isolation. A hostile page can still remove/cover the overlay or run earlier event handlers; Shadow DOM is not a security boundary against the page.
- A capture already in progress cannot be aborted at Chromium's screenshot API. Stale sessions are checked and their result is discarded. Full worker-restart recovery is not directly integration-tested.

## Privacy claims

[PRIVACY.md](../PRIVACY.md) describes pointer/keyboard input during selection, temporary local screenshot/image handling, IndexedDB handoff, clipboard/download behavior, permissions, and the absence of uploads/analytics/accounts. This matches reviewed code. Browsers and operating systems still control downloaded files and clipboard retention. No screenshots are retained as product history.

## Store policy check

The current Chrome Web Store policy asks for accurate privacy disclosures, narrow permissions, a clear single purpose, and full functionality discernible from the submitted MV3 code. The MV3 requirements prohibit remotely hosted executable logic. The reviewed manifest and source satisfy those implementation constraints, but the developer dashboard's data-use declarations, privacy-policy URL, screenshots, descriptions, and final certification still require owner review. See [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies/) and [MV3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements/).

## Remaining concerns

- No automated outbound-network interception was run; source/CSP review found no application network path.
- Interrupted IndexedDB handoffs have no time-based cleanup.
- This review does not certify legal compliance, Web Store acceptance, or every dependency's future security status.
