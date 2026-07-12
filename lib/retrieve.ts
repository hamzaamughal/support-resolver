import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { sql } from "./db";

export type KbChunk = { source: string; content: string; distance: number };

export async function retrieve(query: string, k = 4): Promise<KbChunk[]> {
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: query,
  });
  const vec = `[${embedding.join(",")}]`;

  const rows = await sql`
    SELECT source, content, embedding <=> ${vec}::vector AS distance
    FROM kb_chunks
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${k}
  `;
  return rows.map((r) => ({
    source: r.source as string,
    content: r.content as string,
    distance: Number(r.distance),
  }));
}