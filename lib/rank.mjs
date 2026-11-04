// Step 1 — rank reference photos with Muse Spark.
//
// Asks Muse Spark to review labeled training photos and pick the ones best
// suited as avatar references: clear, front-facing, identity-preserving.
// Picks come back in rank order with a one-line reason each.
//
// Ported from production: supabase/functions/select-avatar-references.
// Production stores ranks on its images table; this demo returns them.
import { MAX_CANDIDATES, MAX_CANDIDATE_BYTES, MUSE_CHAT_MODEL, MUSE_CHAT_URL } from "./config.mjs";

export const REVIEW_PROMPT = (total, want) =>
  `You are casting reference photos for an AI portrait generator. The generator studies the photos you pick and paints a new photorealistic head-and-shoulders portrait of the SAME person, so identity fidelity is everything.

Review the ${total} labeled training photos below and pick up to ${want} that will produce the best likeness.

PICK photos where the subject's face is:
- clearly visible, in focus, and well lit
- facing the camera (front or near-front; both eyes visible)
- unobstructed: no sunglasses, masks, hands, hair across the face, or heavy shadow
- natural: neutral or slight smile, no extreme angles, no beauty filters that reshape the face
- a single clear subject (reject group shots unless one face dominates)

Prefer head-and-shoulders framing but accept any framing with a clear face. Rank best first. If fewer than ${want} are suitable, pick fewer. If none preserve identity, pick none.

Call select_avatar_references with your picks in rank order, with a one-line reason each.`;

const TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "select_avatar_references",
    description: "Ranked avatar-reference picks with reasons",
    parameters: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              photo: { type: "integer", description: "1-based photo number as labeled" },
              reason: { type: "string", description: "one line: why this photo preserves identity" },
            },
            required: ["photo", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["picks"],
      additionalProperties: false,
    },
  },
};

// photos: [{ name, mime, bytes: Buffer }]. Returns { reviewed, body } where
// reviewed is the budgeted candidate list and body is the chat request.
export function buildRankRequest(photos, count) {
  // Largest first (deterministic), at most MAX_CANDIDATES, within the byte
  // budget — same candidate selection as production.
  const ordered = [...photos].sort((a, b) => b.bytes.byteLength - a.bytes.byteLength);
  const reviewed = [];
  let bytes = 0;
  for (const p of ordered.slice(0, MAX_CANDIDATES)) {
    if (bytes + p.bytes.byteLength > MAX_CANDIDATE_BYTES && reviewed.length > 0) break;
    bytes += p.bytes.byteLength;
    reviewed.push(p);
  }
  if (reviewed.length === 0) throw new Error("no usable photos");

  const content = [{ type: "text", text: REVIEW_PROMPT(reviewed.length, count) }];
  reviewed.forEach((r, i) => {
    content.push({ type: "text", text: `Photo ${i + 1} (${r.name}):` });
    content.push({
      type: "image_url",
      image_url: { url: `data:${r.mime};base64,${r.bytes.toString("base64")}` },
    });
  });

  return {
    reviewed,
    body: {
      model: MUSE_CHAT_MODEL,
      messages: [{ role: "user", content }],
      tools: [TOOL_SCHEMA],
      tool_choice: "auto",
    },
  };
}

// Parse picks from a tool call, tolerating a pre-parsed object or a model
// that answered with JSON text instead of calling the tool.
export function parsePicks(message) {
  const args = message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args === "string") {
    try {
      return JSON.parse(args).picks ?? [];
    } catch {
      return [];
    }
  }
  if (args && typeof args === "object") return args.picks ?? [];
  if (typeof message?.content === "string" && message.content.includes("{")) {
    try {
      const o = JSON.parse(
        message.content.slice(message.content.indexOf("{"), message.content.lastIndexOf("}") + 1),
      );
      return o.picks ?? [];
    } catch {
      return [];
    }
  }
  return [];
}

// Validate 1-based indices, dedupe, clamp to count. Rank = order returned.
export function sanitizePicks(raw, reviewedCount, count) {
  const seen = new Set();
  const picks = [];
  for (const p of raw) {
    const n = typeof p?.photo === "number" ? p.photo : -1;
    if (!Number.isInteger(n) || n < 1 || n > reviewedCount || seen.has(n)) continue;
    seen.add(n);
    picks.push({ photo: n, reason: String(p.reason ?? "").slice(0, 300) });
    if (picks.length >= count) break;
  }
  return picks;
}

export async function rankReferences({ apiKey, photos, count }) {
  const { reviewed, body } = buildRankRequest(photos, count);
  const resp = await fetch(MUSE_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`rank request failed: meta_${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json().catch(() => null);
  const picks = sanitizePicks(parsePicks(data?.choices?.[0]?.message ?? {}), reviewed.length, count);
  return { reviewed, picks };
}
