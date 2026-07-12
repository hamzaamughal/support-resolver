import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { retrieve, type KbChunk } from "./retrieve";

// If the closest KB chunk is farther than this cosine distance, we treat it as
// "no relevant article exists" and escalate — regardless of what the model says.
// Tune this: lower = escalates more eagerly, higher = tries to answer more often.
const ESCALATE_DISTANCE = 0.6;

const schema = z.object({
  canAnswer: z.boolean(),
  category: z.string().describe("short label e.g. Billing, Account, Integrations, Other"),
  answer: z.string().nullable().describe("the grounded reply if canAnswer, else null"),
  escalationReason: z.string().nullable().describe("one sentence, if escalating"),
  confidence: z.number().min(0).max(1),
});

export type Resolution = {
  canAnswer: boolean;
  category: string;
  answer: string | null;
  escalationReason: string | null;
  confidence: number;
  sources: KbChunk[];
  bestDistance: number;
};

export async function resolveTicket(ticket: string): Promise<Resolution> {
  // 1. RETRIEVE — pull the most relevant KB chunks (RAG)
  const sources = await retrieve(ticket, 4);
  const bestDistance = sources.length ? sources[0].distance : 1;
  const context = sources.map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`).join("\n\n");

  // 2. DECIDE — answer from context, or escalate (agent judgment)
  const { object } = await generateObject({
    model: openai("gpt-4o-mini"),
    schema,
    prompt:
      "You are a customer support agent for a product called Beacon. " +
      "Answer the ticket using ONLY the knowledge base context below. " +
      "If the context fully answers the ticket, set canAnswer=true and write a friendly, " +
      "concise reply grounded strictly in the context — do NOT invent policies, numbers, or steps not present. " +
      "If the context does NOT contain the answer, set canAnswer=false, leave answer null, " +
      "and give a one-sentence escalationReason. " +
      "category is a short label; confidence is 0-1.\n\n" +
      "Knowledge base context:\n" +
      (context || "(no articles found)") +
      "\n\nTicket:\n" +
      ticket,
  });

  // 3. BACKSTOP — deterministic guard: if nothing retrieved was relevant enough,
  //    force escalation even if the model claimed it could answer.
  let canAnswer = object.canAnswer;
  let answer = object.answer;
  let escalationReason = object.escalationReason;
  if (bestDistance > ESCALATE_DISTANCE) {
    canAnswer = false;
    answer = null;
    escalationReason =
      escalationReason ?? "No sufficiently relevant knowledge base article was found for this ticket.";
  }

  return {
    canAnswer,
    category: object.category,
    answer: canAnswer ? answer : null,
    escalationReason: canAnswer ? null : escalationReason ?? "Escalated to a human agent.",
    confidence: object.confidence,
    sources,
    bestDistance,
  };
}