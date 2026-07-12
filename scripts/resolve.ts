import { resolveTicket } from "../lib/resolve";
import { sql } from "../lib/db";

async function main() {
  const ticket = process.argv.slice(2).join(" ");
  if (!ticket) {
    console.log('Usage: npx tsx --env-file=.env.local scripts/resolve.ts "your ticket text"');
    process.exit(1);
  }

  const r = await resolveTicket(ticket);

  console.log("\nTICKET:", ticket);
  console.log(
    `CATEGORY: ${r.category}  |  confidence: ${r.confidence.toFixed(2)}  |  best distance: ${r.bestDistance.toFixed(3)}`
  );

  if (r.canAnswer) {
    console.log("\n✓ AUTO-ANSWER (grounded in KB):\n" + r.answer);
  } else {
    console.log("\n⚠ ESCALATE TO HUMAN:\n" + r.escalationReason);
  }

  console.log("\nSOURCES CONSIDERED:");
  r.sources.forEach((s, i) => console.log(`  [${i + 1}] ${s.source}  (dist ${s.distance.toFixed(3)})`));

  await sql.end();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});