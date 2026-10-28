// Safe to run more than once. Existing Beacon rows get store = 'beacon'
// automatically, so the live demo keeps working without re-ingesting.
//
//   npx tsx --env-file=.env.local scripts/migrate.ts
import { sql } from "../lib/db";

// ETAs are relative to "today" so the demo never shows a past delivery estimate for open orders.
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const DEMO_ORDERS = [
  // order_number, email, status, placed, items, total, method, city, country, carrier, tracking, eta, delivered
  ["KA-1042", "sara.m@example.com", "shipped", "2026-10-06", [{ name: "Everyday Organic Tee", size: "M", qty: 2 }, { name: "Field Hoodie", size: "L", qty: 1 }], 112.0, "Standard (USPS)", "Austin", "United States", "USPS", "9400 1000 0000 0000 1042", inDays(3), null],
  ["KA-1043", "james.k@example.com", "processing", "2026-10-10", [{ name: "Relaxed Chino", size: "32", qty: 1 }], 68.0, "Express (UPS)", "Denver", "United States", null, null, inDays(4), null],
  ["KA-1044", "priya.r@example.com", "delivered", "2026-09-22", [{ name: "Field Hoodie", size: "S", qty: 1 }], 72.0, "Royal Mail tracked", "Manchester", "United Kingdom", "Royal Mail", "RM104400000GB", "2026-10-03", "2026-10-02"],
  ["KA-1045", "liam.t@example.com", "shipped", "2026-09-18", [{ name: "Everyday Organic Tee", size: "XL", qty: 3 }], 84.0, "Canada Post", "Toronto", "Canada", "Canada Post", "CA104500000", inDays(2), null],
  ["KA-1046", "noor.a@example.com", "cancelled", "2026-10-01", [{ name: "Weekend Jogger", size: "30", qty: 1 }], 58.0, "Standard (USPS)", "Chicago", "United States", null, null, null, null],
  ["KA-1047", "emma.w@example.com", "delivered", "2026-10-02", [{ name: "Everyday Organic Tee", size: "S", qty: 1 }, { name: "Weekend Jogger", size: "28", qty: 1 }], 86.0, "Standard (USPS)", "Seattle", "United States", "USPS", "9400 1000 0000 0000 1047", "2026-10-08", "2026-10-07"],
] as const;

async function main() {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  await sql`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id bigserial PRIMARY KEY,
      source text NOT NULL,
      content text NOT NULL,
      embedding vector(1536) NOT NULL
    )`;
  await sql`ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS store text NOT NULL DEFAULT 'beacon'`;
  await sql`CREATE INDEX IF NOT EXISTS kb_chunks_store_idx ON kb_chunks (store)`;
  // Only add an HNSW index if the table doesn't already have one (the live DB does).
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename = 'kb_chunks' AND indexdef ILIKE '%hnsw%'
      ) THEN
        CREATE INDEX kb_chunks_embedding_hnsw ON kb_chunks USING hnsw (embedding vector_cosine_ops);
      END IF;
    END $$`;

  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      store text NOT NULL,
      order_number text NOT NULL,
      email text NOT NULL,
      status text NOT NULL CHECK (status IN ('processing','shipped','delivered','cancelled')),
      placed_at date NOT NULL,
      items jsonb NOT NULL,
      total numeric(10,2) NOT NULL,
      shipping_method text NOT NULL,
      ship_city text NOT NULL,
      ship_country text NOT NULL,
      carrier text,
      tracking_number text,
      estimated_delivery date,
      delivered_at date,
      PRIMARY KEY (store, order_number)
    )`;

  for (const o of DEMO_ORDERS) {
    const [num, email, status, placed, items, total, method, city, country, carrier, tracking, eta, delivered] = o;
    await sql`
      INSERT INTO orders (store, order_number, email, status, placed_at, items, total, shipping_method,
                          ship_city, ship_country, carrier, tracking_number, estimated_delivery, delivered_at)
      VALUES ('kora', ${num}, ${email}, ${status}, ${placed}, ${sql.json(items as never)}, ${total}, ${method},
              ${city}, ${country}, ${carrier}, ${tracking}, ${eta}, ${delivered})
      ON CONFLICT (store, order_number) DO UPDATE SET
        email = EXCLUDED.email, status = EXCLUDED.status, placed_at = EXCLUDED.placed_at,
        items = EXCLUDED.items, total = EXCLUDED.total, shipping_method = EXCLUDED.shipping_method,
        ship_city = EXCLUDED.ship_city, ship_country = EXCLUDED.ship_country, carrier = EXCLUDED.carrier,
        tracking_number = EXCLUDED.tracking_number, estimated_delivery = EXCLUDED.estimated_delivery,
        delivered_at = EXCLUDED.delivered_at`;
  }

  console.log(`migrated; seeded ${DEMO_ORDERS.length} demo orders for store "kora"`);
  await sql.end();
}

main().catch((e) => {
  console.error("MIGRATE ERROR:", e);
  process.exit(1);
});
