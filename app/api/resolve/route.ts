import { NextResponse } from "next/server";
import { resolveTicket } from "@/lib/resolve";

export async function POST(req: Request) {
  try {
    const { ticket } = await req.json();
    if (!ticket || !ticket.trim()) {
      return NextResponse.json({ error: "Ticket text is required" }, { status: 400 });
    }
    const resolution = await resolveTicket(ticket);
    return NextResponse.json({ resolution });
  } catch (err) {
    console.error("RESOLVE ERROR:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}