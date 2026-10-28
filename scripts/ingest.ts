// Embeds docs/<store>/*.md into kb_chunks for that store only.
//
//   npx tsx --env-file=.env.local scripts/ingest.ts kora
//   npx tsx --env-file=.env.local scripts/ingest.ts beacon
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { sql } from "../lib/db";
import { chunkText } from "../lib/chunk";
import { getStore } from "../lib/stores";

async function main() {
  const store = getStore(process.argv[2] ?? process.env.STORE_ID);
  const dir = join("docs", store.id);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
  if (!files.length) throw new Error(`No .md or .txt files in ${dir}`);

  // Re-ingesting replaces only this store's rows; other stores are untouched.
  await sql`DELETE FROM kb_chunks WHERE store = ${store.id}`;

  let total = 0;
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf-8");
    const chunks = chunkText(text);

    const { embeddings } = await embedMany({
      model: openai.embedding("text-embedding-3-small"),
      values: chunks,
    });

    for (let i = 0; i < chunks.length; i++) {
      const vec = `[${embeddings[i].join(",")}]`;
      await sql`
        INSERT INTO kb_chunks (store, source, content, embedding)
        VALUES (${store.id}, ${file}, ${chunks[i]}, ${vec}::vector)
      `;
    }
    total += chunks.length;
    console.log(`${file}: stored ${chunks.length} chunks`);
  }

  await sql.end();
  console.log(`done: ${total} chunks for store "${store.id}"`);
}

main().catch((e) => {
  console.error("INGEST ERROR:", e);
  process.exit(1);
});
