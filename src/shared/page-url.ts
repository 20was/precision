/** Return whether a tab URL can host the DOM-based selector. */
export function isSupportedPageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "chromewebstore.google.com") return false;
  if (
    hostname === "chrome.google.com" &&
    (url.pathname === "/webstore" || url.pathname.startsWith("/webstore/"))
  )
    return false;

  return true;
}
