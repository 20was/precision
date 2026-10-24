import type { Result } from "./shared/protocol";
const button = document.querySelector<HTMLButtonElement>("#start")!;
const status = document.querySelector<HTMLElement>("#status")!;
button.addEventListener("click", () => {
  void (async () => {
    button.disabled = true;
    status.textContent = "Starting selection…";
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined)
        throw new Error("Open a webpage and try again.");
      const result = (await chrome.runtime.sendMessage({
        type: "start",
        tab: tab.id,
      })) as Result;
      if (!result?.ok)
        throw new Error(
          result && !result.ok
            ? result.error
            : "Could not start selection. Reload the extension and try again.",
        );
      window.close();
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : "Could not start selection.";
      status.dataset.error = "true";
      button.disabled = false;
    }
  })();
});
