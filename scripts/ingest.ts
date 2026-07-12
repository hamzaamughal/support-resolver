import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { sql } from "../lib/db";
import { chunkText } from "../lib/chunk";

async function main() {
  const dir = "docs";
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));

  // start clean each run so re-ingesting doesn't duplicate rows
  await sql`TRUNCATE kb_chunks`;

  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf-8");
    const chunks = chunkText(text);
    console.log(`${file}: ${chunks.length} chunks`);

    const { embeddings } = await embedMany({
      model: openai.embedding("text-embedding-3-small"),
      values: chunks,
    });

    for (let i = 0; i < chunks.length; i++) {
      const vec = `[${embeddings[i].join(",")}]`;
      await sql`
        INSERT INTO kb_chunks (source, content, embedding)
        VALUES (${file}, ${chunks[i]}, ${vec}::vector)
      `;
    }
    console.log(`  stored ${chunks.length} rows`);
  }

  await sql.end();
  console.log("done");
}

main().catch((e) => {
  console.error("INGEST ERROR:", e);
  process.exit(1);
});