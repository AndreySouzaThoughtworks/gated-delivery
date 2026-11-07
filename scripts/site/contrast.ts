import assert from "node:assert";

const HEX_COLOUR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const CHANNEL_MAX = 255;
const LINEAR_THRESHOLD = 0.03928;
const LINEAR_DIVISOR = 12.92;
const GAMMA_OFFSET = 0.055;
const GAMMA_SCALE = 1.055;
const GAMMA_EXPONENT = 2.4;
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const FLARE = 0.05;
const HEX_BASE = 16;
const DECIMALS = 2;

export const TEXT_MINIMUM = 4.5;
export const LARGE_TEXT_AND_UI_MINIMUM = 3;

export type Pair = { label: string; foreground: string; background: string; minimum: number };

export const CONTRAST_PAIRS: Pair[] = [
  { label: "body text on the page", foreground: "text", background: "bg", minimum: TEXT_MINIMUM },
  { label: "body text on a card", foreground: "text", background: "surface", minimum: TEXT_MINIMUM },
  { label: "inline code on its code background", foreground: "text", background: "raised", minimum: TEXT_MINIMUM },
  { label: "muted text on the page", foreground: "muted", background: "bg", minimum: TEXT_MINIMUM },
  { label: "muted text on a card", foreground: "muted", background: "surface", minimum: TEXT_MINIMUM },
  { label: "link on the page", foreground: "link", background: "bg", minimum: TEXT_MINIMUM },
  { label: "link on a card", foreground: "link", background: "surface", minimum: TEXT_MINIMUM },
  { label: "accent text on the page", foreground: "accent", background: "bg", minimum: TEXT_MINIMUM },
  { label: "accent text on a card", foreground: "accent", background: "surface", minimum: TEXT_MINIMUM },
  { label: "gold text on the page", foreground: "gold", background: "bg", minimum: TEXT_MINIMUM },
  { label: "gold text on a card", foreground: "gold", background: "surface", minimum: TEXT_MINIMUM },
  { label: "gold text on the footer band", foreground: "gold", background: "band", minimum: TEXT_MINIMUM },
  { label: "gold text on a raised table header", foreground: "gold", background: "raised", minimum: TEXT_MINIMUM },
  { label: "body text on the header and footer band", foreground: "text", background: "band", minimum: TEXT_MINIMUM },
  { label: "muted text on the footer band", foreground: "muted", background: "band", minimum: TEXT_MINIMUM },
  { label: "link on the footer band", foreground: "link", background: "band", minimum: TEXT_MINIMUM },
  { label: "good tier text on a card", foreground: "good", background: "surface", minimum: TEXT_MINIMUM },
  { label: "bad tier text on a card", foreground: "bad", background: "surface", minimum: TEXT_MINIMUM },
  { label: "button text on the button", foreground: "onPrimary", background: "primary", minimum: TEXT_MINIMUM },
  { label: "button text on the lit top of the plate", foreground: "onPrimary", background: "primaryTop", minimum: TEXT_MINIMUM },
  { label: "terminal text on the terminal", foreground: "terminalText", background: "terminalBg", minimum: TEXT_MINIMUM },
  { label: "terminal text on the window bar", foreground: "terminalText", background: "terminalBar", minimum: TEXT_MINIMUM },
  { label: "terminal caption on the window bar", foreground: "terminalMuted", background: "terminalBar", minimum: TEXT_MINIMUM },
  { label: "control border on the page", foreground: "borderStrong", background: "bg", minimum: LARGE_TEXT_AND_UI_MINIMUM },
  { label: "control border on a card", foreground: "borderStrong", background: "surface", minimum: LARGE_TEXT_AND_UI_MINIMUM },
  { label: "primary button plate against the page", foreground: "primary", background: "bg", minimum: LARGE_TEXT_AND_UI_MINIMUM },
];

export const THEME_SELECTORS = { light: ':root[data-theme="light"]', dark: ':root[data-theme="dark"]' };

export const luminance = (hex: string) => {
  assert(typeof hex === "string", `a colour is text, got ${typeof hex}; pass #rrggbb.`);
  const match = HEX_COLOUR.exec(hex);
  assert(match !== null, `a colour is #rrggbb, got "${hex}"; write the six hex digits.`);
  const [red, green, blue] = match.slice(1).map((digits) => {
    const channel = Number.parseInt(digits, HEX_BASE) / CHANNEL_MAX;
    return channel <= LINEAR_THRESHOLD ? channel / LINEAR_DIVISOR : ((channel + GAMMA_OFFSET) / GAMMA_SCALE) ** GAMMA_EXPONENT;
  });
  return RED_WEIGHT * red + GREEN_WEIGHT * green + BLUE_WEIGHT * blue;
};

export const contrastRatio = (foreground: string, background: string) => {
  assert(typeof foreground === "string", `the foreground colour is text, got ${typeof foreground}; pass #rrggbb.`);
  assert(typeof background === "string", `the background colour is text, got ${typeof background}; pass #rrggbb.`);
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((first, second) => second - first);
  return (lighter + FLARE) / (darker + FLARE);
};

export const themeTokens = (css: string, theme: keyof typeof THEME_SELECTORS) => {
  assert(typeof css === "string", `the style is css text, got ${typeof css}; pass the stylesheet.`);
  const selector = THEME_SELECTORS[theme];
  assert(selector !== undefined, `the theme is light or dark, got ${String(theme)}; pass one of them.`);
  const block = css.slice(css.indexOf(`${selector} {`)).match(/\{([^}]*)\}/)?.[1];
  assert(block !== undefined, `the style has no ${selector} block; define the ${theme} tokens there.`);
  return new Map([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
};

export const contrastProblems = (file: string, css: string, pairs: Pair[] = CONTRAST_PAIRS) => {
  assert(file !== "", `a style check names the page that holds the style, got an empty name; pass the page path.`);
  assert(pairs.length > 0, `the contrast check needs token pairs, got none; pass CONTRAST_PAIRS.`);
  return (Object.keys(THEME_SELECTORS) as (keyof typeof THEME_SELECTORS)[]).flatMap((theme) => {
    const tokens = themeTokens(css, theme);
    return pairs.flatMap(({ label, foreground, background, minimum }) => {
      const [front, back] = [tokens.get(foreground), tokens.get(background)];
      if (front === undefined || back === undefined) return [`${file} has no --${front === undefined ? foreground : background} token in the ${theme} theme. Rule: every contrast pair names real tokens. Fix: define the token in scripts/site/style.ts.`];
      const ratio = contrastRatio(front, back);
      return ratio >= minimum
        ? []
        : [`${file} ${theme} theme: ${label} (${foreground} ${front} on ${background} ${back}) has contrast ${ratio.toFixed(DECIMALS)}:1. Rule: WCAG AA needs at least ${minimum}:1. Fix: change the ${foreground} or ${background} token in scripts/site/style.ts.`];
    });
  });
};
