// Apply interface and workspace fonts app-wide on web.
//
// react-native-web stamps a hardcoded default font onto every text element, so a
// plain `body { font-family }` never cascades in — the element already has its own
// font. Instead we inject static rules that point text at CSS variables and set those
// variables live. The selectors beat both RN-web's base font and Unistyles' generated
// classes without relying on stylesheet order. Workspace prose carries `data-pworkspace`;
// code/diff/terminal surfaces carry `data-pmono`, which takes priority when nested.
const STYLE_ID = "paseo-ui-font";
const RULE = [
  ":is(#root, #overlay-root) *:not([data-pworkspace]):not([data-pworkspace] *):not([data-pmono]):not([data-pmono] *){font-family:var(--paseo-ui-font);}",
  ":is(#root, #overlay-root) [data-pworkspace]:not([data-pmono]),:is(#root, #overlay-root) [data-pworkspace] *:not([data-pmono]):not([data-pmono] *){font-family:var(--paseo-workspace-font);}",
].join("");

function sanitizeFontStack(fontStack: string): string {
  return fontStack
    .replace(/[<>{}();]/g, "")
    .replace(/[\r\n]/g, " ")
    .trim();
}

export function applyRootUiFont(uiFontStack: string, workspaceFontStack: string): void {
  if (typeof document === "undefined") return;
  // Strip anything that could break out of the CSS value; commas/quotes/spaces in a
  // font stack are fine.
  const ui = sanitizeFontStack(uiFontStack);
  const workspace = sanitizeFontStack(workspaceFontStack);
  if (ui.length === 0 || workspace.length === 0) return;

  document.documentElement.style.setProperty("--paseo-ui-font", ui);
  document.documentElement.style.setProperty("--paseo-workspace-font", workspace);

  // The rule itself is static (references the variable); inject it once.
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = RULE;
    document.head.appendChild(style);
  }
}
