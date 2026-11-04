// Step 2 — generate a head-and-shoulders avatar with Muse Image.
//
// Feeds up to three reference photos to muse-image-1.0 via /v1/images/edits
// with a fixed corporate-headshot prompt. Identity is preserved by the
// references; the prompt fixes composition, lighting, and framing.
//
// Ported from production: supabase/functions/generate-avatar. Production
// passes signed storage URLs as references and saves the PNG to its bucket;
// this demo accepts local files (sent as data URLs) or hosted https URLs
// and writes the PNG to disk.
import { existsSync, readFileSync } from "node:fs";
import { MAX_REFERENCES, MUSE_EDITS_URL, MUSE_IMAGE_MODEL } from "./config.mjs";

export const PROMPT_TEMPLATE = (clothing) =>
  `Professional corporate headshot of the referenced person wearing ${clothing}, photorealistic, medium-format photography, head and shoulders composition without cutting off either shoulder, direct eye contact and facing the camera directly, neutral expression with slight confidence, natural skin texture, shallow depth of field, 85mm lens, f/2.8, soft studio lighting, light coloured background, ultra detailed, realistic pores, realistic eyes, no retouching, high-end commercial photography.`;

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function mimeForFile(path) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

// Local file -> base64 data URL; http(s) URL -> passed through unchanged.
export function resolveImageUrl(ref) {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (!existsSync(ref)) throw new Error(`reference not found: ${ref}`);
  const mime = mimeForFile(ref);
  if (!mime) throw new Error(`unsupported image type (use jpg, png, or webp): ${ref}`);
  return `data:${mime};base64,${readFileSync(ref).toString("base64")}`;
}

// Edits follow the references' aspect ratio, so no size param is sent.
export function buildEditsRequest({ prompt, refs }) {
  const imageUrls = refs.slice(0, MAX_REFERENCES).map(resolveImageUrl);
  if (imageUrls.length === 0) throw new Error("no reference photos");
  return {
    model: MUSE_IMAGE_MODEL,
    prompt,
    images: imageUrls.map((url) => ({ image_url: url })),
    n: 1,
    response_format: "b64_json",
    output_format: "png",
  };
}

export async function generateAvatar({ apiKey, prompt, refs }) {
  const body = buildEditsRequest({ prompt, refs });
  const resp = await fetch(MUSE_EDITS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`generate request failed: meta_${resp.status}: ${txt.slice(0, 300)}`);
  }
  const result = await resp.json().catch(() => null);
  const b64 = result?.data?.[0]?.b64_json;
  if (!b64) throw new Error("no_image_returned: response carried no b64_json image");
  return Buffer.from(b64, "base64");
}
