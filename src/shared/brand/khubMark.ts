/**
 * KHUB LATCH-ORBIT mark — the single source of truth for every brand asset.
 *
 * Path-only geometry: no text, fonts, gradients, external references or raster
 * payloads. The React renderer and the icon generator both consume these
 * constants, so the SVGs and every raster derived from them cannot drift.
 *
 * The wordmark is authored on a 420x96 grid: K x24..72, H x80..132,
 * U x140..192, B x200..268, all inside the y24..72 cap band. The K monogram
 * is derived on a 64x64 grid; small sizes (<=16px) intentionally drop the
 * orbit and satellite so the silhouette stays legible.
 */

export const KHUB_BRAND_NAME = "KHUB";
export const KHUB_WORDMARK_VIEWBOX = "0 0 420 96";
export const KHUB_MONOGRAM_VIEWBOX = "0 0 64 64";

export const KHUB_CANVAS_FILL = "#111820";
export const KHUB_MARK_FILL = "#F4F7FA";
export const KHUB_ACCENT_FILL = "#E8563F";
export const KHUB_MONO_FILL = "#FFFFFF";

export type KhubFillRole = "mark" | "accent";

export interface KhubPath {
  d: string;
  role: KhubFillRole;
  fillRule?: "evenodd";
  strokeWidth?: number;
}

export const KHUB_BACKGROUND_PATH =
  "M14 0 H50 A14 14 0 0 1 64 14 V50 A14 14 0 0 1 50 64 H14 A14 14 0 0 1 0 50 V14 A14 14 0 0 1 14 0 Z";

export const KHUB_WORDMARK_PATHS: KhubPath[] = [
  // Broken orbit: ellipse centred (48,48), rx=30 ry=18, rotated -18°. The
  // local 200°..250° sector is omitted; the arc runs 250° -> 200° (310°).
  {
    d: "M33.0147 35.0841 A30 18 -18 1 1 19.2866 50.8564",
    role: "accent",
    strokeWidth: 2,
  },
  { d: "M24 24 H36 V72 H24 Z", role: "mark" },
  { d: "M36 40 C48 32 60 24 72 24 L72 34 C60 34 48 42 36 50 Z", role: "mark" },
  { d: "M36 46 C48 54 60 62 72 62 L72 72 C60 72 48 64 36 56 Z", role: "mark" },
  { d: "M76 32 A4 4 0 1 0 76 40 A4 4 0 1 0 76 32 Z", role: "accent" },
  { d: "M80 24 H92 V72 H80 Z", role: "mark" },
  { d: "M120 24 H132 V72 H120 Z", role: "mark" },
  { d: "M92 42 H120 V54 H92 Z", role: "mark" },
  {
    d: "M140 24 H152 V56 C152 64 160 70 166 70 C172 70 180 64 180 56 V24 H192 V56 C192 69 181 72 166 72 C151 72 140 69 140 56 Z",
    role: "mark",
  },
  { d: "M200 24 H212 V72 H200 Z", role: "mark" },
  {
    d: "M212 24 H244 C257 24 264 29 264 36 C264 43 257 48 244 48 H212 Z M224 33 H243 C250 33 253 35 253 36 C253 38 250 40 243 40 H224 Z",
    role: "mark",
    fillRule: "evenodd",
  },
  {
    d: "M212 48 H246 C260 48 268 54 268 60 C268 68 260 72 246 72 H212 Z M224 57 H245 C252 57 256 59 256 60 C256 62 252 64 245 64 H224 Z",
    role: "mark",
    fillRule: "evenodd",
  },
];

export const KHUB_MONOGRAM_SILHOUETTE_PATHS: KhubPath[] = [
  { d: "M12 8 H24 V56 H12 Z", role: "mark" },
  { d: "M22 13 L52 5 L52 15 L22 23 Z", role: "mark" },
  { d: "M22 41 L52 49 L52 59 L22 51 Z", role: "mark" },
];

/**
 * Monogram orbit: centred (32,32), rx=26 ry=16, rotated -18°, with the same
 * local 200°..250° gap; satellite r=3 at (54,20), sitting on the visible arc.
 */
export const KHUB_MONOGRAM_ORBIT_PATH = "M18.8966 20.4487 A26 16 -18 1 1 7.0727 34.3454";
export const KHUB_MONOGRAM_SATELLITE_PATH = "M54 17 A3 3 0 1 0 54 23 A3 3 0 1 0 54 17 Z";
export const KHUB_MONOGRAM_FULL_PATHS: KhubPath[] = [
  ...KHUB_MONOGRAM_SILHOUETTE_PATHS,
  { d: KHUB_MONOGRAM_ORBIT_PATH, role: "accent", strokeWidth: 2.5 },
  { d: KHUB_MONOGRAM_SATELLITE_PATH, role: "accent" },
];

export type KhubSvgVariant = "wordmark" | "glyph" | "silhouette";

export interface KhubSvgOptions {
  markFill?: string;
  accentFill?: string;
  canvasFill?: string | null;
  ariaLabel?: string;
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const pathAttributes = (
  path: KhubPath,
  options: Required<Pick<KhubSvgOptions, "markFill" | "accentFill">>
) => {
  const fill = path.role === "accent" ? options.accentFill : options.markFill;
  const attrs = [
    `fill="${escapeAttribute(path.strokeWidth ? "none" : fill)}"`,
    path.fillRule ? `fill-rule="${path.fillRule}"` : "",
    path.strokeWidth ? `stroke="${escapeAttribute(fill)}" stroke-width="${path.strokeWidth}"` : "",
    `d="${escapeAttribute(path.d)}"`,
  ];
  return attrs.filter(Boolean).join(" ");
};

/** Build a path-only SVG string. `canvasFill: null` leaves a transparent background. */
export function buildKhubSvg(variant: KhubSvgVariant, options: KhubSvgOptions = {}) {
  const markFill = options.markFill ?? KHUB_MARK_FILL;
  const accentFill = options.accentFill ?? KHUB_ACCENT_FILL;
  const canvasFill = options.canvasFill === undefined ? KHUB_CANVAS_FILL : options.canvasFill;
  const isWordmark = variant === "wordmark";
  const viewBox = isWordmark ? KHUB_WORDMARK_VIEWBOX : KHUB_MONOGRAM_VIEWBOX;
  const [width, height] = isWordmark ? [420, 96] : [64, 64];
  const paths = isWordmark
    ? KHUB_WORDMARK_PATHS
    : variant === "silhouette"
      ? KHUB_MONOGRAM_SILHOUETTE_PATHS
      : KHUB_MONOGRAM_FULL_PATHS;
  const label = options.ariaLabel
    ? ` role="img" aria-label="${escapeAttribute(options.ariaLabel)}"`
    : "";
  const background = canvasFill
    ? `<path fill="${escapeAttribute(canvasFill)}" d="${KHUB_BACKGROUND_PATH}"/>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}"${label}>`,
    background,
    ...paths.map((path) => `<path ${pathAttributes(path, { markFill, accentFill })}/>`),
    "</svg>",
  ].join("");
}

/** ≤16px drops the orbit and satellite; larger sizes use the full LATCH-ORBIT mark. */
export function buildKhubIconSvg(size: number, options: KhubSvgOptions = {}) {
  return buildKhubSvg(size <= 16 ? "silhouette" : "glyph", options);
}

const SAFE_TAGS = new Set(["svg", "path"]);
const SAFE_ATTRIBUTES = new Set([
  "xmlns",
  "width",
  "height",
  "viewbox",
  "fill",
  "fill-rule",
  "stroke",
  "stroke-width",
  "d",
  "role",
  "aria-label",
]);
const FORBIDDEN_CONSTRUCTS: Array<[RegExp, string]> = [
  [/<text\b/i, "text elements"],
  [/<tspan\b/i, "tspan elements"],
  [/<image\b/i, "image elements"],
  [/<script\b/i, "script elements"],
  [/<foreignobject\b/i, "foreignObject elements"],
  [/<use\b/i, "use elements"],
  [/<filter\b/i, "filter elements"],
  [/<lineargradient\b|<radialgradient\b/i, "gradient elements"],
  [/<circle\b/i, "circle elements"],
  [/<ellipse\b/i, "ellipse elements"],
  [/<rect\b|<line\b|<polygon\b|<polyline\b/i, "non-path geometry"],
  [/font-family|@font-face|@import/i, "font and CSS imports"],
  [/\bhref\s*=|\bxlink:href\s*=/i, "href references"],
  [/url\s*\(/i, "url() references"],
  [/data:[^"\s;]*;?base64|data:image\//i, "embedded rasters"],
  [/\bon[a-z]+\s*=/i, "event handlers"],
  [/<defs\b|<style\b|<symbol\b|<pattern\b|<mask\b|<animate\b/i, "declarative SVG constructs"],
  [/javascript:/i, "javascript: URLs"],
];
const SAFE_PATH_DATA = /^[-+0-9.,eEaAcC HhLlMmQqSsTtVvZz]+$/;

/**
 * Fail-closed validator shared by the generator and the safety tests. Any
 * construct outside the path-only allowlist is rejected with an actionable
 * message instead of silently producing an unsafe asset.
 */
export function assertSafeKhubSvg(svg: string, label = "SVG") {
  for (const [pattern, description] of FORBIDDEN_CONSTRUCTS) {
    if (pattern.test(svg)) throw new Error(`${label}: forbidden ${description}`);
  }
  if (/<!--|<!\[CDATA\[|<!DOCTYPE|<\?/i.test(svg)) {
    throw new Error(`${label}: comments, CDATA and declarations are not allowed`);
  }

  const tagPattern = /<\/?([a-zA-Z][\w:-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  let svgRoots = 0;
  while ((match = tagPattern.exec(svg)) !== null) {
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    if (!SAFE_TAGS.has(tag)) throw new Error(`${label}: unsupported <${match[1]}> element`);
    if (tag === "svg" && !closing) svgRoots += 1;
    if (closing) continue;

    const attributePattern = /([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g;
    const attributes = match[2];
    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributePattern.exec(attributes)) !== null) {
      const name = attributeMatch[1].toLowerCase();
      if (!SAFE_ATTRIBUTES.has(name)) {
        throw new Error(`${label}: unsupported attribute "${attributeMatch[1]}"`);
      }
      const value = attributeMatch[2];
      if (/url\s*\(|javascript:|data:/i.test(value)) {
        throw new Error(`${label}: unsafe attribute value on "${attributeMatch[1]}"`);
      }
      if (name === "d" && !SAFE_PATH_DATA.test(value)) {
        throw new Error(`${label}: unsafe path data`);
      }
    }
  }
  if (svgRoots !== 1) throw new Error(`${label}: expected exactly one <svg> element`);
  return true;
}
