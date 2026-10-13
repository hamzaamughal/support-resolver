// Store configuration. Each store gets its own knowledge base (docs/<id>/),
// its own prompt details, and optionally the order-lookup tool.
// Pick the active store with the STORE_ID env var (defaults to "beacon",
// so the existing live demo keeps working unchanged).

export type StoreConfig = {
  id: string;
  name: string;
  /** One line describing the business, used in the system prompt. */
  description: string;
  /** How replies should sound. */
  tone: string;
  /** Short labels the model picks from for `category`. */
  categories: string[];
  /** Enables the lookupOrder tool (needs rows in the orders table). */
  ordersEnabled: boolean;
  /** Cosine distance above which a policy question is force-escalated. */
  escalateDistance: number;
  /** Example tickets shown in the console UI. */
  examples: string[];
  /** Short tagline for the console header. */
  tagline: string;
};

export const STORES: Record<string, StoreConfig> = {
  beacon: {
    id: "beacon",
    name: "Beacon",
    description: "Beacon is a project-management SaaS product.",
    tone: "friendly, concise and professional",
    categories: ["Billing", "Account", "Integrations", "Other"],
    ordersEnabled: false,
    escalateDistance: 0.6,
    examples: [
      "How do I reset my password?",
      "Can I get a refund on my subscription?",
      "Do you have a SOC 2 report for my security team?",
    ],
    tagline: "A support agent that answers from your docs — or escalates when it can't",
  },
  kora: {
    id: "kora",
    name: "Kora Apparel",
    description:
      "Kora Apparel is an online clothing store (Shopify) selling organic cotton tees, hoodies and pants, shipping to the US, Canada and the UK.",
    tone: "warm, short and helpful, like a good store assistant; no emojis",
    categories: ["Order status", "Shipping", "Returns", "Sizing", "Payments", "Other"],
    ordersEnabled: true,
    escalateDistance: 0.6,
    examples: [
      "Where is my order KA-1042? My email is sara.m@example.com",
      "Can I return a hoodie I bought 3 weeks ago?",
      "I'm usually between M and L, which size should I get?",
      "Do you ship to Australia?",
      "Can you give me a 50% discount code?",
    ],
    tagline: "AI support for Shopify stores — answers from store policies and real order data, escalates when unsure",
  },
};

export function getStore(id = process.env.STORE_ID ?? "beacon"): StoreConfig {
  const store = STORES[id];
  if (!store) {
    throw new Error(`Unknown STORE_ID "${id}". Known stores: ${Object.keys(STORES).join(", ")}`);
  }
  return store;
}
