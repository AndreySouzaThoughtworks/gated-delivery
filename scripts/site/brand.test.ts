import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, main, readAssets } from "./build.ts";
import { BRAND_ASSETS, BRAND_SOURCE, FONTS_SOURCE, PNG_SIZES, SITE_URL, TAGLINE, canonicalUrl, copyBrandAssets } from "./brand.ts";
import { FONT_BUDGET_BYTES, PAGE_BUDGET_BYTES, assetFileProblems, familyProblems, fontEntryProblems, assetProblems, fontFaceProblems, fontSourceProblems, hypeProblems, metaContent, metaProblems, missingMetaProblems, pageAssetProblems, pngProblems, pngSize, themeProblems, weightProblems } from "./brand-gates.ts";
import { CONTRAST_PAIRS, contrastProblems, contrastRatio, luminance, themeTokens } from "./contrast.ts";
import { footerMarkup, headTags, layout, meta, rootPrefix } from "./html.ts";
import { DARK_TOKENS, FONT_FILE, LIGHT_TOKENS, STYLE, declarations, styleSheet } from "./style.ts";
import { loadChecks } from "./registry.ts";

const REPOSITORY = process.cwd();
const WRONG = 5 as never;
const NAV = [{ path: "index.html", label: "Home" }, { label: "Guide", items: [{ path: "a.html", label: "A" }] }];
const PAGE = { path: "a.html", title: "A", summary: "About a.", body: "<h1>A</h1>", source: "x" };
const MAXIMUM_CONTRAST = 21;
const PLANTED_DARK_MUTED = "#2b2328";
const PLANTED_WEAK_BORDER = "#f4e8d0";
const FIXTURE_ENTRIES = ["plugin", "evals", "scripts", "docs", ".github", ".claude-plugin", "tests", "LICENSE", "package.json", "AGENTS.md", "tsconfig.json", "zanity.toml", ".shellcheckrc", ".typos.toml", ".githooks", ".cursor", "zanity-baseline.json", "message-actionability-baseline.json", "assertion-effectiveness-baseline.json"];
const CRAMMED_PAGES = 40;

const throwaway = (name: string) => {
  assert(name !== "", `a throwaway folder is named for its test, got an empty name; pass a short word.`);
  const root = mkdtempSync(join(tmpdir(), `brand-${name}-`));
  assert(root.startsWith(tmpdir()), `${root} must be a throwaway under ${tmpdir()}`);
  return root;
};

const fontRoot = () => {
  const root = throwaway("fonts");
  mkdirSync(join(root, "docs-site-src"));
  cpSync(join(REPOSITORY, FONTS_SOURCE), join(root, FONTS_SOURCE), { recursive: true });
  assert(readdirSync(join(root, FONTS_SOURCE)).includes("OFL.txt"), `${root} must hold a copy of the font folder`);
  assert(readdirSync(join(root, FONTS_SOURCE)).includes("SOURCE.json"), `${root} must hold a copy of the font manifest`);
  return root;
};

const siteAssets = () => {
  const out = throwaway("assets");
  copyBrandAssets(REPOSITORY, out);
  const assets = readAssets(out);
  assert(assets.has(BRAND_ASSETS.mark), `${out} must hold the mark after the copy, got ${[...assets.keys()].join(", ")}`);
  assert(assets.has(FONT_FILE), `${out} must hold the font after the copy, got ${[...assets.keys()].join(", ")}`);
  return assets;
};

const renderedPage = (page = PAGE) => {
  const html = layout(page, NAV);
  assert(html.includes(`<title>${page.title} - gated-delivery</title>`), `the page ${page.path} must carry its title, got ${html.slice(0, 200)}`);
  assert(html.includes("<main"), `the page ${page.path} must carry a main element`);
  return html;
};

const without = (html: string, pattern: RegExp) => {
  assert(pattern.test(html), `the page must hold the part ${pattern} before it is removed`);
  assert(!pattern.flags.includes("g"), `a removal pattern matches once, got flags ${pattern.flags}`);
  return html.replace(pattern, "");
};

test("contrast maths matches the WCAG reference values", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), MAXIMUM_CONTRAST, "black on white is 21:1");
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1, "a colour on itself is 1:1");
  assert.equal(luminance("#ffffff"), 1, "white has full luminance");
  assert.equal(luminance("#000000"), 0, "black has none");
});

test("the real stylesheet meets AA in both themes", () => {
  assert.deepEqual(contrastProblems("index.html", STYLE), [], "every pair of the shipped stylesheet reaches its minimum");
  assert.deepEqual(themeProblems(new Map([["index.html", renderedPage({ ...PAGE, path: "index.html" })]])), [], "the page style passes the theme gate");
});

test("every contrast pair names tokens of both themes", () => {
  for (const { foreground, background } of CONTRAST_PAIRS) {
    for (const tokens of [LIGHT_TOKENS, DARK_TOKENS] as Record<string, string>[]) assert(foreground in tokens && background in tokens, `pair ${foreground}/${background} must name tokens of both themes`);
  }
});

test("a low contrast token is rejected with its theme, pair, ratio and fix", () => {
  const planted = styleSheet("f.woff2").replaceAll(`--muted: ${DARK_TOKENS.muted};`, `--muted: ${PLANTED_DARK_MUTED};`);
  const problems = contrastProblems("index.html", planted);
  assert.match(problems.join("\n"), /index\.html dark theme: muted text on the page .* has contrast [\d.]+:1\. Rule: WCAG AA needs at least 4\.5:1\. Fix: change the muted or bg token in scripts\/site\/style\.ts\./, `the planted muted token must fail on the dark theme, got ${JSON.stringify(problems)}`);
  assert(!problems.some((problem) => problem.includes("light theme")), `the light theme is untouched, got ${JSON.stringify(problems)}`);
});

test("a missing token and a weak control border are reported", () => {
  const missing = contrastProblems("index.html", styleSheet("f.woff2").replace(/--on-primary: #[0-9a-f]{6};/g, ""));
  assert.match(missing.join("\n"), /has no --onPrimary token in the (?:light|dark) theme/, `a removed token must be reported, got ${JSON.stringify(missing)}`);
  const weak = contrastProblems("p.html", styleSheet("f.woff2").replaceAll(`--border-strong: ${LIGHT_TOKENS.borderStrong};`, `--border-strong: ${PLANTED_WEAK_BORDER};`));
  assert.match(weak.join("\n"), /light theme: control border on the page .* Rule: WCAG AA needs at least 3:1/, `a weak control border must fail the 3:1 rule, got ${JSON.stringify(weak)}`);
});

test("dark is the default theme and an explicit choice still wins", () => {
  assert.match(STYLE, /:root \{ color-scheme: dark; --bg: #2a2227;/, "the base tokens are dark");
  assert.match(STYLE, /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme="dark"\]\) \{ color-scheme: light;/, "an OS light preference gets light unless the visitor chose dark");
  assert.match(STYLE, /:root\[data-theme="light"\] \{ color-scheme: light;/, "an explicit light choice redefines the tokens");
  assert.match(STYLE, /body \{ margin: 0; background-color: var\(--bg\); color: var\(--text\);/, "body keeps an explicit background and colour");
  assert.equal(themeTokens(STYLE, "dark").get("bg"), DARK_TOKENS.bg, "the dark block holds the dark background");
  assert.equal(themeTokens(STYLE, "light").get("onPrimary"), LIGHT_TOKENS.onPrimary, "the light block holds the light button text");
});

test("motion lives only under no-preference and focus outlines stay", () => {
  const outside = STYLE.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, "");
  assert.doesNotMatch(outside, /transition:/, "a transition outside the no-preference block would ignore reduced motion");
  assert.match(STYLE, /a:focus-visible, button:focus-visible, summary:focus-visible \{ outline: 3px solid var\(--accent\)/, "keyboard focus keeps a visible outline");
});

test("print styles stay plain", () => {
  assert.match(STYLE, /@media print \{[\s\S]*html, body \{ background: #fff; color: #000;/, "print uses black on white");
  assert.match(STYLE, /@media print \{[\s\S]*\.hero-art/, "print hides the illustration");
});

test("every page head carries icons, theme colours and the language", () => {
  const html = layout({ ...PAGE, path: "skills/a.html" }, NAV);
  assert.match(html, /<link rel="icon" href="\.\.\/assets\/brand\/favicon\.svg" type="image\/svg\+xml">/, "the svg icon links relative to the page");
  assert.match(html, /<link rel="icon" href="\.\.\/assets\/brand\/favicon-32\.png" type="image\/png" sizes="32x32">/, "the png icon is the fallback");
  assert.match(html, /<link rel="apple-touch-icon" href="\.\.\/assets\/brand\/apple-touch-icon\.png">/, "the touch icon is linked");
  assert.match(html, new RegExp(`<meta name="theme-color" content="${DARK_TOKENS.bg}" media="\\(prefers-color-scheme: dark\\)">`), "the dark theme colour is set");
  assert.match(html, new RegExp(`<meta name="theme-color" content="${LIGHT_TOKENS.bg}" media="\\(prefers-color-scheme: light\\)">`), "the light theme colour is set");
  assert.match(html, /<html lang="en">/, "the language is declared");
  assert.match(html, /@font-face \{[^}]*font-display: swap;/, "the font face swaps");
});

test("every page head carries description, canonical and card tags", () => {
  const html = layout({ ...PAGE, path: "skills/a.html" }, NAV);
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE_URL}skills/a\\.html">`), "the canonical url is built from SITE_URL");
  assert.match(html, new RegExp(`<meta property="og:image" content="${SITE_URL}${BRAND_ASSETS.socialCard}">`), "the card image is absolute");
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, "the card type is set");
  assert.match(html, /<meta name="description" content="About a\.">/, "the description comes from the page data");
  assert.equal(canonicalUrl("index.html"), SITE_URL, "the home page is the site root");
});

test("the header and footer carry the mark, the credit, the licence line and the site map", () => {
  const html = layout({ ...PAGE, path: "skills/a.html" }, NAV);
  assert.match(html, /<a class="brand" href="\.\.\/index\.html"><svg [^>]*aria-hidden="true"/, "the header links home with an inline mark");
  const footer = footerMarkup("a.html", NAV);
  assert.match(footer, /Made by <a href="https:\/\/github\.com\/andrey1souza\/gated-delivery">Andrey Souza<\/a>\. Released under the MIT licence\./, "the footer credits the author with a link and states the licence");
  assert.match(footer, new RegExp(TAGLINE), "the footer repeats the tagline");
  assert.match(footer, /<nav aria-label="Guide pages">.*<a href="a\.html">A<\/a>/, "the footer lists the pages of each group");
  assert.equal(rootPrefix("skills/a.html"), "../", "a nested page climbs one level");
});

test("the real site builds with the hero and the three cards", async () => {
  const { files, problems } = await buildSite(REPOSITORY, join(throwaway("site"), "out"), await loadChecks(REPOSITORY));
  assert.deepEqual(problems, [], "the real site passes every gate");
  const home = files.get("index.html") as string;
  assert.match(home, /<section class="hero"/, "the home page opens with the hero");
  assert.match(home, /<a class="btn" href="#install">Install<\/a>/, "the hero has the install button");
  assert.match(home, /<a class="btn btn-ghost" href="delivery-flow\.html">See how it works<\/a>/, "the hero has the second button");
  assert.match(home, new RegExp(`<p class="tagline">${TAGLINE}</p>`), "the hero shows the tagline");
  for (const card of ["Deterministic rules.", "Rules that can fail.", "Honest evidence."]) assert(home.includes(`<strong>${card}</strong>`), `the card "${card}" must stay on the home page`);
  assert(!home.includes('class="toc"'), "the landing page has no table of contents");
  assert.match(files.get("concepts.html") as string, /Harden the codebase, not the agent[\s\S]*What is not verified/, "the concepts page keeps its first and last section");
});

test("the font gate passes on the real folder and rejects a changed file", () => {
  assert.deepEqual(fontSourceProblems(REPOSITORY), [], "the shipped font matches its manifest");
  const changed = fontRoot();
  writeFileSync(join(changed, FONTS_SOURCE, "Karma-Bold.woff2"), "not the published font");
  assert.match(fontSourceProblems(changed)[0], /does not match the sha256 in SOURCE\.json\. Rule: .* Fix: download the file again/, "a changed font is rejected with a fix");
});

test("the font gate rejects a missing or foreign licence text", () => {
  const foreign = fontRoot();
  writeFileSync(join(foreign, FONTS_SOURCE, "OFL.txt"), "All rights reserved");
  assert.match(fontSourceProblems(foreign)[0], /OFL\.txt is missing or is not the SIL Open Font License 1\.1\. Rule: .* Fix: copy the full licence/, "a foreign licence is rejected");
  const absent = throwaway("nofolder");
  assert.match(fontSourceProblems(absent)[0], /docs-site-src\/fonts is missing\. Rule: .* Fix: restore the folder/, "an absent folder is rejected");
});

test("the font gate rejects a weak or missing manifest and a missing font", () => {
  const weak = fontRoot();
  writeFileSync(join(weak, FONTS_SOURCE, "SOURCE.json"), JSON.stringify({ files: [{ file: "Karma-Bold.woff2", url: "http://insecure.example", sha256: "abc" }] }));
  assert.match(fontSourceProblems(weak)[0], /has no https url and sha256 for Karma-Bold\.woff2/, "an insecure url and a short hash are rejected");
  const missing = fontRoot();
  unlinkSync(join(missing, FONTS_SOURCE, "SOURCE.json"));
  assert.match(fontSourceProblems(missing).join("\n"), /SOURCE\.json is missing\. Rule: .* Fix: add the manifest/, "a missing manifest is rejected");
  const noFont = fontRoot();
  unlinkSync(join(noFont, FONTS_SOURCE, "Karma-Bold.woff2"));
  assert.match(fontSourceProblems(noFont)[0], /holds no \.woff2 file\. Rule: .* Fix: add the font file/, "a folder with no font is rejected");
});

test("the font gate rejects fonts over the budget", () => {
  const heavy = fontRoot();
  writeFileSync(join(heavy, FONTS_SOURCE, "big.bin"), Buffer.alloc(FONT_BUDGET_BYTES));
  assert.match(fontSourceProblems(heavy).join("\n"), /weighs \d+ bytes, over the budget of 204800\. Rule: .* Fix: subset the font/, "an oversized font folder is rejected with a fix");
});

test("font-display swap is required on every font face", () => {
  const page = renderedPage();
  assert.deepEqual(fontFaceProblems("a.html", page), [], "the shipped page swaps");
  assert.match(fontFaceProblems("a.html", page.replace("font-display: swap;", "font-display: block;"))[0], /a\.html has an @font-face without font-display: swap\. Rule: .* Fix: add font-display: swap/, "a blocking face is rejected");
  assert.match(fontFaceProblems("a.html", "<style>p {}</style>")[0], /declares no @font-face/, "a page with no face is rejected");
});

test("png sizes come from the header bytes", () => {
  const assets = siteAssets();
  assert.deepEqual(pngProblems(assets), [], "the shipped icons have their documented sizes");
  for (const [path, size] of Object.entries(PNG_SIZES)) assert.deepEqual(pngSize(assets.get(path) as Buffer), size, `${path} must have its documented size`);
  assert.equal(pngSize(Buffer.from("not a png at all, but long enough to hold a header")), null, "text is not a png");
});

test("a wrong png size and a non png are rejected", () => {
  const assets = siteAssets();
  const wrong = new Map(assets);
  wrong.set(BRAND_ASSETS.appleTouchIcon, assets.get(BRAND_ASSETS.faviconPng) as Buffer);
  assert.match(pngProblems(wrong).join("\n"), /apple-touch-icon\.png is 32x32, not 180x180\. Rule: .* Fix: render the file again at 180x180/, "a 32 pixel file in the touch icon slot is rejected");
  wrong.set(BRAND_ASSETS.socialCard, Buffer.from("text"));
  assert.match(pngProblems(wrong).join("\n"), /og-card\.png is not a png, not 1200x630/, "text in the card slot is rejected");
});

test("the asset gate passes the real assets and rejects a missing one", () => {
  const assets = siteAssets();
  assert.deepEqual(assetProblems(new Map([["index.html", renderedPage({ ...PAGE, path: "index.html" })]]), assets), [], "the shipped site holds every asset it references");
  const missing = new Map(assets);
  missing.delete(BRAND_ASSETS.hero);
  assert.match(assetFileProblems(missing).join("\n"), /hero-scene\.svg is missing from the built site\. Rule: .* Fix: restore the file/, "a missing hero is rejected");
});

test("the asset gate rejects an unnamed and a broken svg", () => {
  const assets = siteAssets();
  const unnamed = new Map(assets);
  unnamed.set(BRAND_ASSETS.mark, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'));
  assert.match(assetFileProblems(unnamed).join("\n"), /mark\.svg has no <title> or aria-label\. Rule: .* Fix: add a <title>/, "an svg with no name is rejected");
  const broken = new Map(assets);
  broken.set(BRAND_ASSETS.favicon, Buffer.from("<svg><title>t</title><g></svg>"));
  assert.match(assetFileProblems(broken).join("\n"), /favicon\.svg is not well formed svg/, "an svg with an open group is rejected");
});

test("the asset gate rejects a dead reference in markup and in css", () => {
  const assets = siteAssets();
  const dead = new Map([["index.html", `<img src="assets/brand/nope.png" alt="">`]]);
  assert.match(pageAssetProblems(dead, assets).join("\n"), /index\.html:1 references assets\/brand\/nope\.png, which the site does not hold\. Rule: .* Fix: add the file/, "a dead image path is rejected");
  const cssDead = new Map([["index.html", `<style>a { background: url("assets/missing.woff2"); }</style>`]]);
  assert.match(pageAssetProblems(cssDead, assets).join("\n"), /references assets\/missing\.woff2/, "a dead css url is rejected");
});

test("the asset gate rejects an unnamed inline svg and accepts the three ways to name one", () => {
  const assets = siteAssets();
  const bare = new Map([["index.html", `<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`]]);
  assert.match(pageAssetProblems(bare, assets).join("\n"), /inline svg with no <title>, aria-label or aria-hidden\. Rule: .* Fix: add aria-hidden/, "an unnamed inline svg is rejected");
  const named = new Map([["index.html", `<svg aria-hidden="true"><path d="M0 0"/></svg><svg aria-label="x"></svg><svg><title>t</title></svg>`]]);
  assert.deepEqual(pageAssetProblems(named, assets), [], "hidden, labelled and titled svgs pass");
});

test("the meta gate accepts distinct pages and rejects a repeated title or description", () => {
  const first = renderedPage({ ...PAGE, path: "a.html" });
  const second = renderedPage({ ...PAGE, path: "b.html", title: "B", summary: "About b." });
  assert.deepEqual(metaProblems(new Map([["a.html", first], ["b.html", second]])), [], "two distinct pages pass");
  const sameTitle = metaProblems(new Map([["a.html", first], ["b.html", renderedPage({ ...PAGE, path: "b.html", summary: "About b." })]]));
  assert.match(sameTitle.join("\n"), /b\.html repeats the title of a\.html\. Rule: titles are unique\. Fix: rename one page/, "a repeated title is rejected");
  const sameDescription = metaProblems(new Map([["a.html", first], ["b.html", renderedPage({ ...PAGE, path: "b.html", title: "B" })]]));
  assert.match(sameDescription.join("\n"), /b\.html repeats the description of a\.html\. Rule: descriptions are unique\. Fix: write a summary/, "a repeated description is rejected");
});

test("the meta gate rejects a missing canonical, title, description or theme colour", () => {
  const first = renderedPage({ ...PAGE, path: "a.html" });
  assert.match(missingMetaProblems("a.html", without(first, /<link rel="canonical"[^>]*>/)).join("\n"), /has the canonical url none, not https:\/\/andrey1souza\.github\.io\/gated-delivery\/a\.html/, "a missing canonical is rejected");
  assert.match(metaProblems(new Map([["a.html", without(first, /<title>[^<]*<\/title>/)]])).join("\n"), /a\.html has no title\. Rule: every page has a title/, "a missing title is rejected");
  assert.match(missingMetaProblems("a.html", without(first, /<meta name="description"[^>]*>/)).join("\n"), /has no description meta tag/, "a missing description is rejected");
  assert.match(missingMetaProblems("a.html", without(first, /<meta name="theme-color"[^>]*dark\)">/)).join("\n"), /has fewer than 2 theme-color tags/, "one theme colour is not enough");
});

test("the meta gate rejects missing Open Graph and card tags", () => {
  const first = renderedPage({ ...PAGE, path: "a.html" });
  assert.match(missingMetaProblems("a.html", without(first, /<meta property="og:title"[^>]*>/)).join("\n"), /has no og:title meta tag\. Rule: .* Fix: write the tag in headTags/, "a missing og:title is rejected");
  assert.match(missingMetaProblems("a.html", without(first, /<meta name="twitter:card"[^>]*>/)).join("\n"), /has no twitter:card meta tag/, "a missing card type is rejected");
  const noImage = missingMetaProblems("a.html", without(first, /<meta property="og:image" [^>]*>/)).join("\n");
  assert.match(noImage, /has no og:image meta tag/, "a missing og:image is rejected");
  assert.match(noImage, /has an og:image that does not start with/, "an absent image is not an absolute url on the site");
});

test("the weight gate rejects a heavy page", () => {
  const assets = new Map([["assets/fonts/a.woff2", Buffer.alloc(1)]]);
  assert.deepEqual(weightProblems(new Map([["a.html", "x"]]), assets), [], "a light page passes");
  const heavy = weightProblems(new Map([["a.html", "x".repeat(PAGE_BUDGET_BYTES + 1)]]), assets);
  assert.match(heavy[0], /a\.html weighs \d+ bytes of html and css, over the budget of 81920\. Rule: pages stay light\. Fix: trim the css/, "a heavy page is rejected with a fix");
});

test("the weight gate rejects a heavy total", () => {
  const assets = new Map([["assets/fonts/a.woff2", Buffer.alloc(1)]]);
  const crowded = new Map(Array.from({ length: CRAMMED_PAGES }, (_, index) => [`p${index}.html`, "x".repeat(PAGE_BUDGET_BYTES)] as [string, string]));
  assert.match(weightProblems(crowded, assets).join("\n"), /the pages and fonts weigh \d+ bytes together, over the budget of \d+\. Rule: .* Fix: trim pages or fonts\./, "a heavy total is rejected with a fix");
});

test("the hype gate names the line and the word", () => {
  const text = "<p>Fine line.</p>\n<p>A seamless install.</p>\n<p>Our cutting-edge tool and a World-Class result.</p>";
  const problems = hypeProblems("index.html", text);
  assert.equal(problems.length, 3, `three hype words sit in the text, got ${JSON.stringify(problems)}`);
  assert.match(problems[0], /^index\.html:2 uses the hype word "seamless": <p>A seamless install\.<\/p>\. Rule: copy states facts, not marketing claims\. Fix: replace it with a number/, "the first hit names its line, word, rule and fix");
  assert.match(problems[1], /^index\.html:3 .*"cutting-edge"/, "a hyphenated phrase is found");
  assert.match(hypeProblems("README.md", "Gain 10x speed.")[0], /README\.md:1 uses the hype word "10x"/, "the multiplier claim is found in the readme");
});

test("the hype gate spares longer words, quotations and terminal output", () => {
  assert.deepEqual(hypeProblems("README.md", "A seamlessly-named file, 10 times and 100x, plain words."), [], "a longer word and other numbers stay clean");
  const spared = `<blockquote class="quote" data-source="s">\n<p>seamless</p></blockquote><figure class="terminal"><pre>unleash</pre></figure>`;
  assert.deepEqual(hypeProblems("a.html", spared), [], "source quotes and script output are not copy");
});

test("the build fails on planted hype in a fragment", async () => {
  const root = throwaway("hype");
  for (const name of FIXTURE_ENTRIES) symlinkSync(join(REPOSITORY, name), join(root, name));
  cpSync(join(REPOSITORY, "docs-site-src"), join(root, "docs-site-src"), { recursive: true });
  const home = join(root, "docs-site-src", "home.html");
  writeFileSync(home, `${readFileSync(home, "utf8")}\n<p>A seamless way to ship.</p>\n`);
  const { problems } = await buildSite(root, join(root, "docs-site"), await loadChecks(REPOSITORY));
  assert.match(problems.join("\n"), /index\.html:\d+ uses the hype word "seamless".* Fix: replace it with/, `the planted hype must fail the build, got ${JSON.stringify(problems)}`);
});

test("the build copies every brand asset and the font into the site", () => {
  const assets = siteAssets();
  const expected = [...Object.values(BRAND_ASSETS), FONT_FILE, "assets/fonts/OFL.txt", "assets/fonts/SOURCE.json", "assets/brand/mark-mono.svg", "assets/brand/mark-mono-light.svg"];
  assert.deepEqual(expected.filter((path) => !assets.has(path)), [], "every brand asset and the licence ship with the site");
  const published = [...assets.keys()].filter((path) => path.endsWith(".html"));
  assert.deepEqual(published, [], "the social card source is not published");
});

test("the command line passes every brand gate on the real repository", async () => {
  const code = await main(["--check"], REPOSITORY, loadChecks);
  assert.equal(code, 0, "the real site builds with no problem");
});

const GUARDS: [label: string, call: () => unknown, message: RegExp][] = [
  ["luminance rejects a short colour", () => luminance("#fff"), /a colour is #rrggbb/],
  ["luminance rejects a non-string", () => luminance(WRONG), /a colour is text/],
  ["contrastRatio rejects a non-string foreground", () => contrastRatio(WRONG, "#ffffff"), /foreground colour is text/],
  ["contrastRatio rejects a non-string background", () => contrastRatio("#ffffff", WRONG), /background colour is text/],
  ["themeTokens rejects non-string css", () => themeTokens(WRONG, "dark"), /css text/],
  ["themeTokens rejects an unknown theme", () => themeTokens("", "sepia" as never), /light or dark/],
  ["themeTokens rejects css with no theme block", () => themeTokens("a {}", "dark"), /has no :root\[data-theme="dark"\] block/],
  ["contrastProblems rejects an empty file name", () => contrastProblems("", STYLE), /names the page/],
  ["contrastProblems rejects no pairs", () => contrastProblems("a.html", STYLE, []), /needs token pairs/],
  ["styleSheet rejects an empty font address", () => styleSheet(""), /needs the font file address/],
  ["styleSheet rejects a quote in the font address", () => styleSheet('a"b'), /cannot hold a quote/],
  ["styleSheet rejects a bracket in the font address", () => styleSheet("a)b"), /cannot hold a bracket/],
  ["styleSheet rejects an external font address", () => styleSheet("https://fonts.example/f.woff2"), /loads from the site/],
  ["declarations still rejects a non-hex colour", () => declarations({ bg: "red" } as never), /must be a hex colour/],
  ["canonicalUrl rejects a non-html path", () => canonicalUrl("a.txt"), /must end in \.html/],
  ["canonicalUrl rejects a leading slash", () => canonicalUrl("/a.html"), /relative to the site root/],
  ["copyBrandAssets rejects a root without brand files", () => copyBrandAssets(throwaway("nobrand"), throwaway("out")), new RegExp(`${BRAND_SOURCE} is missing`)],
  ["copyBrandAssets rejects a root without fonts", () => {
    const root = throwaway("nofonts");
    mkdirSync(join(root, BRAND_SOURCE), { recursive: true });
    copyBrandAssets(root, throwaway("out"));
  }, new RegExp(`${FONTS_SOURCE} is missing`)],
  ["headTags rejects an empty title", () => headTags({ ...PAGE, title: "" }, ""), /needs a title and a description/],
  ["headTags rejects a prefix without a slash", () => headTags(PAGE, "up"), /ends with a slash/],
  ["headTags rejects an empty description", () => headTags({ ...PAGE, summary: "" }, ""), /needs a title and a description/],
  ["footerMarkup rejects an empty menu", () => footerMarkup("a.html", []), /footer needs navigation links/],
  ["footerMarkup rejects a non-html path", () => footerMarkup("a.txt", NAV), /must end in \.html/],
  ["rootPrefix rejects a leading slash", () => rootPrefix("/a.html"), /relative to the site root/],
  ["rootPrefix rejects an empty path", () => rootPrefix(""), /names a page/],
  ["readAssets rejects an absent folder", () => readAssets(join(tmpdir(), "brand-absent-site")), /must exist to read its assets/],
  ["readAssets rejects a folder with no assets", () => readAssets(throwaway("noassets")), /holds no assets\/ folder/],
  ["pngSize rejects a non-buffer", () => pngSize(WRONG), /read as bytes/],
  ["pngSize rejects an empty file", () => pngSize(Buffer.alloc(0)), /needs bytes/],
  ["fontSourceProblems rejects an absent root", () => fontSourceProblems(join(tmpdir(), "brand-absent-root")), /reads under the repository root/],
  ["fontSourceProblems rejects a file as the root", () => fontSourceProblems(join(REPOSITORY, "package.json")), /reads under a folder/],
  ["fontFaceProblems rejects an empty file name", () => fontFaceProblems("", ""), /needs a file name/],
  ["fontFaceProblems rejects non-string html", () => fontFaceProblems("a.html", WRONG), /must be html text/],
  ["assetFileProblems rejects a non-Map", () => assetFileProblems(WRONG), /Map of path to bytes/],
  ["assetFileProblems rejects an empty Map", () => assetFileProblems(new Map()), /holds no asset/],
  ["pngProblems rejects a non-Map", () => pngProblems(WRONG), /Map of path to bytes/],
  ["pngProblems rejects an empty Map", () => pngProblems(new Map()), /holds no asset/],
  ["pageAssetProblems rejects a non-Map of files", () => pageAssetProblems(WRONG, new Map()), /Map of path to html/],
  ["pageAssetProblems rejects a non-Map of assets", () => pageAssetProblems(new Map(), WRONG), /Map of path to bytes/],
  ["assetProblems rejects a non-Map of files", () => assetProblems(WRONG, new Map()), /Map of path to html/],
  ["assetProblems rejects a non-Map of assets", () => assetProblems(new Map(), WRONG), /Map of path to bytes/],
  ["a page with a bad path cannot list references", () => pageAssetProblems(new Map([["a.txt", ""]]), new Map()), /ends in \.html/],
  ["a page with a non-string body cannot list references", () => pageAssetProblems(new Map([["a.html", WRONG]]), new Map()), /must be html text/],
  ["missingMetaProblems rejects an empty file name", () => missingMetaProblems("", ""), /needs a file name/],
  ["missingMetaProblems rejects non-string html", () => missingMetaProblems("a.html", WRONG), /must be html text/],
  ["metaProblems rejects a non-Map", () => metaProblems(WRONG), /Map of path to html/],
  ["metaProblems rejects an empty Map", () => metaProblems(new Map()), /needs pages/],
  ["weightProblems rejects a non-Map of files", () => weightProblems(WRONG, new Map()), /Map of path to html/],
  ["weightProblems rejects a non-Map of assets", () => weightProblems(new Map(), WRONG), /Map of path to bytes/],
  ["themeProblems rejects a non-Map", () => themeProblems(WRONG), /Map of path to html/],
  ["themeProblems rejects an empty Map", () => themeProblems(new Map()), /needs pages/],
  ["hypeProblems rejects an empty file name", () => hypeProblems("", "x"), /needs a file name/],
  ["hypeProblems rejects non-string text", () => hypeProblems("a.md", WRONG), /must be text/],
  ["metaContent rejects an unknown attribute", () => metaContent("", "id", "x"), /found by name or property/],
  ["metaContent rejects an empty name", () => metaContent("", "name", ""), /needs the tag name/],
  ["meta rejects an unknown attribute", () => meta("id", "x", "y"), /keyed by name or property/],
  ["meta rejects empty content", () => meta("name", "x", ""), /needs content/],
  ["throwaway rejects an empty name", () => throwaway(""), /named for its test/],
];

for (const [label, call, message] of GUARDS) {
  test(`guard: ${label}`, () => {
    assert.throws(call, message, `${label} must fail with a message that matches ${message}`);
  });
}

const HERO_SCENE_BUDGET_BYTES = 40 * 1024;
const HERO_SCENE_FILE = join(REPOSITORY, BRAND_SOURCE, "hero-scene.svg");

test("the font gate rejects a manifest that names another family", () => {
  const foreign = fontRoot();
  const manifestPath = join(foreign, FONTS_SOURCE, "SOURCE.json");
  writeFileSync(manifestPath, readFileSync(manifestPath, "utf8").replace('"family": "Karma"', '"family": "Space Grotesk"'));
  assert.match(fontSourceProblems(foreign).join("\n"), /names the family "Space Grotesk", not "Karma"\. Rule: .* Fix: set "family" to Karma/, "a manifest for another family is rejected");
  assert.deepEqual(fontSourceProblems(fontRoot()), [], "the untouched copy passes");
});

test("the hero scene is a named, light, scalable svg whose motion respects the visitor", () => {
  const scene = readFileSync(HERO_SCENE_FILE, "utf8");
  assert(Buffer.byteLength(scene) < HERO_SCENE_BUDGET_BYTES, `the hero scene must stay under ${HERO_SCENE_BUDGET_BYTES} bytes, got ${Buffer.byteLength(scene)}`);
  assert.match(scene, /viewBox="0 0 1600 700" preserveAspectRatio="xMidYMid slice"/, "the scene crops instead of letterboxing");
  assert.match(scene, /<title id="scene-title">[^<]+<\/title>/, "the scene has a title");
  assert.match(scene, /<desc id="scene-desc">[^<]+<\/desc>/, "the scene has a description");
  assert.match(scene, /@media \(prefers-reduced-motion: no-preference\) \{[^@]*animation:/, "the drift runs only when motion is allowed");
  assert.doesNotMatch(scene.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/, ""), /animation:/, "no animation sits outside the motion query");
});

test("the home hero holds the scene, the title plate and one lockup", async () => {
  const { files } = await buildSite(REPOSITORY, join(throwaway("hero"), "out"), await loadChecks(REPOSITORY));
  const home = files.get("index.html") as string;
  assert.match(home, /<img src="assets\/brand\/hero-scene\.svg" alt="[^"]{40,}"/, "the scene has a descriptive alt text");
  assert.match(home, /<div class="plate"><p class="plate-title">gated-delivery<\/p>/, "the plate carries the wordmark");
  assert.equal(home.match(/class="brand"/g)?.length, 1, "the home page keeps one brand lockup");
  assert.match(home, /<p class="subline">Open the gate\. Keep only what proves itself\.<\/p>/, "the headline has one thematic subline");
});

test("the font entry and family checks reject bad input with a fix", () => {
  assert.throws(() => fontEntryProblems(join(throwaway("none"), "absent"), "Karma-Bold.woff2", {}), /reads under .* got none; pass the font folder/, "a missing folder is rejected");
  assert.throws(() => fontEntryProblems(REPOSITORY, "", {}), /names a file, got an empty name; pass the font file name/, "an empty font name is rejected");
  assert.throws(() => familyProblems(WRONG), /the family is text, got number; write the family name as a string in SOURCE\.json/, "a numeric family is rejected");
  assert.throws(() => familyProblems("  "), /names a font, got a blank one; write the family name in SOURCE\.json/, "a blank family is rejected");
  assert.deepEqual(familyProblems("Karma"), [], "the shipped family passes");
  assert.match(familyProblems(undefined)[0], /names the family "none", not "Karma"/, "a missing family is reported");
});
