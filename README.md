# Amplify avatar pipeline (Meta hackathon demo)

A runnable slice of [Amplify](https://www.iamp.you) (iamp.you): the two-step Meta pipeline that turns a creator's training photos into an AI head-and-shoulders avatar.

## What Amplify is

Amplify is a brand↔creator marketplace. Brands buy a creator's posting slot per channel, pair it with their own video, and get back an AI-composited ad — the creator's avatar burned into the brand video — which the creator posts and tags. Creators set per-channel prices and get paid through the platform.

This repo contains one self-contained piece of that platform: avatar generation. The marketplace app, payments, renderer, and Instagram integrations stay private; the Meta mechanics are public here.

## The pipeline

```text
training photos (1-8)
        │
        ▼
┌───────────────────────────────┐
│ 1. RANK — Muse Spark          │  muse-spark-1.1 via /v1/chat/completions
│    Reviews labeled photos,    │  Photos inlined as data URLs (12 MiB budget),
│    picks up to 3 references   │  picks returned via a `select_avatar_references`
│    with one-line reasons.     │  tool call (JSON-text fallback).
└───────────────────────────────┘
        │
        ▼
┌───────────────────────────────┐
│ 2. GENERATE — Muse Image      │  muse-image-1.0 via /v1/images/edits
│    Fixed corporate-headshot   │  References + prompt in, b64 PNG out.
│    prompt + references in,    │  (Edits follow the references' aspect
│    photorealistic PNG out.    │  ratio, so no size param is sent.)
└───────────────────────────────┘
        │
        ▼
   out/avatar.png
```

Identity fidelity comes from the references, not the prompt: Spark casts photos where the face is clear, front-facing, unobstructed, and unfiltered, and Muse Image paints the same person into a fixed studio composition.

## Quickstart (< 5 minutes)

Requirements: Node 20+ and a Meta Model API key ([dev.meta.ai](https://dev.meta.ai) — one key serves all Muse models). No `npm install` needed; zero dependencies.

```bash
# 1. Add 1-8 jpg/png/webp photos of one person to ./photos
#    (this folder is git-ignored; your photos never get committed)

# 2. Set your key
export MODEL_API_KEY=...   # or copy .env.example to .env

# 3. Preview without spending anything
node demo.mjs --dry-run

# 4. Run it
node demo.mjs
# Picks (rank order):
#   1. Photo 3 (img_3.jpg) — front-facing, sharp, even light
#   ...
# Avatar written to out/avatar.png
```

More options:

```bash
node demo.mjs ./my-photos --out ./me.png --count 2
node demo.mjs --clothing "a navy blazer over a white shirt"
node demo.mjs --refs https://…/a.jpg,./local/b.png   # skip ranking
node demo.mjs --help
```

## How this maps to production

| This repo | Production (private) | Notes |
|---|---|---|
| `lib/rank.mjs` | `supabase/functions/select-avatar-references` | Same prompt, tool schema, parse/validate logic. Prod stores ranks on its images table; the demo prints them. |
| `lib/generate.mjs` | `supabase/functions/generate-avatar` | Same prompt template, model, and `/images/edits` request shape. Prod passes signed storage URLs and saves to its bucket; the demo takes local files or https URLs and writes a local PNG. |
| `demo.mjs` | edge-function wiring | Auth, background jobs, status polling, and the motion-pack chain are prod-only and intentionally absent here. |

## Reference passing: local files vs URLs

Production hands Muse Image signed https URLs for its references. This demo accepts both:

- **Local files** are converted to `data:` URLs and inlined. If the API ever rejects data URLs, host the photos and pass https URLs instead (`--refs`).
- **https URLs** are passed through unchanged.

## Notes

- **Only generate avatars of yourself, or of someone who consented.** Identity-preserving generation is the whole point of this pipeline; use it responsibly.
- **Quotas.** This is a local CLI spending your own key. Before exposing this flow as a service, add per-account rate limits and spend caps — each call burns paid model budget.
- **Cost.** Ranking inlines up to 12 MiB of photos per call; generation returns one PNG. Keep an eye on usage at dev.meta.ai.

## License

MIT — see [LICENSE](LICENSE).
