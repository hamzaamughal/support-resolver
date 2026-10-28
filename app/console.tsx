"use client";

import { useState } from "react";
import styles from "./page.module.css";

type KbChunk = { source: string; content: string; distance: number };
type ToolCall = { tool: string; input: { orderNumber: string; email: string }; found: boolean };
type Resolution = {
  mode: "answer" | "ask" | "escalate";
  canAnswer: boolean;
  intent: string;
  toolCalls: ToolCall[];
  overriddenBy: string | null;
  category: string;
  answer: string | null;
  escalationReason: string | null;
  confidence: number;
  sources: KbChunk[];
  bestDistance: number;
};

function heat(sim: number) {
  const cold = [62, 109, 181], hot = [255, 138, 61];
  const c = cold.map((v, i) => Math.round(v + (hot[i] - v) * sim));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export type ConsoleStore = {
  name: string;
  tagline: string;
  examples: { text: string; tag: string }[];
  knowledge: string[];
  /** Cosine distance above which a policy question is force-escalated. */
  escalateDistance: number;
};

const OVERRIDES: Record<string, string> = {
  "weak-retrieval": "Safety rule: no knowledge-base passage matched well enough, so the AI answer was blocked.",
  "order-not-verified": "Safety rule: the order could not be verified, so the AI answer was blocked.",
  "empty-reply": "Safety rule: the model produced no usable reply.",
};

const now = () => performance.now();

type Stats = { runs: number; ms: number; answered: number; asked: number; escalated: number; approved: number };

export default function Console({ store }: { store: ConsoleStore }) {
  const [ticket, setTicket] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Resolution | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "escalated">("idle");
  const [stats, setStats] = useState<Stats>({ runs: 0, ms: 0, answered: 0, asked: 0, escalated: 0, approved: 0 });

  const thresholdSim = Math.max(0, 1 - store.escalateDistance);

  const resolve = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setLoading(true);
    setErr(null);
    setRes(null);
    setStatus("idle");
    const t0 = now();
    try {
      const r = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: t }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      const out: Resolution = data.resolution;
      setRes(out);
      setDraft(out.answer ?? "");
      const elapsed = now() - t0;
      setStats((s) => ({
        runs: s.runs + 1,
        ms: s.ms + elapsed,
        answered: s.answered + (out.mode === "answer" ? 1 : 0),
        asked: s.asked + (out.mode === "ask" ? 1 : 0),
        escalated: s.escalated + (out.mode === "escalate" ? 1 : 0),
        approved: s.approved,
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const verdictLabel = (m: Resolution["mode"]) =>
    m === "answer" ? "Auto-answer" : m === "ask" ? "Ask customer for details" : "Escalate to human";

  const renderTrace = (r: Resolution) => {
    const steps: { title: string; meta: string; body: React.ReactNode }[] = [];

    steps.push({
      title: "Understood the ticket",
      meta: "classify",
      body: (
        <p className={styles.kv}>
          intent: <b>{r.intent}</b> · category: <b>{r.category}</b> · confidence: <b>{(r.confidence * 100).toFixed(0)}%</b>
        </p>
      ),
    });

    steps.push({
      title: "Searched the knowledge base",
      meta: `top ${r.sources.length} passages`,
      body: (
        <>
          {r.sources.map((s, i) => {
            const sim = Math.max(0, Math.min(1, 1 - s.distance));
            return (
              <div key={i} className={styles.src}>
                <div className={styles.srcTop}>
                  <span className={styles.srcName}>
                    <span className={styles.srcNum}>[{i + 1}]</span> {s.source}
                  </span>
                  <span className={styles.srcPct} style={{ color: heat(sim) }}>{Math.round(sim * 100)}% match</span>
                </div>
                <div className={styles.track}>
                  <div className={styles.fill} style={{ width: `${Math.max(sim * 100, 3)}%`, background: heat(sim) }} />
                  <span className={styles.thresh} style={{ left: `${thresholdSim * 100}%` }} />
                </div>
              </div>
            );
          })}
          <p className={styles.muted}>
            The marker is the minimum match ({Math.round(thresholdSim * 100)}%) needed to answer a policy question.
          </p>
        </>
      ),
    });

    r.toolCalls.forEach((t) =>
      steps.push({
        title: "Checked the order system",
        meta: "tool call",
        body: (
          <p className={styles.toolLine}>
            <span className={styles.toolName}>lookupOrder</span>({t.input.orderNumber}, {t.input.email}) →{" "}
            <b className={t.found ? styles.toolOk : styles.toolMiss}>{t.found ? "order found" : "no match"}</b>
          </p>
        ),
      })
    );

    steps.push({
      title: "Safety check",
      meta: "deterministic rules",
      body: r.overriddenBy ? (
        <p className={styles.kv}>
          <b className={styles.toolMiss}>Blocked.</b> {OVERRIDES[r.overriddenBy] ?? `Rule applied: ${r.overriddenBy}`} The model&apos;s own text was not used.
        </p>
      ) : r.mode === "escalate" ? (
        <p className={styles.kv}>The model itself judged it could not answer safely.</p>
      ) : (
        <p className={styles.kv}><b className={styles.toolOk}>Passed.</b> The reply is grounded in the passages or order data above.</p>
      ),
    });

    return (
      <>
        {steps.map((s, i) => (
          <div key={i} className={styles.step} style={{ ["--i" as string]: i } as React.CSSProperties}>
            <div className={styles.stepNum}>{i + 1}</div>
            <div className={styles.stepMain}>
              <p className={styles.stepTitle}>{s.title} <span className={styles.stepMeta}>{s.meta}</span></p>
              {s.body}
            </div>
          </div>
        ))}
        <div
          className={`${styles.final} ${r.mode === "escalate" ? styles.finalEsc : styles.finalOk}`}
          style={{ ["--i" as string]: steps.length } as React.CSSProperties}
        >
          <b>{verdictLabel(r.mode)}</b>
          <span>
            {r.mode === "escalate"
              ? "Handed to a human instead of guessing."
              : r.mode === "ask"
              ? "Needs one more detail from the customer."
              : "Draft is ready. A human approves before it is sent."}
          </span>
        </div>
      </>
    );
  };

  return (
    <div className={styles.app}>
      <header className={styles.bar}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden />
          <div>
            <p className={styles.wordmark}>Resolve <span className={styles.storeName}>· {store.name}</span></p>
            <p className={styles.tagline}>{store.tagline}</p>
          </div>
        </div>
        <div className={styles.stack}>
          <span>RAG</span>
          <span>tool-calling</span>
          <span>pgvector</span>
        </div>
      </header>

      <main className={styles.stream}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>
            An AI support agent that <em>answers from your policies and orders</em> — and hands off to a human when it isn&apos;t sure.
          </h1>
          <p className={styles.heroSub}>
            This is a demo for <b>{store.name}</b>, a fictional store. Pick a ticket below and watch what the agent does,
            step by step.
          </p>
          <div className={styles.howto}>
            <div><b>1</b><span>Customer asks<small>A ticket or chat message</small></span></div>
            <div><b>2</b><span>Agent checks<small>Store policies and live order data</small></span></div>
            <div><b>3</b><span>Answers or escalates<small>You approve before anything is sent</small></span></div>
          </div>
        </section>

        <section>
          <p className={styles.lbl}>Try a ticket</p>
          <div className={styles.scenarios}>
            {store.examples.map((ex) => (
              <button
                key={ex.text}
                className={styles.scenario}
                disabled={loading}
                onClick={() => { setTicket(ex.text); resolve(ex.text); }}
              >
                <span>{ex.text}</span>
                {ex.tag && <small>{ex.tag}</small>}
              </button>
            ))}
          </div>
        </section>

        <div className={styles.cols}>
          <div className={styles.colLeft}>
            <div className={styles.composer}>
              <label className={styles.lbl}>Incoming support ticket</label>
              <textarea
                className={styles.textarea}
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                placeholder="Pick a ticket above, or write your own…"
              />
              <div className={styles.row}>
                <button className={styles.run} onClick={() => resolve(ticket)} disabled={loading || !ticket.trim()}>
                  {loading ? "Resolving…" : "Resolve ticket"}
                </button>
              </div>
            </div>

            {err && <div className={styles.error}>Error: {err}</div>}

            {res && (
              <div className={styles.result}>
                <div className={styles.resultHead}>
                  <span className={`${styles.verdict} ${res.mode === "escalate" ? styles.escalate : styles.answer}`}>
                    {verdictLabel(res.mode)}
                  </span>
                  <span className={styles.chipMeta}>
                    {res.category} · confidence {(res.confidence * 100).toFixed(0)}%
                  </span>
                </div>

                {res.canAnswer ? (
                  status === "sent" ? (
                    <div className={styles.doneSent}>✓ Reply approved &amp; sent to the customer</div>
                  ) : (
                    <>
                      <label className={styles.lbl}>Draft reply (editable)</label>
                      <textarea
                        className={`${styles.textarea} ${styles.draft}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <div className={styles.actions}>
                        <button
                          className={styles.approve}
                          onClick={() => {
                            setStatus("sent");
                            setStats((s) => ({ ...s, approved: s.approved + 1 }));
                          }}
                        >
                          Approve &amp; send
                        </button>
                        <button className={styles.escalateBtn} onClick={() => setStatus("escalated")}>Escalate instead</button>
                      </div>
                      {status === "escalated" && <p className={styles.muted}>Handed to a human agent.</p>}
                    </>
                  )
                ) : (
                  <div className={styles.escalateBox}>
                    <p className={styles.escReason}>{res.escalationReason}</p>
                    <p className={styles.muted}>Routed to a human so the customer isn&apos;t given a made-up response.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className={styles.tracePanel}>
            <div className={styles.panelHead}>
              <span className={styles.liveDot} aria-hidden /> Agent trace
              <small>what the agent did, step by step</small>
            </div>
            <div className={styles.traceBody}>
              {loading && (
                <div className={styles.pending}>
                  <p>Reading the ticket…</p>
                  <p>Searching the knowledge base…</p>
                  <p>Running safety checks…</p>
                </div>
              )}
              {!loading && !res && (
                <p className={styles.traceEmpty}>
                  Run a ticket and the agent&apos;s reasoning shows up here: what it searched, which tools it called, and why it answered or escalated.
                </p>
              )}
              {!loading && res && renderTrace(res)}
            </div>
          </aside>
        </div>

        <div className={styles.lower}>
          <div className={styles.box}>
            <p className={styles.lbl}>What the agent knows</p>
            <div className={styles.docs}>
              {store.knowledge.map((k) => (
                <span key={k} className={styles.doc}>{k}</span>
              ))}
            </div>
            <p className={styles.muted}>Anything outside this is escalated, not guessed.</p>
          </div>
          <div className={styles.box}>
            <p className={styles.lbl}>This session</p>
            <div className={styles.stats}>
              <div><b>{stats.answered}</b><span>Auto-answered</span></div>
              <div><b>{stats.asked}</b><span>Asked for details</span></div>
              <div><b>{stats.escalated}</b><span>Escalated</span></div>
              <div><b>{stats.approved}</b><span>Approved</span></div>
              <div><b>{stats.runs ? `${(stats.ms / stats.runs / 1000).toFixed(1)}s` : "–"}</b><span>Avg response</span></div>
            </div>
            <p className={styles.muted}>Counts for your demo session only.</p>
          </div>
        </div>

        <div className={styles.cta}>
          <div>
            <b>Want this for your store?</b>
            <span>Connects to Shopify (orders + policies). Built and deployed for you.</span>
          </div>
          <a href="https://hamzaabubakar.dev" target="_blank" rel="noreferrer">Get in touch →</a>
        </div>
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
