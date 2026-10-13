// End-to-end agent flow with a scripted mock model: no OpenAI key, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { resolveTicket } from "../lib/resolve";
import { STORES } from "../lib/stores";
import type { LookupResult } from "../lib/orders";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
const toolCall = (input: object) => ({
  content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "lookupOrder", input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const final = (obj: object) => ({
  content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
  warnings: [],
});
// Returns the scripted responses in order, one per model step.
const scripted = (...steps: object[]) => {
  let i = 0;
  return new MockLanguageModelV4({ doGenerate: async () => steps[Math.min(i++, steps.length - 1)] as never });
};

const weakRetriever = async () => [{ source: "shipping.md", content: "We ship to the US.", distance: 0.75 }];
const order: LookupResult = {
  found: true,
  order: {
    orderNumber: "KA-1042", status: "shipped", placedAt: "2026-10-06", items: [], total: "$112.00",
    shippingMethod: "Standard (USPS)", shipTo: "Austin, United States", carrier: "USPS",
    trackingNumber: "9400", estimatedDelivery: "2026-10-13", deliveredAt: null,
  },
};
const kora = STORES.kora;
const answer = {
  intent: "order_status", canAnswer: true, needsCustomerInfo: false, category: "Order status",
  answer: "Your order KA-1042 shipped with USPS and should arrive by Oct 13.", escalationReason: null, confidence: 0.9,
};

test("order question: tool is called, order found, answer is sent", async () => {
  const calls: string[] = [];
  const r = await resolveTicket("Where is KA-1042? sara.m@example.com", kora, {
    model: scripted(toolCall({ orderNumber: "KA-1042", email: "sara.m@example.com" }), final(answer)),
    retriever: weakRetriever,
    orderLookup: async (_s: string, n: string, e: string) => (calls.push(`${n}|${e}`), order),
  });
  assert.deepEqual(calls, ["KA-1042|sara.m@example.com"]);
  assert.equal(r.mode, "answer");
  assert.equal(r.toolCalls[0].found, true);
  assert.match(r.answer!, /KA-1042/);
});

test("order question answered WITHOUT calling the tool: answer is replaced, not sent", async () => {
  const r = await resolveTicket("Where is my order?", kora, {
    model: scripted(final(answer)),
    retriever: weakRetriever,
    orderLookup: async () => order,
  });
  assert.equal(r.mode, "ask");
  assert.equal(r.overriddenBy, "order-not-verified");
  assert.doesNotMatch(r.answer!, /shipped/);
});

test("wrong email: lookup fails and a confident answer is blocked", async () => {
  const r = await resolveTicket("Where is KA-1042? me@other.com", kora, {
    model: scripted(toolCall({ orderNumber: "KA-1042", email: "me@other.com" }), final(answer)),
    retriever: weakRetriever,
    orderLookup: async () => ({ found: false, reason: "no_match" }),
  });
  assert.equal(r.mode, "escalate");
  assert.equal(r.toolCalls[0].found, false);
});
