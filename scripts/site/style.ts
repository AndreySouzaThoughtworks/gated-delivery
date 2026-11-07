import assert from "node:assert";

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

const LIGHT_TOKENS = {
  bg: "#ffffff",
  surface: "#f3f5f8",
  text: "#1a1d23",
  muted: "#4b5563",
  link: "#0b5cad",
  border: "#c9d1dc",
  accent: "#0b5cad",
  good: "#146c2e",
  bad: "#a4262c",
  terminalBg: "#14181f",
  terminalText: "#e6e9ef",
};

const DARK_TOKENS: typeof LIGHT_TOKENS = {
  bg: "#12151b",
  surface: "#1b2029",
  text: "#e6e9ef",
  muted: "#aab3c2",
  link: "#8bbcff",
  border: "#3a4352",
  accent: "#8bbcff",
  good: "#6fd08a",
  bad: "#ff8b91",
  terminalBg: "#0b0d11",
  terminalText: "#e6e9ef",
};

export const declarations = (tokens: typeof LIGHT_TOKENS) => {
  assert(Object.keys(tokens).length > 0, `a theme needs at least one token, got none; pass the token map.`);
  assert(Object.values(tokens).every((value) => HEX_COLOUR.test(value)), `every token must be a hex colour, got ${JSON.stringify(Object.values(tokens))}; write #rrggbb values.`);
  return Object.entries(tokens)
    .map(([token, value]) => `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`)
    .join(" ");
};

export const THEME_STORAGE_KEY = "gated-delivery-theme";

export const THEME_SCRIPT = `(function () {
  var root = document.documentElement;
  var key = "${THEME_STORAGE_KEY}";
  var saved = null;
  try { saved = localStorage.getItem(key); } catch (error) { saved = null; }
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  var button = document.getElementById("theme-toggle");
  if (!button) return;
  button.addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") === "dark" || (!root.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(key, next); } catch (error) { return; }
  });
})();`;

export const STYLE = `
:root { color-scheme: light dark; ${declarations(LIGHT_TOKENS)} }
:root[data-theme="light"] { color-scheme: light; ${declarations(LIGHT_TOKENS)} }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { ${declarations(DARK_TOKENS)} }
}
:root[data-theme="dark"] { color-scheme: dark; ${declarations(DARK_TOKENS)} }
* { box-sizing: border-box; }
html { background-color: var(--bg); }
body { margin: 0; background-color: var(--bg); color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; }
a { color: var(--link); }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.skip-link { position: absolute; left: -999px; top: 0; padding: 0.5rem 1rem; background-color: var(--surface); color: var(--text); }
.skip-link:focus { left: 0; z-index: 10; }
.site-header, main, .site-footer { max-width: 56rem; margin: 0 auto; padding: 1rem; }
.site-header { border-bottom: 1px solid var(--border); }
.bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.brand { font-size: 1.25rem; font-weight: 700; color: var(--text); text-decoration: none; }
button { font: inherit; color: var(--text); background-color: var(--surface); border: 1px solid var(--border); border-radius: 0.4rem; padding: 0.3rem 0.8rem; cursor: pointer; }
.menu { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
.menu { align-items: flex-start; }
.menu a[aria-current="page"] { font-weight: 700; color: var(--text); }
.menu > li > a, .menu summary { display: inline-block; padding: 0.3rem 0; }
.menu summary { cursor: pointer; color: var(--link); }
.menu summary::after { content: " \\25BE"; }
.menu summary.has-current { font-weight: 700; color: var(--text); }
.menu-group { position: relative; }
.menu-group ul { list-style: none; margin: 0; padding: 0.25rem 0.75rem; background-color: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; position: absolute; left: 0; top: 100%; z-index: 5; min-width: 12rem; }
.menu-group li a { display: block; padding: 0.3rem 0; }
h1 { font-size: 2rem; line-height: 1.2; margin: 1rem 0 0.5rem; }
h2 { font-size: 1.5rem; margin: 2.5rem 0 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
h3 { font-size: 1.15rem; margin: 1.5rem 0 0.25rem; }
p, li { max-width: 46rem; }
.lead { font-size: 1.15rem; color: var(--muted); }
.toc { background-color: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.5rem 1rem; margin: 1rem 0; }
.toc-title { margin: 0.25rem 0; font-weight: 700; }
.toc ol { margin: 0.25rem 0; padding-left: 1.25rem; columns: 2 16rem; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; background-color: var(--surface); padding: 0.1em 0.3em; border-radius: 0.25rem; overflow-wrap: anywhere; }
pre { background-color: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem 1rem; overflow-x: auto; line-height: 1.45; }
pre code { background: none; padding: 0; overflow-wrap: normal; }
.terminal { margin: 1.5rem 0; }
.terminal figcaption { color: var(--muted); font-size: 0.9rem; margin-bottom: 0.25rem; }
.terminal pre { background-color: var(--terminal-bg); color: var(--terminal-text); border-color: var(--border); margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.terminal pre code { color: var(--terminal-text); }
.table-scroll { overflow-x: auto; margin: 1rem 0; }
table { border-collapse: collapse; width: 100%; min-width: 28rem; }
th, td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
th { background-color: var(--surface); }
.callout { border-left: 4px solid var(--accent); background-color: var(--surface); padding: 0.5rem 1rem; margin: 1rem 0; border-radius: 0 0.5rem 0.5rem 0; }
.callout p { margin: 0.4rem 0; }
.quote { margin: 1rem 0; padding: 0.25rem 1rem; border-left: 4px solid var(--border); color: var(--muted); }
.quote footer { font-size: 0.85rem; }
.check-card { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.25rem 1rem 0.75rem; margin: 1rem 0; background-color: var(--surface); }
.source { color: var(--muted); font-size: 0.9rem; }
time { white-space: nowrap; }
.tier { display: inline-block; border: 1px solid var(--border); border-radius: 1rem; padding: 0 0.6rem; font-size: 0.85rem; }
.tier-live { color: var(--good); }
.tier-waived { color: var(--bad); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; margin: 1rem 0; padding: 0; list-style: none; }
.cards li { border: 1px solid var(--border); border-radius: 0.5rem; padding: 0.75rem 1rem; background-color: var(--surface); }
.site-footer { border-top: 1px solid var(--border); margin-top: 3rem; color: var(--muted); }
@media (max-width: 30rem) {
  h1 { font-size: 1.6rem; }
  h2 { font-size: 1.3rem; }
  .site-header, main, .site-footer { padding: 0.75rem; }
  .toc ol { columns: 1; }
  table { min-width: 24rem; }
}
@media (max-width: 40rem) {
  .menu-group ul { position: static; min-width: 0; margin-bottom: 0.5rem; }
  table.stacked { min-width: 0; }
  table.stacked thead { position: absolute; left: -999px; }
  table.stacked tr { display: block; border: 1px solid var(--border); border-radius: 0.5rem; margin-bottom: 0.75rem; }
  table.stacked td { display: block; border: 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  table.stacked td:last-child { border-bottom: 0; }
  table.stacked td::before { content: attr(data-label); display: block; font-weight: 700; color: var(--muted); font-size: 0.85rem; }
}
@media print {
  .skip-link, #theme-toggle { display: none; }
}
`;
