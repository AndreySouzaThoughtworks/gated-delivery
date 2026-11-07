import assert from "node:assert";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SITE_URL = "https://andrey1souza.github.io/gated-delivery/";
export const SITE_NAME = "gated-delivery";
export const TAGLINE = "Gate it. Slice it. Prove it.";
export const AUTHOR_NAME = "Andrey Souza";
export const LICENCE_LINE = "Released under the MIT licence.";
export const BRAND_SOURCE = "docs-site-src/brand";
export const FONTS_SOURCE = "docs-site-src/fonts";
export const ASSETS_DIRECTORY = "assets";
export const BRAND_DIRECTORY = `${ASSETS_DIRECTORY}/brand`;
export const FONTS_DIRECTORY = `${ASSETS_DIRECTORY}/fonts`;
export const SOCIAL_CARD_SOURCE = "og-card.html";

export const BRAND_ASSETS = {
  mark: `${BRAND_DIRECTORY}/mark.svg`,
  favicon: `${BRAND_DIRECTORY}/favicon.svg`,
  faviconPng: `${BRAND_DIRECTORY}/favicon-32.png`,
  appleTouchIcon: `${BRAND_DIRECTORY}/apple-touch-icon.png`,
  socialCard: `${BRAND_DIRECTORY}/og-card.png`,
  hero: `${BRAND_DIRECTORY}/hero-illustration.svg`,
};

export type PngSize = { width: number; height: number };
export const PNG_SIZES: Record<string, PngSize> = {
  [BRAND_ASSETS.faviconPng]: { width: 32, height: 32 },
  [BRAND_ASSETS.appleTouchIcon]: { width: 180, height: 180 },
  [BRAND_ASSETS.socialCard]: { width: 1200, height: 630 },
};

export const SOCIAL_CARD_ALT = `${SITE_NAME}: ${TAGLINE}`;

const MARK_SOURCE = new URL(`../../${BRAND_SOURCE}/mark.svg`, import.meta.url);
const SVG_ROLE = / role="img" aria-labelledby="[^"]*"/;
const SVG_TITLE = /<title[^>]*>[^<]*<\/title>\n/;
const NEWLINES = /\n/g;

export const INLINE_MARK = readFileSync(MARK_SOURCE, "utf8").replace(SVG_ROLE, ' aria-hidden="true" focusable="false"').replace(SVG_TITLE, "").replace(NEWLINES, "").trim();

export const copyBrandAssets = (root: string, outDirectory: string) => {
  assert(existsSync(join(root, BRAND_SOURCE)), `${BRAND_SOURCE} is missing under ${root}, so the site has no logo; restore the folder.`);
  assert(existsSync(join(root, FONTS_SOURCE)), `${FONTS_SOURCE} is missing under ${root}, so the site has no title font; restore the folder.`);
  cpSync(join(root, BRAND_SOURCE), join(outDirectory, BRAND_DIRECTORY), { recursive: true, filter: (path) => !path.endsWith(".html") });
  cpSync(join(root, FONTS_SOURCE), join(outDirectory, FONTS_DIRECTORY), { recursive: true });
};

export const canonicalUrl = (path: string) => {
  assert(path.endsWith(".html"), `a page path must end in .html, got ${path}; name the page file.`);
  assert(!path.startsWith("/"), `a page path is relative to the site root, got ${path}; drop the leading slash.`);
  return path === "index.html" ? SITE_URL : `${SITE_URL}${path}`;
};
