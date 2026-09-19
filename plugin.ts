// jev: asks TypeSafe's Jev what an agent's screen means when its state changes, and badges the pane with what modisa's
// screen rules can't tell — why an agent stopped (asks you, out of credits, logged out, crashed), and how risky the
// permission prompt it's blocked on is. `jev.ts` is the question and the call; this wires it to the session.
// It only badges, never reports a state: a report takes the pane's one authority slot, which would override the
// agent's own integration and freeze screen detection until released. Read AGENTS.md before changing it.
import { runPlugin } from "./modisa-plugin";
import { ask, readConfig, tail, OUTCOME, RISK, type Question } from "./jev";

const CONFIG = `${Bun.env.MODISA_PLUGIN_CONFIG ?? import.meta.dir}/config.json`;

runPlugin(async (modisa) => {
  const gen = new Map<string, number>(); // instance → its state changes so far: a verdict for an older one is stale
  const badged = new Map<string, string>(); // pane → the instance its badge is for
  const recent: object[] = []; // the last verdicts, for `status`
  let failure = "";

  await modisa.hello({
    status: () => ({ config: CONFIG, recent, lastError: failure || undefined }),
  });

  const clear = (pane: string) => {
    if (!badged.has(pane)) return;
    badged.delete(pane);
    modisa.ui.clearBadge(pane).catch(() => {});
  };

  async function judge(e: { pane: string; instance: string; name?: string; harness?: string }, q: Question) {
    const mine = gen.get(e.instance);
    const { screen } = await modisa.request<{ screen: string }>("pane.read", { target: e.pane, lines: 1 });
    const v = await ask(await readConfig(CONFIG), q, { agent: e.harness ?? "unknown coding agent", screen: tail(screen) });
    const who = e.name ? `@${e.name}` : e.pane;
    recent.unshift({ at: new Date().toISOString(), pane: who, question: q.ask, ...v });
    recent.length = Math.min(recent.length, 20);
    if (gen.get(e.instance) !== mine || !v.sure) return; // the agent moved on while we asked, or Jev isn't sure
    const label = q.labels[v.choice]!;
    if (!label.badge) return;
    await modisa.ui.badge(e.pane, e.instance, label.badge, label.tone);
    badged.set(e.pane, e.instance);
    if (q === OUTCOME) await modisa.ui.toast(`${who} ${label.badge}`, { tone: label.tone });
    else if (v.choice === "destructive") await modisa.ui.toast(`${who} asks to do something destructive`, { tone: "warn", system: true });
  }

  await modisa.subscribe({
    onEvent: (event) => {
      if (!event.pane || !event.instance) return;
      if (event.type === "process.exited") return clear(event.pane);
      if (event.type !== "agent.state") return;
      gen.set(event.instance, (gen.get(event.instance) ?? 0) + 1);
      if (badged.get(event.pane) === event.instance) clear(event.pane);
      const stopped = (event.to === "idle" || event.to === "done") && (event.from === "working" || event.from === "blocked");
      const q = stopped ? OUTCOME : event.to === "blocked" ? RISK : undefined;
      if (!q) return;
      // not awaited: a slow Jev call must not hold up the events behind it
      judge(event as Parameters<typeof judge>[0], q).then(
        () => (failure = ""),
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message !== failure) console.error(`jev: ${message}`); // once per distinct failure, not per event
          failure = message;
        },
      );
    },
  });
  console.log(`jev: watching; config in ${CONFIG}`);
});
