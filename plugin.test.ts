// Behavioural tests for jev, run against a real throwaway session by `modisa plugin check .`. Jev is a local fake:
// the plugin reads its config on every call, so pointing it at the fake needs no restart.
import { test, expect, beforeAll, afterAll } from "bun:test";
import { checkSession } from "./modisa-plugin";

const s = checkSession();
const asked: any[] = [];
let answer = (_body: any) => ({ choice: "finished", confidence: 0.9 });
const jev = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const body = await req.json();
    asked.push({ auth: req.headers.get("authorization"), body });
    return Response.json({ model: "jev-latest", answers: { q: { type: "choice", probabilities: {}, ...answer(body) } } });
  },
});

beforeAll(async () => {
  const { config } = JSON.parse((await s.modisa("plugin", "run", s.plugin, "status")).stdout);
  await Bun.write(config, JSON.stringify({ apiKey: "test-key", url: jev.url.origin }));
});
afterAll(() => jev.stop());

// A pane modisa sees as a Claude Code agent, its state reported the way agent integrations do (see AGENTS.md)
async function agent(name: string) {
  const id = (await s.modisa("pane", "split", "--name", name)).stdout;
  await s.modisa("pane", "run", id, "sleep 600");
  const pane = async () => (await s.json<any[]>("pane", "list")).find((p) => p.name === name);
  const set = async (state: "working" | "blocked" | "idle") => {
    for (let i = 0; i < 10; i++) {
      await s.modisa("report", id, "--source", "jev-test", "--agent", "claude-code", "--state", state);
      if ((await s.modisa("wait", id, "--state", state, "--timeout", "1")).code === 0) return;
    }
    throw new Error(`${name} never showed as ${state}`);
  };
  return { pane, set };
}
const badge = async (pane: any) => (await s.ui()).badges.find((b) => b.pane === pane.id && b.instance === pane.instance)?.text;

test("an agent that stops to ask something gets an 'asks you' badge, gone once it works again", async () => {
  answer = (body) => ({ choice: body.questions.q.instructions.includes("stop") ? "asks_user" : "safe", confidence: 0.9 });
  const a = await agent("asker");
  await a.set("working");
  await a.set("idle");
  const pane = await a.pane();
  await s.until("the badge", async () => (await badge(pane)) === "asks you");
  const call = asked.at(-1);
  expect(call.auth).toBe("Bearer test-key");
  expect(Object.keys(call.body.questions.q.criteria)).toContain("out_of_credits");
  expect(call.body.state.screen).toContain("sleep 600"); // it sent the pane's screen

  await a.set("working");
  await s.until("the badge to go", async () => (await badge(pane)) === undefined);
}, 60_000);

test("'? n ask you' in the status row counts agents asking you; its action goes to one; it drops when they work", async () => {
  const segment = async () => (await s.ui()).status.find((x) => x.id === "ask");
  expect(await segment()).toMatchObject({ text: "? 0 ask you", tone: "dim", action: "ask-you" });
  expect((await s.modisa("plugin", "run", s.plugin, "ask-you")).stdout).toBe("no agent is asking you anything");

  answer = (body) => ({ choice: body.questions.q.instructions.includes("stop") ? "asks_user" : "safe", confidence: 0.9 });
  const a = await agent("questioner");
  await a.set("working");
  await a.set("idle");
  await s.until("counted", async () => (await segment())?.text === "? 1 ask you");
  expect((await segment())?.tone).toBe("blocked");
  expect((await s.modisa("plugin", "run", s.plugin, "ask-you")).stdout).toBe("@questioner is asking you");
  expect((await s.json<any[]>("pane", "list")).find((p) => p.name === "questioner")).toBeTruthy();

  await a.set("working");
  await s.until("dropped", async () => (await segment())?.text === "? 0 ask you");
}, 60_000);

test("a destructive permission prompt is badged; an unsure verdict isn't", async () => {
  answer = () => ({ choice: "destructive", confidence: 0.95 });
  const a = await agent("risky");
  await a.set("working");
  await a.set("blocked");
  const pane = await a.pane();
  await s.until("the badge", async () => (await badge(pane)) === "destructive");

  answer = () => ({ choice: "destructive", confidence: 0.3 });
  await a.set("working");
  const before = asked.length;
  await a.set("blocked");
  await s.until("the second call", async () => asked.length > before);
  await Bun.sleep(500);
  expect(await badge(pane)).toBeUndefined();
}, 60_000);
