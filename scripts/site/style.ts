import assert from "node:assert";

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const TITLE_STACK = 'Karma, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const BODY_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const CODE_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const FONT_FAMILY = "Karma";
export const FONT_FILE = "assets/fonts/Karma-Bold.woff2";

export const LIGHT_TOKENS = {
  bg: "#f6ead2",
  band: "#eddcb8",
  surface: "#fbf4e3",
  raised: "#ecdcb9",
  text: "#3a2415",
  muted: "#6b4f33",
  link: "#0b6b4a",
  accent: "#0b6b4a",
  gold: "#7a5a10",
  good: "#166534",
  bad: "#b42318",
  border: "#cdb68a",
  borderStrong: "#8a6d3b",
  primary: "#b07a0a",
  primaryTop: "#d4a02a",
  onPrimary: "#1f1208",
  terminalBg: "#1a1214",
  terminalBar: "#2e2326",
  terminalText: "#fae8d0",
  terminalMuted: "#d6c2a8",
};

export const DARK_TOKENS: typeof LIGHT_TOKENS = {
  bg: "#2a2227",
  band: "#231a1c",
  surface: "#3a2f33",
  raised: "#473a3e",
  text: "#fae8d0",
  muted: "#d6c2a8",
  link: "#34d399",
  accent: "#34d399",
  gold: "#f3dc7f",
  good: "#86efac",
  bad: "#ff8a8c",
  border: "#5c4b4f",
  borderStrong: "#a8957f",
  primary: "#e0a030",
  primaryTop: "#f3dc7f",
  onPrimary: "#2a1a10",
  terminalBg: "#1a1214",
  terminalBar: "#2e2326",
  terminalText: "#fae8d0",
  terminalMuted: "#d6c2a8",
};

const LIGHT_EFFECTS = "--shadow-s: 0 1px 2px rgb(58 36 21 / 14%); --shadow-m: 0 12px 32px rgb(58 36 21 / 20%); --glow: 0 0 0 3px rgb(11 107 74 / 30%), 0 0 22px rgb(11 107 74 / 45%);";
const DARK_EFFECTS = "--shadow-s: 0 1px 2px rgb(0 0 0 / 40%); --shadow-m: 0 12px 32px rgb(0 0 0 / 45%); --glow: 0 0 0 3px rgb(52 211 153 / 35%), 0 0 22px rgb(52 211 153 / 55%);";

const SCALE_TOKENS = `--space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem; --space-5: 1.5rem; --space-6: 2.5rem; --space-7: 4rem;
  --radius-s: 0.375rem; --radius-m: 0.75rem; --radius-l: 1.25rem;
  --text-s: 0.875rem; --text-m: 1rem; --text-l: clamp(1.1rem, 1.02rem + 0.4vw, 1.3rem);
  --title-3: clamp(1.15rem, 1.08rem + 0.35vw, 1.35rem); --title-2: clamp(1.45rem, 1.2rem + 1.2vw, 2rem); --title-1: clamp(2rem, 1.3rem + 3.4vw, 3.4rem);
  --measure: 65ch; --page: 66rem; --edge: 1px solid var(--gold);
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
  return `@font-face { font-family: "${FONT_FAMILY}"; src: url("${fontHref}") format("woff2"); font-weight: 700; font-display: swap; }
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
body { margin: 0; background-color: var(--bg); color: var(--text); font-family: var(--font-body); font-size: var(--text-m); line-height: 1.6; background-image: radial-gradient(60rem 26rem at 50% -6rem, color-mix(in srgb, var(--accent) 10%, transparent), transparent), repeating-linear-gradient(0deg, color-mix(in srgb, var(--text) 3%, transparent) 0 1px, transparent 1px 3.2rem), repeating-linear-gradient(90deg, color-mix(in srgb, var(--text) 2.5%, transparent) 0 1px, transparent 1px 6.4rem); background-repeat: no-repeat, repeat, repeat; }
a { color: var(--link); text-underline-offset: 0.18em; }
a:hover { text-decoration-thickness: 2px; }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-s); }
.skip-link { position: absolute; left: -999px; top: 0; padding: var(--space-2) var(--space-4); background-color: var(--surface); color: var(--text); }
.skip-link:focus { left: 0; z-index: 30; }
`;

const HEADER_CSS = `.site-header { position: sticky; top: 0; z-index: 20; background-color: color-mix(in srgb, var(--band) 94%, transparent); backdrop-filter: blur(10px); border-bottom: var(--edge); box-shadow: 0 3px 0 var(--band), 0 4px 0 color-mix(in srgb, var(--gold) 40%, transparent); }
.site-header .bar, main, .footer-grid, .footer-note { max-width: var(--page); margin: 0 auto; padding: var(--space-3) var(--space-4); }
main { padding-top: var(--space-5); padding-bottom: var(--space-6); }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-5); }
.brand { display: inline-flex; align-items: center; gap: var(--space-3); font-family: var(--font-title); font-size: 1.4rem; font-weight: 700; color: var(--text); text-decoration: none; }
.brand svg { width: 2.25rem; height: 2.25rem; flex: none; }
.bar nav { flex: 1 1 auto; }
button { font: inherit; color: var(--text); background-color: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-s); padding: var(--space-1) var(--space-3); cursor: pointer; }
button:hover { background-color: var(--raised); }
.menu { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-1) var(--space-4); }
.menu a { text-decoration: none; color: var(--muted); }
.menu a:hover { color: var(--text); text-decoration: underline; }
.menu a[aria-current="page"] { font-weight: 700; color: var(--gold); }
.menu > li > a, .menu summary { display: inline-block; padding: var(--space-1) 0; }
.menu summary { cursor: pointer; color: var(--muted); }
.menu summary:hover { color: var(--text); }
.menu summary::after { content: " \\25BE"; }
.menu summary.has-current { font-weight: 700; color: var(--gold); }
.menu-group { position: relative; }
.menu-group ul { list-style: none; margin: 0; padding: var(--space-2) var(--space-4); background-color: var(--surface); border: var(--edge); border-radius: var(--radius-s); box-shadow: var(--shadow-m); position: absolute; left: 0; top: 100%; z-index: 25; min-width: 13rem; }
.menu-group li a { display: block; padding: var(--space-1) 0; }
`;

const CONTENT_CSS = `h1, h2, h3 { font-family: var(--font-title); font-weight: 700; text-wrap: balance; }
h1 { font-size: var(--title-1); line-height: 1.1; margin: var(--space-4) 0 var(--space-3); }
h2 { font-size: var(--title-2); line-height: 1.15; margin: var(--space-6) 0 var(--space-4); text-align: center; }
h2::after { content: ""; display: block; width: 6rem; height: 5px; margin: var(--space-3) auto 0; border-top: var(--edge); border-bottom: var(--edge); }
h3 { font-size: var(--title-3); line-height: 1.25; margin: var(--space-5) 0 var(--space-2); }
p, li { max-width: var(--measure); }
.lead { font-size: var(--text-l); line-height: 1.5; color: var(--muted); }
.toc { background-color: var(--surface); border: 1px solid var(--border); border-top: var(--edge); border-radius: var(--radius-s); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent); padding: var(--space-2) var(--space-4); margin: var(--space-4) 0; }
.toc-title { margin: var(--space-1) 0; font-family: var(--font-title); font-weight: 700; color: var(--gold); }
.toc ol { margin: var(--space-1) 0; padding-left: 1.25rem; columns: 2 16rem; }
code { font-family: var(--font-code); font-size: 0.9em; background-color: var(--raised); padding: 0.1em 0.35em; border-radius: var(--radius-s); overflow-wrap: anywhere; }
pre { background-color: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-s); padding: var(--space-3) var(--space-4); overflow-x: auto; line-height: 1.5; }
pre code { background: none; padding: 0; overflow-wrap: normal; }
.terminal { margin: var(--space-5) 0; border: 1px solid var(--border-strong); border-radius: var(--radius-s); overflow: hidden; box-shadow: var(--shadow-m); background-color: var(--terminal-bg); }
.terminal figcaption { display: flex; align-items: center; gap: var(--space-3); background-color: var(--terminal-bar); color: var(--terminal-muted); font-family: var(--font-code); font-size: var(--text-s); padding: var(--space-2) var(--space-4); }
.terminal figcaption::before { content: ""; width: 0.65rem; height: 0.65rem; border-radius: 50%; background-color: #e94144; box-shadow: 1.1rem 0 #f3dc7f, 2.2rem 0 #34d399; margin-right: 2.4rem; flex: none; }
.terminal pre { background-color: var(--terminal-bg); color: var(--terminal-text); border: 0; border-radius: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.terminal pre code { color: var(--terminal-text); background: none; }
.table-scroll { overflow-x: auto; margin: var(--space-4) 0; border: 1px solid var(--border); border-top: var(--edge); border-radius: var(--radius-s); background-color: var(--surface); }
table { border-collapse: collapse; width: 100%; min-width: 28rem; }
th, td { border-bottom: 1px solid var(--border); padding: var(--space-2) var(--space-3); text-align: left; vertical-align: top; }
tr:last-child td { border-bottom: 0; }
th { background-color: var(--raised); font-family: var(--font-title); color: var(--gold); }
tbody tr:hover { background-color: color-mix(in srgb, var(--raised) 50%, transparent); }
.callout { border: 1px solid var(--border); border-left: 4px solid var(--accent); background-color: var(--surface); padding: var(--space-2) var(--space-4); margin: var(--space-4) 0; border-radius: 0 var(--radius-s) var(--radius-s) 0; box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 8%, transparent); }
.callout p { margin: var(--space-2) 0; }
.quote { margin: var(--space-4) 0; padding: var(--space-1) var(--space-4); border-left: 4px solid var(--gold); color: var(--muted); }
.quote footer { font-size: var(--text-s); }
.check-card, .feature, .cards li, .problem li, .steps li, .stats li { background-image: linear-gradient(180deg, color-mix(in srgb, var(--text) 5%, transparent), transparent 40%); border: 1px solid var(--border); border-top: var(--edge); border-radius: var(--radius-s); background-color: var(--surface); box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent), 0 3px 0 color-mix(in srgb, var(--band) 80%, transparent), var(--shadow-s); }
.check-card { padding: var(--space-1) var(--space-4) var(--space-3); margin: var(--space-4) 0; }
.source { color: var(--muted); font-size: 0.9rem; }
time { white-space: nowrap; }
.tier { display: inline-block; border: 1px solid var(--border-strong); border-radius: 1rem; padding: 0 var(--space-3); font-size: var(--text-s); }
.tier-live { color: var(--good); }
.tier-waived { color: var(--bad); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: var(--space-4); margin: var(--space-5) 0; padding: 0; list-style: none; counter-reset: card; }
.cards li { position: relative; max-width: none; padding: var(--space-5); counter-increment: card; }
.cards li::before { content: counter(card, decimal-leading-zero); display: block; font-family: var(--font-title); font-size: var(--text-m); font-weight: 700; color: var(--gold); margin-bottom: var(--space-2); }
.cards strong { display: block; font-family: var(--font-title); font-size: var(--title-3); line-height: 1.2; margin-bottom: var(--space-2); }
`;

const HERO_CSS = `.hero-art { position: relative; border: var(--edge); border-radius: var(--radius-s); box-shadow: 0 0 0 4px var(--bg), 0 0 0 5px color-mix(in srgb, var(--gold) 55%, transparent), var(--shadow-m); overflow: hidden; }
.hero-art img { display: block; width: 100%; height: clamp(18rem, 42vw, 29rem); object-fit: cover; }
.plate { position: absolute; top: clamp(0.75rem, 4%, 2rem); left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 1.5rem); text-align: center; padding: var(--space-3) var(--space-5); background-image: linear-gradient(180deg, color-mix(in srgb, var(--text) 8%, transparent), transparent); background-color: color-mix(in srgb, var(--surface) 94%, transparent); border: var(--edge); border-radius: var(--radius-s); box-shadow: inset 0 0 0 4px var(--surface), inset 0 0 0 5px color-mix(in srgb, var(--gold) 60%, transparent), inset 0 3px 10px rgb(0 0 0 / 25%), 0 8px 24px rgb(0 0 0 / 45%); }
.plate-title { margin: 0; max-width: none; font-family: var(--font-title); font-size: clamp(1.6rem, 1rem + 3.4vw, 3.4rem); font-weight: 700; line-height: 1.1; color: var(--text); text-shadow: 0 2px 0 color-mix(in srgb, var(--band) 70%, transparent); overflow-wrap: anywhere; }
.plate .tagline { margin: var(--space-1) 0 0; max-width: none; font-family: var(--font-title); font-size: clamp(0.95rem, 0.8rem + 0.8vw, 1.35rem); font-weight: 700; color: var(--gold); }
.hero-copy { text-align: center; padding: var(--space-5) 0 var(--space-4); }
.hero-copy h1 { margin: var(--space-3) auto var(--space-2); max-width: 22ch; }
.hero-copy p { margin-left: auto; margin-right: auto; }
.hero-copy .subline { font-family: var(--font-title); font-size: var(--title-3); font-weight: 700; color: var(--gold); margin-top: 0; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-3); margin: var(--space-5) 0 0; padding: 0; list-style: none; }
.btn { display: inline-block; padding: var(--space-3) var(--space-5); border: 1px solid color-mix(in srgb, var(--primary) 60%, #000); border-radius: var(--radius-s); background-image: linear-gradient(180deg, var(--primary-top), var(--primary)); background-color: var(--primary); color: var(--on-primary); font-family: var(--font-title); font-weight: 700; text-decoration: none; box-shadow: inset 0 1px 0 rgb(255 255 255 / 45%), 0 3px 0 color-mix(in srgb, var(--primary) 45%, #000), var(--shadow-s); }
.btn:hover, .btn:focus-visible { text-decoration: none; box-shadow: inset 0 1px 0 rgb(255 255 255 / 45%), 0 3px 0 color-mix(in srgb, var(--primary) 45%, #000), var(--glow); }
.btn-ghost { background-image: none; background-color: transparent; border: 2px solid var(--text); color: var(--text); box-shadow: none; }
.btn-ghost:hover, .btn-ghost:focus-visible { background-color: var(--surface); box-shadow: var(--glow); }
`;

const SELL_CSS = `.problem, .steps, .stats { display: grid; gap: var(--space-4); margin: var(--space-5) 0; padding: 0; list-style: none; }
.problem { grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.steps { grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); counter-reset: step; }
.stats { grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
.problem li, .steps li, .stats li { max-width: none; padding: var(--space-4); }
.problem li { padding: var(--space-5); }
.problem li:last-child { border-color: var(--accent); }
.problem strong, .steps strong { display: block; font-family: var(--font-title); font-size: var(--title-3); line-height: 1.2; margin-bottom: var(--space-2); }
.steps li { counter-increment: step; }
.steps li::before { content: counter(step); display: inline-grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; background-image: linear-gradient(180deg, var(--primary-top), var(--primary)); background-color: var(--primary); color: var(--on-primary); font-family: var(--font-title); font-weight: 700; margin-bottom: var(--space-2); }
.stats strong { display: block; font-family: var(--font-title); font-size: var(--title-2); line-height: 1.1; color: var(--gold); }
.stats span { color: var(--muted); font-size: var(--text-s); }
.feature { padding: var(--space-1) var(--space-5) var(--space-3); margin: var(--space-5) 0; }
.feature h2 { margin-top: var(--space-4); padding-top: 0; }
.parts { display: grid; grid-template-columns: minmax(7rem, 9rem) minmax(0, 1fr); gap: var(--space-2) var(--space-4); margin: var(--space-3) 0; }
.parts dt { font-family: var(--font-title); font-weight: 700; color: var(--gold); }
.parts dd { margin: 0; }
.parts dd ul { margin: 0; padding-left: 1.2rem; }
.diagram { margin: var(--space-5) 0; }
.diagram-panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: var(--space-4); }
.diagram svg { display: block; width: 100%; height: auto; max-width: 30rem; margin: 0 auto; background-color: var(--band); border: 1px solid var(--border); border-top: var(--edge); border-radius: var(--radius-s); }
.diagram figcaption { color: var(--muted); font-size: var(--text-s); margin-top: var(--space-3); }
.diagram .source { margin: var(--space-1) 0 0; }
.dg-box, .dg-gate, .dg-human, .dg-fresh { fill: var(--surface); stroke-width: 2; }
.dg-box { stroke: var(--border-strong); }
.dg-gate { stroke: var(--accent); }
.dg-human { stroke: var(--gold); }
.dg-fresh { stroke: var(--text); stroke-dasharray: 6 4; }
.dg-text { fill: var(--text); font-family: var(--font-body); font-size: 14px; font-weight: 600; }
.dg-note { fill: var(--muted); font-family: var(--font-body); font-size: 12px; }
.dg-label { fill: var(--gold); font-family: var(--font-title); font-size: 13px; font-weight: 700; letter-spacing: 0.08em; }
.dg-arrow { fill: var(--muted); }
.dg-line { fill: none; stroke: var(--muted); stroke-width: 2; }
`;

const FOOTER_CSS = `.site-footer { margin-top: var(--space-7); background-color: var(--band); background-image: linear-gradient(180deg, color-mix(in srgb, var(--text) 5%, transparent), transparent 30%); color: var(--muted); border-top: var(--edge); box-shadow: 0 -4px 0 var(--band), 0 -5px 0 color-mix(in srgb, var(--gold) 45%, transparent), 0 -9px 0 var(--bg), 0 -10px 0 color-mix(in srgb, var(--gold) 25%, transparent); }
.footer-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--space-5); padding-top: var(--space-6); }
.footer-grid p, .footer-note p { margin: var(--space-2) 0; }
.footer-title { font-family: var(--font-title); font-weight: 700; margin: 0 0 var(--space-2); color: var(--gold); }
.footer-grid ul { list-style: none; margin: 0; padding: 0; }
.footer-grid li { margin: var(--space-1) 0; }
.footer-brand { display: inline-flex; align-items: center; gap: var(--space-2); font-family: var(--font-title); font-size: 1.25rem; font-weight: 700; color: var(--text); text-decoration: none; }
.footer-brand svg, .footer-brand img { width: 1.75rem; height: 1.75rem; }
.footer-note { padding-top: 0; padding-bottom: var(--space-5); font-size: var(--text-s); }
`;

const RESPONSIVE_CSS = `@media (prefers-reduced-motion: no-preference) {
  a, button, .btn, .cards li, tbody tr { transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease; }
  .cards li:hover { box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text) 10%, transparent), var(--shadow-m); border-color: var(--border-strong); }
}
@media (max-width: 40rem) {
  .parts { grid-template-columns: minmax(0, 1fr); }
  .parts dd { margin-bottom: var(--space-2); }
  .feature { padding-left: var(--space-4); padding-right: var(--space-4); }
}
@media (max-width: 30rem) {
  .site-header .bar, main, .footer-grid, .footer-note { padding-left: var(--space-3); padding-right: var(--space-3); }
  .toc ol { columns: 1; }
  table { min-width: 24rem; }
  .plate { padding: var(--space-2) var(--space-3); }
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
  .site-header { position: static; backdrop-filter: none; box-shadow: none; }
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
