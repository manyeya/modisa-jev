# jev

**Why an agent stopped, and how risky its prompt is — as a badge on its pane.**

A [modisa](https://manyeya.github.io/modisa/) plugin. modisa reads each agent's state from its screen with rules
written per agent: it knows an agent is *idle* or *blocked*, not why. jev asks
[TypeSafe's Jev](https://typesafe.ai) — a model that answers typed multiple-choice questions in a fraction of a
second — the one question those rules can't answer, each time an agent's state changes.

```
┌ @codex ──── no credits ──┐   ← stopped: a usage limit, not a finished turn
┌ @claude ─── asks you ────┐   ← "done", but its last message asks you something
┌ @pi ───── destructive ───┐   ← blocked on a prompt that deletes or force-pushes (and a system notification)
┌ @qwen ──────── safe ─────┐   ← blocked on a read-only prompt: approve without reading
```

- **When an agent stops** (working or blocked → idle or done): did it finish, ask you something, run out of credits,
  get logged out, or crash? Anything but *finished* gets a badge, a toast and a system notification. An agent that ends its turn with a
  question in prose is no longer a quiet "done".
- **When an agent blocks**: is what it asks to do safe (read-only), edits, network, or destructive? The pane gets a
  badge; destructive also gets a system notification.
- **Only when it's sure.** An answer under 70% confidence shows nothing, and neither does one that arrives after the
  agent has moved on.
- **A badge lasts until the agent's state next changes**, or its process exits.

## Install

```sh
modisa plugin install https://github.com/manyeya/modisa-jev.git
```

Then give it a TypeSafe API key, in `~/.config/modisa/plugin-config/jev/config.json`:

```json
{ "apiKey": "…" }
```

or as `TYPESAFE_API_KEY` in the environment modisa's server starts with. The file is read on every call, so no
restart is needed. It also takes `"minConfidence"` (default `0.7`), `"model"` (default `"jev-latest"`) and `"url"`.
Needs [Bun](https://bun.sh).

`modisa plugin run jev status` shows the last verdicts, with their confidence, and the last error if there was one.

## Uninstall

```sh
modisa plugin unlink jev
```

## What it sends

Each time an agent stops or blocks, **the last 40 lines of that agent's screen** go to TypeSafe's API, with the
agent's name (claude-code, codex, …). Nothing else, and nothing for panes without an agent. If your agents' screens
show secrets, don't install it.

At TypeSafe's published price ($0.042 per million input tokens, output free) that's a few thousandths of a cent per
state change.

## How it knows

Everything comes from modisa: `agent.state` events say when to ask, `pane.read` gives the screen. jev shows
badges and toasts, and never reports a state: a report would take the pane's one reporting slot from the agent's own
integration and hold it until released. It never types into or touches your panes.

## Develop

```sh
git clone https://github.com/manyeya/modisa-jev.git && cd modisa-jev
bun test jev.test.ts          # the question and the call, against a fake Jev
modisa plugin check .         # everything, in a throwaway session, against a fake Jev
modisa plugin dev .           # try it by hand (needs a key)
```

`jev.ts` is the questions and the call (pure, unit-tested); `plugin.ts` wires it to the session. `AGENTS.md` is
modisa's guide to writing plugins.

## License

MIT
