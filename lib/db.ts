import postgres from "postgres";

const url = process.env.DATABASE_URL;
// Unit tests (node --test sets NODE_TEST_CONTEXT) mock the database, so they don't need a URL.
if (!url && !process.env.NODE_TEST_CONTEXT) {
  throw new Error("DATABASE_URL is not set (add it to .env.local and restart).");
}

// onnotice: silence "already exists, skipping" notices from idempotent migrations
export const sql = postgres(url ?? "postgres://unused-in-tests", { onnotice: () => {} });
