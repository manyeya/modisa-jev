// The Jev call against a local fake: no session, no key, no network.
import { test, expect, afterAll } from "bun:test";
import { ask, readConfig, tail, OUTCOME, RISK } from "./jev";

let reply: (body: any) => Response = () => Response.json({});
const seen: { auth: string | null; body: any }[] = [];
const fake = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const body = await req.json();
    seen.push({ auth: req.headers.get("authorization"), body });
    return reply(body);
  },
});
afterAll(() => fake.stop());
const config = { url: fake.url.origin, key: "k", model: "jev-latest", min: 0.7 };
const answer = (choice: string, confidence: number) => () => Response.json({ answers: { q: { type: "choice", choice, confidence, probabilities: {} } } });

test("it asks one Choice question with every label, and says whether the answer clears the floor", async () => {
  reply = answer("out_of_credits", 0.92);
  expect(await ask(config, OUTCOME, { screen: "usage limit" })).toEqual({ choice: "out_of_credits", confidence: 0.92, sure: true });
  const { auth, body } = seen.at(-1)!;
  expect(auth).toBe("Bearer k");
  expect(body).toMatchObject({ model: "jev-latest", state: { screen: "usage limit" }, questions: { q: { type: "choice", instructions: OUTCOME.ask } } });
  expect(Object.keys(body.questions.q.criteria)).toEqual(Object.keys(OUTCOME.labels));

  reply = answer("destructive", 0.5);
  expect((await ask(config, RISK, {})).sure).toBe(false); // below the floor
  reply = answer("made_up", 0.99);
  expect((await ask(config, RISK, {})).sure).toBe(false); // not one of ours
});

test("no key or a failed call is an error, not a verdict", async () => {
  expect(ask({ ...config, key: undefined }, OUTCOME, {})).rejects.toThrow("no API key");
  reply = () => new Response("nope", { status: 401 });
  expect(ask(config, OUTCOME, {})).rejects.toThrow("Jev answered 401: nope");
});

test("config comes from the file, then the environment, then defaults; only the screen's tail is sent", async () => {
  expect(await readConfig("/nonexistent/config.json", { TYPESAFE_API_KEY: "env" })).toEqual({ url: "https://api.typesafe.ai", key: "env", model: "jev-latest", min: 0.7 });
  const path = `${import.meta.dir}/.test-config.json`;
  await Bun.write(path, JSON.stringify({ apiKey: "file", minConfidence: 0.9 }));
  try {
    expect(await readConfig(path, { TYPESAFE_API_KEY: "env" })).toMatchObject({ key: "file", min: 0.9 });
  } finally {
    await Bun.file(path).delete();
  }
  expect(tail("a\nb\nc\n\n", 2)).toBe("b\nc");
});
