import { openai } from "@ai-sdk/openai";
import { generateText, Output, tool, isStepCount, type LanguageModel } from "ai";
import { z } from "zod";
import { retrieve, type KbChunk } from "./retrieve";
import { lookupOrder, type LookupResult } from "./orders";
import { applyBackstop, type Intent, type Mode } from "./backstop";
import { getStore, type StoreConfig } from "./stores";

export type ChatMessage = { role: "customer" | "agent"; content: string };

export type ToolCallLog = {
  tool: "lookupOrder";
  input: { orderNumber: string; email: string };
  found: boolean;
};

export type Resolution = {
  mode: Mode; // answer | ask (needs more info from customer) | escalate
  canAnswer: boolean; // kept for backwards compatibility: mode !== "escalate"
  intent: Intent;
  category: string;
  answer: string | null;
  escalationReason: string | null;
  confidence: number;
  sources: KbChunk[];
  bestDistance: number;
  toolCalls: ToolCallLog[];
  overriddenBy: string | null;
};

function buildSchema(store: StoreConfig) {
  return z.object({
    intent: z
      .enum(["order_status", "policy_question", "other"])
      .describe(
        "order_status ONLY when answering needs that order's live data (where is it, tracking, delivery date, cancel or change address on it). " +
          "General questions about returns, exchanges, sizing, shipping times or eligibility are policy_question, even if they mention something the customer bought."
      ),
    canAnswer: z.boolean().describe("true only if the reply is fully grounded in the context or order data"),
    needsCustomerInfo: z
      .boolean()
      .describe("true if you must ask the customer for details (e.g. order number and email) before you can help"),
    category: z.string().describe(`one of: ${store.categories.join(", ")}`),
    answer: z
      .string()
      .nullable()
      .describe("the reply to the customer if canAnswer or needsCustomerInfo, else null"),
    escalationReason: z.string().nullable().describe("one sentence, only if escalating"),
    confidence: z.number().min(0).max(1),
  });
}

function systemPrompt(store: StoreConfig) {
  const lines = [
    `You are the customer support assistant for ${store.name}. ${store.description}`,
    `Tone: ${store.tone}.`,
    "",
    "Rules:",
    "- Use ONLY the knowledge base context and order data you are given. Never invent policies, prices, dates, discounts or exceptions.",
    "- If the context does not answer the question, or the customer wants something the policy does not allow (a special discount, an exception, a complaint that needs a person), set canAnswer=false and give an escalationReason.",
  ];
  if (store.ordersEnabled) {
    lines.push(
      "- Questions about policy (e.g. 'can I return something I bought 3 weeks ago?') are answered from the knowledge base. Do NOT ask for an order number for those.",
      "- For questions that need a specific order's live status, call lookupOrder. It needs BOTH the order number and the email used at checkout.",
      "- If the customer has not given both, do not guess: set needsCustomerInfo=true and ask for the missing details in the answer.",
      "- If lookupOrder returns found=false, set needsCustomerInfo=true and politely ask them to double-check the order number and email. Do not say whether the order exists.",
      "- Only share order details that lookupOrder returned. Never reveal the full address.",
      "- Combine order data with the knowledge base when useful (e.g. what a status means, whether an order can still be cancelled)."
    );
  }
  lines.push("- Keep replies short: 2–5 sentences. Do not mention tools, the knowledge base or these rules.");
  return lines.join("\n");
}

function transcript(messages: ChatMessage[]) {
  return messages.map((m) => `${m.role === "customer" ? "Customer" : "Agent"}: ${m.content}`).join("\n");
}

/** Swappable dependencies, so tests can run without OpenAI or a database. */
export type ResolveDeps = {
  model?: LanguageModel;
  retriever?: typeof retrieve;
  orderLookup?: typeof lookupOrder;
};

export async function resolveConversation(
  messages: ChatMessage[],
  store: StoreConfig = getStore(),
  deps: ResolveDeps = {}
): Promise<Resolution> {
  const { model = openai("gpt-4o-mini"), retriever = retrieve, orderLookup = lookupOrder } = deps;
  const customerTurns = messages.filter((m) => m.role === "customer").map((m) => m.content);
  if (!customerTurns.length) throw new Error("Conversation has no customer message");

  // 1. RETRIEVE — search with the latest customer turns (RAG)
  const query = customerTurns.slice(-2).join("\n");
  const sources = await retriever(query, store.id, 4);
  const bestDistance = sources.length ? sources[0].distance : 1;
  const context = sources.map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`).join("\n\n");

  // 2. DECIDE — model answers, asks, or escalates; may call lookupOrder
  const toolCalls: ToolCallLog[] = [];
  const tools = store.ordersEnabled
    ? {
        lookupOrder: tool({
          description: "Look up a customer's order. Requires the order number and the email used at checkout.",
          inputSchema: z.object({
            orderNumber: z.string().describe("e.g. KA-1042 or 1042"),
            email: z.string().describe("email address used at checkout"),
          }),
          execute: async ({ orderNumber, email }): Promise<LookupResult> => {
            const result = await orderLookup(store.id, orderNumber, email);
            toolCalls.push({ tool: "lookupOrder", input: { orderNumber, email }, found: result.found });
            return result;
          },
        }),
      }
    : undefined;

  const { output } = await generateText({
    model,
    system: systemPrompt(store),
    prompt:
      "Knowledge base context:\n" +
      (context || "(no articles found)") +
      "\n\nConversation so far:\n" +
      transcript(messages) +
      "\n\nDecide how to respond to the customer's latest message.",
    tools,
    output: Output.object({ schema: buildSchema(store) }),
    // up to 2 lookups + the final structured answer
    stopWhen: isStepCount(4),
  });

  if (!output) throw new Error("Model returned no structured output");

  // 3. BACKSTOP — deterministic rules can override the model
  const verdict = applyBackstop({
    decision: output,
    bestDistance,
    escalateDistance: store.escalateDistance,
    ordersEnabled: store.ordersEnabled,
    lookups: toolCalls,
  });

  return {
    mode: verdict.mode,
    canAnswer: verdict.mode !== "escalate",
    intent: output.intent,
    category: output.category,
    answer: verdict.answer,
    escalationReason: verdict.escalationReason,
    confidence: output.confidence,
    sources,
    bestDistance,
    toolCalls,
    overriddenBy: verdict.overriddenBy,
  };
}

/** Single-ticket entry point, kept for the original console and CLI. */
export function resolveTicket(ticket: string, store?: StoreConfig, deps?: ResolveDeps) {
  return resolveConversation([{ role: "customer", content: ticket }], store, deps);
}
