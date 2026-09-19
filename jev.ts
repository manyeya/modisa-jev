// The questions jev asks TypeSafe's Jev, and the call itself: no session needed, so it's unit-tested on its own.
import type { Tone } from "./modisa-plugin";

export type Label = { about: string; badge?: string; tone?: Tone };
export type Question = { ask: string; labels: Record<string, Label> };
export type Verdict = { choice: string; confidence: number; sure: boolean };
export type Config = { url: string; key?: string; model: string; min: number };

// Choice labels → the description Jev reads, and the badge each shows (none for the unremarkable ones)
export const OUTCOME: Question = {
  ask: "Why did this coding agent stop and wait?",
  labels: {
    finished: { about: "the agent completed its turn and waits for a new instruction" },
    asks_user: { about: "the agent's last message asks the human a question or for a decision before it can continue", badge: "asks you", tone: "blocked" },
    out_of_credits: { about: "the agent stopped because of a usage limit, quota, rate limit or billing problem", badge: "out of credits", tone: "warn" },
    logged_out: { about: "the agent stopped because its login expired or authentication failed", badge: "logged out", tone: "warn" },
    crashed: { about: "the agent or its tooling crashed or hit an error it could not recover from", badge: "crashed", tone: "warn" },
  },
};
export const RISK: Question = {
  ask: "How risky is the action this coding agent asks permission for?",
  labels: {
    question: { about: "not a permission prompt: the agent asks the human a question" },
    safe: { about: "a read-only action: reading files, listing, searching", badge: "safe", tone: "dim" },
    edits: { about: "creates or edits files inside the project", badge: "edits", tone: "fg" },
    network: { about: "installs packages, fetches URLs, or sends data over the network", badge: "network", tone: "warn" },
    destructive: { about: "deletes files, force-pushes, rewrites git history, drops data, or changes things outside the project", badge: "destructive", tone: "warn" },
  },
};

// config.json in the plugin's config directory, then $TYPESAFE_API_KEY. Read on every call: a new key needs no restart.
export async function readConfig(path: string, env = Bun.env): Promise<Config> {
  const c = await Bun.file(path).json().catch(() => ({}));
  return { url: c.url ?? "https://api.typesafe.ai", key: c.apiKey ?? env.TYPESAFE_API_KEY, model: c.model ?? "jev-latest", min: c.minConfidence ?? 0.7 };
}

// The last `lines` lines of a screen: all that's sent.
export const tail = (screen: string, lines = 40) => screen.trimEnd().split("\n").slice(-lines).join("\n");

// One Choice question: the label Jev picked, and whether it's sure enough to act on.
export async function ask(c: Config, q: Question, state: object): Promise<Verdict> {
  if (!c.key) throw new Error(`no API key: put {"apiKey": "..."} in the plugin's config.json or set TYPESAFE_API_KEY`);
  const criteria = Object.fromEntries(Object.entries(q.labels).map(([k, v]) => [k, v.about]));
  const res = await fetch(`${c.url}/v1/systemone`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: c.model, state, questions: { q: { type: "choice", instructions: q.ask, criteria } } }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Jev answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { choice, confidence } = (await res.json()).answers.q as { choice: string; confidence: number };
  return { choice, confidence, sure: confidence >= c.min && choice in q.labels };
}
