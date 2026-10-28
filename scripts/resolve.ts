// Try the agent from the terminal.
//
//   One ticket:   npx tsx --env-file=.env.local scripts/resolve.ts "Where is order KA-1042?"
//   Chat mode:    npx tsx --env-file=.env.local scripts/resolve.ts --chat
//
// Uses STORE_ID from .env.local (e.g. STORE_ID=kora).
import { createInterface } from "readline/promises";
import { resolveConversation, type ChatMessage, type Resolution } from "../lib/resolve";
import { getStore } from "../lib/stores";
import { sql } from "../lib/db";

function print(r: Resolution) {
  console.log(
    `\n[${r.mode.toUpperCase()}] intent: ${r.intent} | category: ${r.category} | confidence: ${r.confidence.toFixed(2)} | best distance: ${r.bestDistance.toFixed(3)}`
  );
  for (const t of r.toolCalls) {
    console.log(`  tool lookupOrder(${t.input.orderNumber}, ${t.input.email}) -> ${t.found ? "found" : "no match"}`);
  }
  if (r.overriddenBy) console.log(`  backstop overrode the model: ${r.overriddenBy}`);
  if (r.mode === "escalate") console.log("\n⚠ ESCALATE TO HUMAN: " + r.escalationReason);
  else console.log("\nAgent: " + r.answer);
  console.log("  sources: " + r.sources.map((s) => `${s.source} (${s.distance.toFixed(3)})`).join(", "));
}

async function main() {
  const store = getStore();
  const args = process.argv.slice(2);

  if (args[0] !== "--chat") {
    const ticket = args.join(" ");
    if (!ticket) {
      console.log('Usage: scripts/resolve.ts "ticket text"   or   scripts/resolve.ts --chat');
      process.exit(1);
    }
    print(await resolveConversation([{ role: "customer", content: ticket }], store));
  } else {
    console.log(`Chatting as a customer of ${store.name}. Empty line to quit.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const history: ChatMessage[] = [];
    while (true) {
      const line = (await rl.question("\nYou: ")).trim();
      if (!line) break;
      history.push({ role: "customer", content: line });
      const r = await resolveConversation(history, store);
      print(r);
      if (r.mode === "escalate") break;
      history.push({ role: "agent", content: r.answer! });
    }
    rl.close();
  }
  await sql.end();
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
