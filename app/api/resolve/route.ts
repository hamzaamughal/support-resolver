import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveConversation } from "@/lib/resolve";

// Accepts either { ticket: string } (original console) or
// { messages: [{ role: "customer" | "agent", content }] } (chat widget).
const body = z.union([
  z.object({ ticket: z.string().trim().min(1).max(4000) }),
  z.object({
    messages: z
      .array(z.object({ role: z.enum(["customer", "agent"]), content: z.string().trim().min(1).max(4000) }))
      .min(1)
      .max(20),
  }),
]);

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { ticket } or { messages } with non-empty text." }, { status: 400 });
  }
  const messages =
    "ticket" in parsed.data ? [{ role: "customer" as const, content: parsed.data.ticket }] : parsed.data.messages;

  try {
    const resolution = await resolveConversation(messages);
    return NextResponse.json({ resolution });
  } catch (err) {
    console.error("RESOLVE ERROR:", err);
    return NextResponse.json({ error: "Could not resolve this ticket. Check the server logs." }, { status: 500 });
  }
}
