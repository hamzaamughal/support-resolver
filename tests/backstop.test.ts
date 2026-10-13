// Run: npm test   (no API keys or database needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBackstop, ASK_FOR_ORDER_DETAILS, type BackstopInput, type ModelDecision } from "../lib/backstop";

const decision = (d: Partial<ModelDecision>): ModelDecision => ({
  intent: "policy_question",
  canAnswer: true,
  needsCustomerInfo: false,
  answer: "Yes, returns are free in the US.",
  escalationReason: null,
  ...d,
});
const run = (d: Partial<ModelDecision>, extra: Partial<BackstopInput> = {}) =>
  applyBackstop({ decision: decision(d), bestDistance: 0.3, escalateDistance: 0.6, ordersEnabled: true, lookups: [], ...extra });

test("grounded policy answer passes through", () => {
  assert.equal(run({}).mode, "answer");
});

test("weak retrieval forces escalation even if the model says it can answer", () => {
  const r = run({}, { bestDistance: 0.8 });
  assert.equal(r.mode, "escalate");
  assert.equal(r.overriddenBy, "weak-retrieval");
  assert.equal(r.answer, null);
});

test("model choosing to escalate is respected", () => {
  const r = run({ canAnswer: false, answer: null, escalationReason: "Wants a custom discount." });
  assert.equal(r.mode, "escalate");
  assert.equal(r.escalationReason, "Wants a custom discount.");
  assert.equal(r.overriddenBy, null);
});

test("asking for order number + email is allowed without a lookup", () => {
  const r = run({ intent: "order_status", canAnswer: false, needsCustomerInfo: true, answer: "Could you share your order number and email?" });
  assert.equal(r.mode, "ask");
});

test("order answer without any lookup is replaced with a safe question", () => {
  const r = run({ intent: "order_status", answer: "Your order shipped yesterday." });
  assert.equal(r.mode, "ask");
  assert.equal(r.answer, ASK_FOR_ORDER_DETAILS);
  assert.equal(r.overriddenBy, "order-not-verified");
});

test("order answer after a failed lookup is blocked", () => {
  const r = run({ intent: "order_status", answer: "Your order shipped." }, { lookups: [{ found: false }] });
  assert.equal(r.mode, "escalate");
});

test("order answer after a matched lookup passes, even with weak retrieval", () => {
  const r = run({ intent: "order_status", answer: "Order KA-1042 shipped via USPS." }, { lookups: [{ found: true }], bestDistance: 0.9 });
  assert.equal(r.mode, "answer");
});

test("empty answer is never sent", () => {
  assert.equal(run({ answer: "  " }).mode, "escalate");
  assert.equal(run({ needsCustomerInfo: true, answer: null }).mode, "escalate");
});

test("stores without orders fall back to the retrieval rule", () => {
  const r = run({ intent: "order_status" }, { ordersEnabled: false, bestDistance: 0.2 });
  assert.equal(r.mode, "answer");
});
