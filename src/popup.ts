import type { Result, StartMode } from "./shared/protocol";
const buttons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-mode]"),
);
const status = document.querySelector<HTMLElement>("#status")!;
for (const button of buttons) button.addEventListener("click", () => {
  void (async () => {
    for (const candidate of buttons) candidate.disabled = true;
    const mode = button.dataset.mode as StartMode;
    status.textContent = mode === "fullPage" ? "Preparing full-page capture…" : mode === "compose" ? "Starting composition…" : mode === "visible" ? "Capturing visible area…" : "Starting selection…";
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
        mode,
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
      for (const candidate of buttons) candidate.disabled = false;
    }
  })();
});
