import { safeSourceUrl, type WindowFrameStyle } from "./window-frame";

export interface FrameControlState {
  frameStyle: WindowFrameStyle;
  showUrl: boolean;
  showTimestamp: boolean;
}

export interface FrameControls {
  element: HTMLDivElement;
  readonly state: FrameControlState;
  attachDismiss(root: ShadowRoot): void;
  closeMenu(): void;
}

/** Consistent, non-segmented frame/export controls shared by both editors. */
export function createFrameControls(sourceUrl: string | undefined, onChange: (state: FrameControlState) => void): FrameControls {
  const state: FrameControlState = { frameStyle: "none", showUrl: false, showTimestamp: false };
  let urlPreferenceSet = false;
  const element = document.createElement("div");
  element.className = "frame-controls";
  const framePicker = document.createElement("div");
  framePicker.className = "frame-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "frame-trigger";
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", "Choose screenshot window frame");
  trigger.title = "Choose screenshot window frame";
  const windowIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  windowIcon.setAttribute("viewBox", "0 0 20 20");
  windowIcon.setAttribute("aria-hidden", "true");
  const iconFrame = document.createElementNS(windowIcon.namespaceURI, "rect");
  iconFrame.setAttribute("x", "2.5"); iconFrame.setAttribute("y", "3.5");
  iconFrame.setAttribute("width", "15"); iconFrame.setAttribute("height", "13"); iconFrame.setAttribute("rx", "2");
  windowIcon.append(iconFrame);
  const label = document.createElement("span");
  const chevron = document.createElement("span");
  chevron.className = "frame-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(windowIcon, label, chevron);
  const menu = document.createElement("div");
  menu.className = "frame-popover";
  menu.hidden = true;
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Window frame style");
  const optionButtons = new Map<WindowFrameStyle, HTMLButtonElement>();
  const frameNames: Record<WindowFrameStyle, string> = { none: "Off", mac: "Mac", windows: "Windows" };
  const closeMenu = () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };
  const sync = () => {
    label.textContent = `Frame: ${frameNames[state.frameStyle]}`;
    trigger.setAttribute("aria-label", `Screenshot frame: ${frameNames[state.frameStyle]}`);
    for (const [style, button] of optionButtons) {
      if (style === state.frameStyle) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
    urlButton.setAttribute("aria-pressed", String(state.showUrl && state.frameStyle !== "none"));
    urlButton.disabled = !safeSourceUrl(sourceUrl) || state.frameStyle === "none";
    urlButton.title = !safeSourceUrl(sourceUrl)
      ? "Source URL unavailable"
      : state.frameStyle === "none"
        ? "Choose a Mac or Windows frame to show the URL"
        : "Show page origin and path; query parameters are hidden";
    timeButton.setAttribute("aria-pressed", String(state.showTimestamp));
    onChange({ ...state });
  };
  for (const [style, text] of [["none", "No frame"], ["mac", "Mac window"], ["windows", "Windows window"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "frame-option";
    button.setAttribute("aria-label", `Frame: ${style === "none" ? "Off" : style === "mac" ? "Mac" : "Windows"}`);
    const icon = document.createElement("span");
    icon.className = `frame-option-icon ${style}`;
    icon.setAttribute("aria-hidden", "true");
    const textLabel = document.createElement("span");
    textLabel.textContent = text;
    const check = document.createElement("span");
    check.className = "frame-option-check";
    check.setAttribute("aria-hidden", "true");
    button.append(icon, textLabel, check);
    button.addEventListener("click", () => {
      const firstFrame = state.frameStyle === "none" && style !== "none";
      state.frameStyle = style;
      // Give a newly added browser frame a useful, finished titlebar by
      // default. The URL remains a live toggle, and an explicit user choice
      // (including turning it off) is always respected afterwards.
      if (firstFrame && !urlPreferenceSet && safeSourceUrl(sourceUrl)) state.showUrl = true;
      closeMenu();
      sync();
    });
    optionButtons.set(style, button);
    menu.append(button);
  }
  const urlButton = document.createElement("button");
  urlButton.type = "button";
  urlButton.className = "frame-meta-toggle";
  urlButton.textContent = "URL";
  urlButton.setAttribute("aria-label", "Show page URL in screenshot frame");
  urlButton.setAttribute("aria-pressed", "false");
  urlButton.disabled = !safeSourceUrl(sourceUrl) || state.frameStyle === "none";
  urlButton.title = !safeSourceUrl(sourceUrl) ? "Source URL unavailable" : "Choose a Mac or Windows frame to show the URL";
  urlButton.addEventListener("click", () => { urlPreferenceSet = true; state.showUrl = !state.showUrl; sync(); });
  const timeButton = document.createElement("button");
  timeButton.type = "button";
  timeButton.className = "frame-meta-toggle";
  timeButton.textContent = "Time";
  timeButton.setAttribute("aria-label", "Show capture date and time in screenshot");
  timeButton.setAttribute("aria-pressed", "false");
  timeButton.title = "Show the capture date and time, including seconds and timezone";
  timeButton.addEventListener("click", () => { state.showTimestamp = !state.showTimestamp; sync(); });
  trigger.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) optionButtons.get(state.frameStyle)?.focus();
  });
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      closeMenu();
      trigger.focus();
    }
  });
  framePicker.append(trigger, menu);
  element.append(framePicker, urlButton, timeButton);
  sync();
  return {
    element,
    state,
    closeMenu,
    attachDismiss(root) {
      root.addEventListener("click", (event) => {
        if (!element.contains(event.target as Node)) closeMenu();
      });
    },
  };
}
