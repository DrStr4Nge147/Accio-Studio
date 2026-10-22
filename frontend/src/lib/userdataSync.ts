import { get, put } from "../api/http";
import { useTemplates, type PromptTemplate } from "../features/create/templates";
import { useTriggerWords } from "./triggerWords";

/** What the server keeps for this user (see server/userdata.py). */
export interface UserDoc {
  templates: PromptTemplate[];
  trigger_words: Record<string, string[]>;
}
interface Remote {
  data: UserDoc;
  updated: number | null;
}

const MERGED_KEY = "accio.userdata.merged";
const SAVE_DELAY = 600;

const local = (): UserDoc => ({ templates: useTemplates.getState().items, trigger_words: useTriggerWords.getState().words });
const same = (a: UserDoc, b: UserDoc) => JSON.stringify(a) === JSON.stringify(b);

/** Everything in `remote` plus whatever only `mine` has: templates by (target, name), trigger words per LoRA. Nothing is lost. */
export function mergeDocs(remote: UserDoc, mine: UserDoc): UserDoc {
  const key = (t: PromptTemplate) => `${t.target}\u0000${t.name.toLowerCase()}`;
  const have = new Set(remote.templates.map(key));
  const templates = [...remote.templates, ...mine.templates.filter((t) => !have.has(key(t)))];
  const trigger_words = { ...remote.trigger_words };
  for (const [lora, words] of Object.entries(mine.trigger_words)) trigger_words[lora] = [...new Set([...(trigger_words[lora] ?? []), ...words])];
  return { templates, trigger_words };
}

const flag = {
  get: () => {
    try {
      return localStorage.getItem(MERGED_KEY) === "1";
    } catch {
      return false;
    }
  },
  set: () => {
    try {
      localStorage.setItem(MERGED_KEY, "1");
    } catch {
      /* private mode: the merge simply repeats next time, which is harmless */
    }
  },
};

/**
 * Keeps the templates and trigger words in step with the server, so every device shows the same lists. The browser's own copy
 * (localStorage) stays as a fallback while the server is unreachable. The first sync on a device merges its local lists into the
 * server's; after that the server's copy wins, except for edits that haven't been saved yet. Returns a stop function.
 */
export function startUserdataSync(): () => void {
  let applying = false; // the change comes from the server: don't send it back
  let dirty = false; // local edits the server hasn't confirmed
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<void> = Promise.resolve();

  const apply = (doc: UserDoc) => {
    applying = true;
    useTemplates.setState({ items: doc.templates });
    useTriggerWords.setState({ words: doc.trigger_words });
    applying = false;
  };

  const push = () => {
    dirty = false;
    inflight = put<Remote>("/api/userdata", local()).then(
      () => undefined,
      () => {
        dirty = true; // offline or signed out: tried again with the next change or when the page is shown again
      },
    );
    return inflight;
  };

  const schedule = () => {
    if (applying) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => void push(), SAVE_DELAY);
  };

  const pull = async () => {
    await inflight; // never apply a server copy older than what we just sent
    let remote: Remote;
    try {
      remote = await get<Remote>("/api/userdata");
    } catch {
      return;
    }
    if (stopped) return;
    if (dirty) return void (await push());
    if (!flag.get()) {
      const merged = mergeDocs(remote.data, local());
      apply(merged);
      flag.set();
      if (!same(merged, remote.data)) await push();
      return;
    }
    if (!same(remote.data, local())) apply(remote.data);
  };

  const unsubscribe = [useTemplates.subscribe(schedule), useTriggerWords.subscribe(schedule)];
  const onShow = () => document.visibilityState === "visible" && void pull();
  document.addEventListener("visibilitychange", onShow);
  window.addEventListener("online", onShow);
  void pull();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe.forEach((u) => u());
    document.removeEventListener("visibilitychange", onShow);
    window.removeEventListener("online", onShow);
  };
}
