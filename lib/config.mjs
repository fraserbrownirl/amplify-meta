// Shared config for the Amplify avatar-pipeline demo.
//
// MODEL_API_KEY comes from the environment or a local .env file (see
// .env.example). Get a key at the Meta Model API dashboard (dev.meta.ai) —
// one key serves all Muse models.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MUSE_CHAT_URL = "https://api.meta.ai/v1/chat/completions";
export const MUSE_CHAT_MODEL = "muse-spark-1.1";
export const MUSE_EDITS_URL = "https://api.meta.ai/v1/images/edits";
export const MUSE_IMAGE_MODEL = "muse-image-1.0";

// Same bounds as production: at most 8 candidates within a 12 MiB budget
// for ranking, and at most 3 references for generation.
export const MAX_CANDIDATES = 8;
export const MAX_CANDIDATE_BYTES = 12 * 1024 * 1024;
export const MAX_REFERENCES = 3;

export const DEFAULT_CLOTHING =
  "a simple solid-colour top appropriate for a professional headshot";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Minimal .env loader (KEY=VALUE lines, # comments, no interpolation).
export function loadDotEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

export function requireApiKey() {
  const key = (process.env.MODEL_API_KEY ?? "").trim();
  if (!key) {
    throw new Error(
      "MODEL_API_KEY is not set. Export it or add it to a .env file (see .env.example).\n" +
        "Get a key at the Meta Model API dashboard (dev.meta.ai).",
    );
  }
  return key;
}
