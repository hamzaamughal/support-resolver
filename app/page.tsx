"use client";

import { useState } from "react";
import styles from "./page.module.css";

type KbChunk = { source: string; content: string; distance: number };
type Resolution = {
  canAnswer: boolean;
  category: string;
  answer: string | null;
  escalationReason: string | null;
  confidence: number;
  sources: KbChunk[];
  bestDistance: number;
};

const EXAMPLES = [
  "How do I reset my password?",
  "Can I get a refund on my subscription?",
  "Do you have a SOC 2 report for my security team?",
];

function heat(sim: number) {
  const cold = [62, 109, 181], hot = [255, 138, 61];
  const c = cold.map((v, i) => Math.round(v + (hot[i] - v) * sim));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export default function Home() {
  const [ticket, setTicket] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Resolution | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "escalated">("idle");

  const resolve = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setLoading(true);
    setErr(null);
    setRes(null);
    setStatus("idle");
    try {
      const r = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: t }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setRes(data.resolution);
      setDraft(data.resolution.answer ?? "");
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.app}>
      <header className={styles.bar}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden />
          <div>
            <p className={styles.wordmark}>Resolve</p>
            <p className={styles.tagline}>A support agent that answers from your docs — or escalates when it can&apos;t</p>
          </div>
        </div>
        <div className={styles.stack}>
          <span>RAG</span>
          <span>agent</span>
          <span>pgvector</span>
        </div>
      </header>

      <main className={styles.stream}>
        <div className={styles.composer}>
          <label className={styles.lbl}>Incoming support ticket</label>
          <textarea
            className={styles.textarea}
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
            placeholder="Paste a customer's question…"
          />
          <div className={styles.row}>
            <button className={styles.run} onClick={() => resolve(ticket)} disabled={loading || !ticket.trim()}>
              {loading ? "Resolving…" : "Resolve ticket"}
            </button>
            <div className={styles.chips}>
              {EXAMPLES.map((q) => (
                <button key={q} className={styles.chip} onClick={() => { setTicket(q); resolve(q); }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>

        {err && <div className={styles.error}>Error: {err}</div>}

        {res && (
          <div className={styles.result}>
            <div className={styles.resultHead}>
              <span className={`${styles.verdict} ${res.canAnswer ? styles.answer : styles.escalate}`}>
                {res.canAnswer ? "Auto-answer" : "Escalate to human"}
              </span>
              <span className={styles.chipMeta}>
                {res.category} · confidence {(res.confidence * 100).toFixed(0)}%
              </span>
            </div>

            {res.canAnswer ? (
              status === "sent" ? (
                <div className={styles.doneSent}>✓ Reply approved & sent to the customer</div>
              ) : (
                <>
                  <label className={styles.lbl}>Draft reply (grounded in KB — editable)</label>
                  <textarea
                    className={`${styles.textarea} ${styles.draft}`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className={styles.actions}>
                    <button className={styles.approve} onClick={() => setStatus("sent")}>Approve &amp; send</button>
                    <button className={styles.escalateBtn} onClick={() => setStatus("escalated")}>Escalate instead</button>
                  </div>
                  {status === "escalated" && <p className={styles.muted}>Handed to a human agent.</p>}
                </>
              )
            ) : (
              <div className={styles.escalateBox}>
                <p className={styles.escReason}>{res.escalationReason}</p>
                <p className={styles.muted}>No confident answer in the knowledge base — routed to a human so the customer isn&apos;t given a made-up response.</p>
              </div>
            )}

            <div className={styles.sources}>
              <p className={styles.srcLabel}>Knowledge base passages considered</p>
              {res.sources.map((s, i) => {
                const sim = Math.max(0, Math.min(1, 1 - s.distance));
                return (
                  <div key={i} className={styles.src}>
                    <div className={styles.srcTop}>
                      <span className={styles.srcName}><span className={styles.srcNum}>[{i + 1}]</span> {s.source}</span>
                      <span className={styles.srcPct} style={{ color: heat(sim) }}>{Math.round(sim * 100)}% match</span>
                    </div>
                    <div className={styles.track}><div className={styles.fill} style={{ width: `${Math.max(sim * 100, 3)}%`, background: heat(sim) }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
      <footer className="foot">
          Built by{" "}
          <a href="https://github.com/hamzaamughal" target="_blank" rel="noreferrer">
            Hamza Abubakar
          </a>{" "}
          · RAG + agent decision · pgvector + OpenAI + Next.js
        </footer>
    </div>
  );
}
