// Deterministic rules applied AFTER the model decides. The model can be wrong;
// these checks make sure a weak retrieval or a missing order lookup can never
// turn into a confident reply to the customer.

export type Intent = "order_status" | "policy_question" | "other";
export type Mode = "answer" | "ask" | "escalate";

export type ModelDecision = {
  intent: Intent;
  canAnswer: boolean;
  needsCustomerInfo: boolean;
  answer: string | null;
  escalationReason: string | null;
};

export type BackstopInput = {
  decision: ModelDecision;
  bestDistance: number;
  escalateDistance: number;
  ordersEnabled: boolean;
  /** found=true/false for each lookupOrder call made during this run */
  lookups: { found: boolean }[];
};

export type BackstopResult = {
  mode: Mode;
  answer: string | null;
  escalationReason: string | null;
  /** Set when a rule overrode the model, explaining which one. */
  overriddenBy: string | null;
};

export const ASK_FOR_ORDER_DETAILS =
  "I can check that for you. Could you share your order number and the email address you used at checkout?";

const escalate = (reason: string, overriddenBy: string | null): BackstopResult => ({
  mode: "escalate",
  answer: null,
  escalationReason: reason,
  overriddenBy,
});

export function applyBackstop(input: BackstopInput): BackstopResult {
  const { decision, bestDistance, escalateDistance, ordersEnabled, lookups } = input;
  const hasAnswer = !!decision.answer?.trim();

  // The model itself chose to escalate.
  if (!decision.canAnswer && !decision.needsCustomerInfo) {
    return escalate(decision.escalationReason ?? "Escalated to a human agent.", null);
  }

  // Asking the customer for details (e.g. order number + email) is always safe,
  // as long as there is actually a question to send.
  if (decision.needsCustomerInfo) {
    return hasAnswer
      ? { mode: "ask", answer: decision.answer, escalationReason: null, overriddenBy: null }
      : escalate("The agent needed more details but produced no question.", "empty-reply");
  }

  if (!hasAnswer) return escalate("The agent produced an empty reply.", "empty-reply");

  // Order questions: only answer if a lookup actually matched an order.
  if (decision.intent === "order_status" && ordersEnabled) {
    if (lookups.some((l) => l.found)) {
      return { mode: "answer", answer: decision.answer, escalationReason: null, overriddenBy: null };
    }
    if (lookups.length) {
      return escalate("No order matched the order number and email given.", "order-not-verified");
    }
    // The model answered an order question without checking the order. Its text can't be
    // trusted, so replace it with a fixed, safe question instead of escalating.
    return { mode: "ask", answer: ASK_FOR_ORDER_DETAILS, escalationReason: null, overriddenBy: "order-not-verified" };
  }

  // Policy / other questions: retrieval must have found something relevant.
  if (bestDistance > escalateDistance) {
    return escalate("No sufficiently relevant knowledge base article was found.", "weak-retrieval");
  }

  return { mode: "answer", answer: decision.answer, escalationReason: null, overriddenBy: null };
}
