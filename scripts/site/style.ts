import assert from "node:assert";

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const TITLE_STACK = '"Space Grotesk", "Avenir Next", "Segoe UI", system-ui, sans-serif';
const BODY_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CODE_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const FONT_FAMILY = "Space Grotesk";
export const FONT_FILE = "assets/fonts/SpaceGrotesk-Variable.woff2";

export const LIGHT_TOKENS = {
  bg: "#f8f5ff",
  surface: "#efe9fc",
  raised: "#e2d9f6",
  text: "#231640",
  muted: "#54447a",
  link: "#0b6b86",
  accent: "#0e7490",
  violet: "#6d3fd1",
  good: "#166534",
  bad: "#b42318",
  border: "#d3c8ee",
  borderStrong: "#7d6baa",
  primary: "#0e7490",
  onPrimary: "#ffffff",
  terminalBg: "#150c26",
  terminalBar: "#2a1b4a",
  terminalText: "#f3eeff",
  terminalMuted: "#c9bce6",
};

export const DARK_TOKENS: typeof LIGHT_TOKENS = {
  bg: "#1b1030",
  surface: "#2a1b4a",
  raised: "#38265f",
  text: "#f3eeff",
  muted: "#c9bce6",
  link: "#67e8f9",
  accent: "#22d3ee",
  violet: "#b9a5ff",
  good: "#4ade80",
  bad: "#ff9aa2",
  border: "#473070",
  borderStrong: "#8873c0",
  primary: "#22d3ee",
  onPrimary: "#1b1030",
  terminalBg: "#150c26",
  terminalBar: "#2a1b4a",
  terminalText: "#f3eeff",
  terminalMuted: "#c9bce6",
};

const LIGHT_EFFECTS = "--shadow-s: 0 1px 2px rgb(35 22 64 / 10%); --shadow-m: 0 12px 32px rgb(35 22 64 / 14%);";
const DARK_EFFECTS = "--shadow-s: 0 1px 2px rgb(0 0 0 / 40%); --shadow-m: 0 12px 32px rgb(0 0 0 / 40%);";

const SCALE_TOKENS = `--space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem; --space-5: 1.5rem; --space-6: 2.5rem; --space-7: 4rem;
  --radius-s: 0.375rem; --radius-m: 0.75rem; --radius-l: 1.25rem;
  --text-s: 0.875rem; --text-m: 1rem; --text-l: clamp(1.1rem, 1.02rem + 0.4vw, 1.3rem);
  --title-3: clamp(1.15rem, 1.08rem + 0.35vw, 1.35rem); --title-2: clamp(1.45rem, 1.2rem + 1.2vw, 2rem); --title-1: clamp(2rem, 1.3rem + 3.4vw, 3.4rem);
  --measure: 65ch; --page: 66rem;
  --font-title: ${TITLE_STACK}; --font-body: ${BODY_STACK}; --font-code: ${CODE_STACK};`;

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
    var explicit = root.getAttribute("data-theme");
    var dark = explicit === "dark" || (!explicit && !window.matchMedia("(prefers-color-scheme: light)").matches);
    var next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(key, next); } catch (error) { return; }
  });
})();`;

const EXTERNAL_ADDRESS = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const themeCss = (fontHref: string) => {
  assert(!fontHref.includes('"'), `the font address cannot hold a quote, got ${fontHref}; pass a plain relative path.`);
  assert(!fontHref.includes(")"), `the font address cannot hold a bracket, got ${fontHref}; pass a plain relative path.`);
  return `@font-face { font-family: "${FONT_FAMILY}"; src: url("${fontHref}") format("woff2"); font-weight: 300 700; font-display: swap; }
:root { color-scheme: dark; ${declarations(DARK_TOKENS)} ${DARK_EFFECTS} ${SCALE_TOKENS} }
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) { color-scheme: light; ${declarations(LIGHT_TOKENS)} ${LIGHT_EFFECTS} }
}
:root[data-theme="light"] { color-scheme: light; ${declarations(LIGHT_TOKENS)} ${LIGHT_EFFECTS} }
:root[data-theme="dark"] { color-scheme: dark; ${declarations(DARK_TOKENS)} ${DARK_EFFECTS} }
`;
};

const BASE_CSS = `* { box-sizing: border-box; }
html { background-color: var(--bg); scroll-padding-top: 5rem; }
body { margin: 0; background-color: var(--bg); color: var(--text); font-family: var(--font-body); font-size: var(--text-m); line-height: 1.6; background-image: radial-gradient(60rem 28rem at 85% -8rem, color-mix(in srgb, var(--accent) 14%, transparent), transparent); background-repeat: no-repeat; }
a { color: var(--link); text-underline-offset: 0.18em; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-s); }
.skip-link { position: absolute; left: -999px; top: 0; padding: var(--space-2) var(--space-4); background-color: var(--surface); color: var(--text); }
.skip-link:focus { left: 0; z-index: 30; }
`;

const HEADER_CSS = `.site-header { position: sticky; top: 0; z-index: 20; background-color: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
.site-header .bar, main, .footer-grid, .footer-note { max-width: var(--page); margin: 0 auto; padding: var(--space-3) var(--space-4); }
main { padding-top: var(--space-5); padding-bottom: var(--space-6); }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-5); }
.brand { display: inline-flex; align-items: center; gap: var(--space-3); font-family: var(--font-title); font-size: 1.3rem; font-weight: 700; letter-spacing: -0.02em; color: var(--text); text-decoration: none; }
.brand svg { width: 2rem; height: 2rem; flex: none; }
.bar nav { flex: 1 1 auto; }
button { font: inherit; color: var(--text); background-color: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-s); padding: var(--space-1) var(--space-3); cursor: pointer; }
button:hover { background-color: var(--raised); }
.menu { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-1) var(--space-4); }
.menu a { text-decoration: none; color: var(--muted); }
.menu a:hover { color: var(--text); text-decoration: underline; }
.menu a[aria-current="page"] { font-weight: 700; color: var(--text); }
.menu > li > a, .menu summary { display: inline-block; padding: var(--space-1) 0; }
.menu summary { cursor: pointer; color: var(--muted); }
.menu summary:hover { color: var(--text); }
.menu summary::after { content: " \\25BE"; }
.menu summary.has-current { font-weight: 700; color: var(--text); }
.menu-group { position: relative; }
.menu-group ul { list-style: none; margin: 0; padding: var(--space-2) var(--space-4); background-color: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-m); box-shadow: var(--shadow-m); position: absolute; left: 0; top: 100%; z-index: 25; min-width: 13rem; }
.menu-group li a { display: block; padding: var(--space-1) 0; }
`;

const CONTENT_CSS = `h1, h2, h3 { font-family: var(--font-title); letter-spacing: -0.02em; text-wrap: balance; }
h1 { font-size: var(--title-1); line-height: 1.08; margin: var(--space-4) 0 var(--space-3); }
h2 { font-size: var(--title-2); line-height: 1.15; margin: var(--space-6) 0 var(--space-3); padding-top: var(--space-4); border-top: 1px solid var(--border); }
h3 { font-size: var(--title-3); line-height: 1.25; margin: var(--space-5) 0 var(--space-2); }
p, li { max-width: var(--measure); }
.lead { font-size: var(--text-l); line-height: 1.5; color: var(--muted); }
.toc { background-color: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-m); padding: var(--space-2) var(--space-4); margin: var(--space-4) 0; }
.toc-title { margin: var(--space-1) 0; font-family: var(--font-title); font-weight: 700; }
.toc ol { margin: var(--space-1) 0; padding-left: 1.25rem; columns: 2 16rem; }
code { font-family: var(--font-code); font-size: 0.9em; background-color: var(--raised); padding: 0.1em 0.35em; border-radius: var(--radius-s); overflow-wrap: anywhere; }
pre { background-color: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-m); padding: var(--space-3) var(--space-4); overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; overflow-wrap: normal; }
.terminal { margin: var(--space-5) 0; border: 1px solid var(--border); border-radius: var(--radius-m); overflow: hidden; box-shadow: var(--shadow-m); background-color: var(--terminal-bg); }
.terminal figcaption { display: flex; align-items: center; gap: var(--space-3); background-color: var(--terminal-bar); color: var(--terminal-muted); font-family: var(--font-code); font-size: var(--text-s); padding: var(--space-2) var(--space-4); }
.terminal figcaption::before { content: ""; width: 0.65rem; height: 0.65rem; border-radius: 50%; background-color: #ff5f57; box-shadow: 1.1rem 0 #febc2e, 2.2rem 0 #28c840; margin-right: 2.4rem; flex: none; }
.terminal pre { background-color: var(--terminal-bg); color: var(--terminal-text); border: 0; border-radius: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.terminal pre code { color: var(--terminal-text); background: none; }
.table-scroll { overflow-x: auto; margin: var(--space-4) 0; border: 1px solid var(--border); border-radius: var(--radius-m); }
table { border-collapse: collapse; width: 100%; min-width: 28rem; }
th, td { border-bottom: 1px solid var(--border); padding: var(--space-2) var(--space-3); text-align: left; vertical-align: top; }
tr:last-child td { border-bottom: 0; }
th { background-color: var(--surface); font-family: var(--font-title); }
tbody tr:hover { background-color: color-mix(in srgb, var(--surface) 60%, transparent); }
.callout { border: 1px solid var(--border); border-left: 4px solid var(--accent); background-color: var(--surface); padding: var(--space-2) var(--space-4); margin: var(--space-4) 0; border-radius: 0 var(--radius-m) var(--radius-m) 0; }
.callout p { margin: var(--space-2) 0; }
.quote { margin: var(--space-4) 0; padding: var(--space-1) var(--space-4); border-left: 4px solid var(--violet); color: var(--muted); }
.quote footer { font-size: var(--text-s); }
.check-card { border: 1px solid var(--border); border-radius: var(--radius-m); padding: var(--space-1) var(--space-4) var(--space-3); margin: var(--space-4) 0; background-color: var(--surface); box-shadow: var(--shadow-s); }
.source { color: var(--muted); font-size: 0.9rem; }
time { white-space: nowrap; }
.tier { display: inline-block; border: 1px solid var(--border-strong); border-radius: 1rem; padding: 0 var(--space-3); font-size: var(--text-s); }
.tier-live { color: var(--good); }
.tier-waived { color: var(--bad); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: var(--space-4); margin: var(--space-5) 0; padding: 0; list-style: none; counter-reset: card; }
.cards li { position: relative; max-width: none; border: 1px solid var(--border); border-top: 3px solid var(--accent); border-radius: var(--radius-l); padding: var(--space-5); background-color: var(--surface); box-shadow: var(--shadow-s); counter-increment: card; }
.cards li:nth-child(2) { border-top-color: var(--violet); }
.cards li:nth-child(3) { border-top-color: var(--good); }
.cards li::before { content: counter(card, decimal-leading-zero); display: block; font-family: var(--font-title); font-size: var(--text-s); font-weight: 700; color: var(--muted); margin-bottom: var(--space-2); }
.cards strong { display: block; font-family: var(--font-title); font-size: var(--title-3); line-height: 1.2; margin-bottom: var(--space-2); }
`;

const HERO_CSS = `.hero { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); align-items: center; gap: var(--space-6); padding: var(--space-5) 0 var(--space-6); }
.hero h1 { margin-top: var(--space-4); }
.hero .tagline { font-family: var(--font-title); font-size: var(--title-3); font-weight: 700; color: var(--accent); margin: 0 0 var(--space-3); }
.hero-art img { display: block; width: 100%; height: auto; border-radius: var(--radius-l); box-shadow: var(--shadow-m); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin: var(--space-5) 0 0; padding: 0; list-style: none; }
.btn { display: inline-block; padding: var(--space-3) var(--space-5); border: 2px solid var(--primary); border-radius: var(--radius-m); background-color: var(--primary); color: var(--on-primary); font-family: var(--font-title); font-weight: 700; text-decoration: none; }
.btn:hover { text-decoration: none; filter: brightness(1.1); }
.btn-ghost { background-color: transparent; border-color: var(--border-strong); color: var(--text); }
.btn-ghost:hover { background-color: var(--surface); }
`;

const SELL_CSS = `.problem, .steps, .stats { display: grid; gap: var(--space-4); margin: var(--space-5) 0; padding: 0; list-style: none; }
.problem { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.steps { grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); counter-reset: step; }
.stats { grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.problem li, .steps li, .stats li { max-width: none; border: 1px solid var(--border); border-radius: var(--radius-m); padding: var(--space-4); background-color: var(--surface); }
.problem li { border-radius: var(--radius-l); padding: var(--space-5); }
.problem li:last-child { border-color: var(--good); }
.problem strong, .steps strong { display: block; font-family: var(--font-title); font-size: var(--title-3); line-height: 1.2; margin-bottom: var(--space-2); }
.steps li { counter-increment: step; }
.steps li::before { content: counter(step); display: inline-grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; background-color: var(--primary); color: var(--on-primary); font-family: var(--font-title); font-weight: 700; margin-bottom: var(--space-2); }
.stats strong { display: block; font-family: var(--font-title); font-size: var(--title-2); line-height: 1.1; color: var(--accent); }
.stats span { color: var(--muted); font-size: var(--text-s); }
.feature { border: 1px solid var(--border); border-radius: var(--radius-l); padding: var(--space-1) var(--space-5) var(--space-3); margin: var(--space-5) 0; background-color: var(--surface); box-shadow: var(--shadow-s); }
.feature h2 { margin-top: var(--space-4); padding-top: 0; border-top: 0; }
.parts { display: grid; grid-template-columns: minmax(7rem, 9rem) minmax(0, 1fr); gap: var(--space-2) var(--space-4); margin: var(--space-3) 0; }
.parts dt { font-family: var(--font-title); font-weight: 700; color: var(--accent); }
.parts dd { margin: 0; }
.parts dd ul { margin: 0; padding-left: 1.2rem; }
.diagram { margin: var(--space-5) 0; }
.diagram-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: var(--space-4); }
.diagram svg { display: block; width: 100%; height: auto; max-width: 30rem; margin: 0 auto; background-color: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-m); }
.diagram figcaption { color: var(--muted); font-size: var(--text-s); margin-top: var(--space-3); }
.diagram .source { margin: var(--space-1) 0 0; }
.dg-box, .dg-gate, .dg-human, .dg-fresh { fill: var(--surface); stroke-width: 1.5; }
.dg-box { stroke: var(--border-strong); }
.dg-gate { stroke: var(--accent); }
.dg-human { stroke: var(--good); }
.dg-fresh { stroke: var(--violet); }
.dg-text { fill: var(--text); font-family: var(--font-body); font-size: 14px; font-weight: 600; }
.dg-note { fill: var(--muted); font-family: var(--font-body); font-size: 12px; }
.dg-label { fill: var(--violet); font-family: var(--font-title); font-size: 13px; font-weight: 700; letter-spacing: 0.08em; }
.dg-arrow { fill: var(--muted); }
.dg-line { fill: none; stroke: var(--muted); stroke-width: 2; }
`;

const FOOTER_CSS = `.site-footer { border-top: 1px solid var(--border); margin-top: var(--space-7); background-color: var(--surface); color: var(--muted); }
.footer-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--space-5); padding-top: var(--space-6); }
.footer-grid p, .footer-note p { margin: var(--space-2) 0; }
.footer-title { font-family: var(--font-title); font-weight: 700; margin: 0 0 var(--space-2); color: var(--text); }
.footer-grid ul { list-style: none; margin: 0; padding: 0; }
.footer-grid li { margin: var(--space-1) 0; }
.footer-brand { display: inline-flex; align-items: center; gap: var(--space-2); font-family: var(--font-title); font-weight: 700; color: var(--text); }
.footer-brand svg { width: 1.75rem; height: 1.75rem; }
.footer-note { padding-top: 0; padding-bottom: var(--space-5); font-size: var(--text-s); }
`;

const RESPONSIVE_CSS = `@media (prefers-reduced-motion: no-preference) {
  a, button, .btn, .cards li, tbody tr { transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease; }
  .cards li:hover { box-shadow: var(--shadow-m); border-color: var(--border-strong); }
}
@media (max-width: 40rem) {
  .parts { grid-template-columns: minmax(0, 1fr); }
  .parts dd { margin-bottom: var(--space-2); }
  .feature { padding-left: var(--space-4); padding-right: var(--space-4); }
}
@media (max-width: 52rem) {
  .hero { grid-template-columns: minmax(0, 1fr); gap: var(--space-5); }
}
@media (max-width: 30rem) {
  .site-header .bar, main, .footer-grid, .footer-note { padding-left: var(--space-3); padding-right: var(--space-3); }
  .toc ol { columns: 1; }
  table { min-width: 24rem; }
}
@media (max-width: 40rem) {
  .menu-group ul { position: static; min-width: 0; margin-bottom: var(--space-2); box-shadow: none; }
  .site-header { position: static; }
  table.stacked { min-width: 0; }
  table.stacked thead { position: absolute; left: -999px; }
  table.stacked tr { display: block; border-bottom: 1px solid var(--border); padding: var(--space-2) 0; }
  table.stacked td { display: block; border: 0; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  table.stacked td:last-child { border-bottom: 0; }
  table.stacked td::before { content: attr(data-label); display: block; font-weight: 700; color: var(--muted); font-size: 0.85rem; }
}
@media print {
  .skip-link, #theme-toggle, .site-header nav, .hero-art, .actions, .footer-grid nav { display: none; }
  html, body { background: #fff; color: #000; background-image: none; }
  .site-header { position: static; backdrop-filter: none; }
  pre, .terminal, .terminal pre, .terminal figcaption, .callout, .cards li, .check-card, .feature, .problem li, .steps li, .stats li { background: #fff; color: #000; box-shadow: none; }
  .terminal figcaption::before { display: none; }
  .terminal pre code { color: #000; }
  a { color: #000; }
}
`;

export const styleSheet = (fontHref: string) => {
  assert(fontHref !== "", `the stylesheet needs the font file address, got an empty one; pass the path of the woff2 file.`);
  assert(!EXTERNAL_ADDRESS.test(fontHref), `the font loads from the site, got ${fontHref}; pass a relative path.`);
  return `\n${themeCss(fontHref)}${BASE_CSS}${HEADER_CSS}${CONTENT_CSS}${HERO_CSS}${SELL_CSS}${FOOTER_CSS}${RESPONSIVE_CSS}`;
};

export const STYLE = styleSheet(FONT_FILE);
