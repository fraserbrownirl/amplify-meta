#!/usr/bin/env node
// Amplify avatar-pipeline demo: rank training photos with Muse Spark, then
// generate a head-and-shoulders avatar with Muse Image.
//
// Usage:
//   node demo.mjs [photos-dir] [--out avatar.png] [--count 3]
//                 [--clothing "..."] [--refs url-or-path,...] [--dry-run]
//
//   photos-dir   Folder of jpg/png/webp photos (default: ./photos).
//                If --refs is given, the rank step is skipped and those
//                references are used directly (up to 3).
//   --dry-run    Validate inputs and print the prompts/request shapes
//                without calling the Meta API (no key needed).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_CLOTHING,
  loadDotEnv,
  MAX_CANDIDATE_BYTES,
  MAX_CANDIDATES,
  MAX_REFERENCES,
  requireApiKey,
} from "./lib/config.mjs";
import { buildRankRequest, rankReferences, REVIEW_PROMPT } from "./lib/rank.mjs";
import { buildEditsRequest, generateAvatar, mimeForFile, PROMPT_TEMPLATE } from "./lib/generate.mjs";

function usage(exit = 0) {
  console.log(`Usage: node demo.mjs [photos-dir] [options]

Options:
  --out PATH        Where to write the avatar PNG (default: ./out/avatar.png)
  --count N         Reference photos to use, 1-3 (default: 3)
  --clothing TEXT   Clothing description folded into the headshot prompt
  --refs A,B,C      Skip ranking; use these local paths or https URLs directly
  --dry-run         Validate and print prompts/requests without calling the API
  --help            This message

Setup: put 1-${MAX_CANDIDATES} photos in ./photos (or pass a folder), then:
  export MODEL_API_KEY=...   # or add it to a .env file (see .env.example)
  node demo.mjs`);
  process.exit(exit);
}

function parseArgs(argv) {
  const args = { dir: "./photos", out: "./out/avatar.png", count: 3, clothing: null, refs: null, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage();
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--out") args.out = argv[++i] ?? usage(1);
    else if (a === "--count") args.count = Math.min(MAX_REFERENCES, Math.max(1, parseInt(argv[++i], 10) || MAX_REFERENCES));
    else if (a === "--clothing") args.clothing = argv[++i] ?? usage(1);
    else if (a === "--refs") args.refs = (argv[++i] ?? usage(1)).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith("--")) usage(1);
    else rest.push(a);
  }
  if (rest.length > 1) usage(1);
  if (rest.length === 1) args.dir = rest[0];
  return args;
}

function loadPhotos(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`photos folder not found: ${dir}\nAdd 1-${MAX_CANDIDATES} jpg/png/webp photos and retry.`);
  }
  const photos = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (!statSync(p).isFile()) continue;
    const mime = mimeForFile(p);
    if (!mime) {
      console.warn(`warn: skipping non-image file: ${name}`);
      continue;
    }
    photos.push({ name, mime, path: p, bytes: readFileSync(p) });
  }
  if (photos.length === 0) throw new Error(`no jpg/png/webp photos in ${dir}`);
  return photos;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();
  const clothing = (args.clothing ?? "").trim() || DEFAULT_CLOTHING;
  const prompt = PROMPT_TEMPLATE(clothing);

  // Resolve references: explicit --refs, else rank the folder with Spark.
  let refs;
  let reviewed = null;
  if (args.refs) {
    refs = args.refs.slice(0, MAX_REFERENCES);
    console.log(`Using ${refs.length} explicit reference(s), rank step skipped.`);
  } else {
    const photos = loadPhotos(args.dir);
    console.log(`Found ${photos.length} photo(s), ${mb(photos.reduce((n, p) => n + p.bytes.byteLength, 0))} total.`);
    if (args.dryRun) {
      const { reviewed: rev, body } = buildRankRequest(photos, args.count);
      reviewed = rev;
      console.log(`\n[rank] would review ${rev.length} photo(s) within ${mb(MAX_CANDIDATE_BYTES)} budget:`);
      rev.forEach((r, i) => console.log(`  Photo ${i + 1}: ${r.name} (${mb(r.bytes.byteLength)})`));
      console.log(`\n[rank] model: ${body.model}; tool: ${body.tools[0].function.name}`);
      console.log(`[rank] prompt:\n${REVIEW_PROMPT(rev.length, args.count)}`);
      refs = rev.slice(0, args.count).map((r) => r.path);
    } else {
      const apiKey = requireApiKey();
      console.log("Ranking references with Muse Spark…");
      const { reviewed: rev, picks } = await rankReferences({ apiKey, photos, count: args.count });
      reviewed = rev;
      if (picks.length === 0) {
        // Same fallback as production: unreviewed -> largest files first.
        console.log("Spark picked none; falling back to largest-first.");
        refs = [...rev].sort((a, b) => b.bytes.byteLength - a.bytes.byteLength).slice(0, args.count).map((r) => r.path);
      } else {
        console.log("Picks (rank order):");
        picks.forEach((p, i) => console.log(`  ${i + 1}. Photo ${p.photo} (${rev[p.photo - 1].name}) — ${p.reason}`));
        refs = picks.map((p) => rev[p.photo - 1].path);
      }
    }
  }

  console.log(`\nReferences (${refs.length}):`);
  refs.forEach((r) => console.log(`  - ${r}`));

  if (args.dryRun) {
    const body = buildEditsRequest({ prompt, refs });
    console.log(`\n[generate] model: ${body.model}; n: ${body.n}; format: ${body.output_format} (${body.response_format})`);
    console.log(`[generate] images: ${body.images.length} reference(s)`);
    console.log(`[generate] prompt:\n${prompt}`);
    console.log("\nDry run complete — no API calls made.");
    return;
  }

  const apiKey = requireApiKey();
  console.log("\nGenerating headshot with Muse Image…");
  const png = await generateAvatar({ apiKey, prompt, refs });
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, png);
  console.log(`Avatar written to ${args.out} (${mb(png.byteLength)}).`);
  void reviewed;
}

main().catch((e) => {
  console.error(`error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
