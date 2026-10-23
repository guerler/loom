/**
 * How Olit launches and saves, whichever way Galaxy runs it: the shell's options over a store, a
 * saved conversation opened from it or a new one started, and what the host is told.
 */
import {
  cannotStart,
  currentHistoryLaunch,
  type Galaxy,
  type LaunchContext,
  type OrbitBrowserOptions,
  type SessionStore,
} from "@galaxyproject/orbit-browser";
import { OLIT_ARTIFACTS } from "./artifacts/renderers";
import { OLIT_BRAND } from "./brand";
import type { OlitIncoming } from "./incoming";
import { resolveLaunch, summarize } from "./seed-dataset";
import { NotYours, type Opened, type Saves, type Store } from "./stores/store";

export const PLUGIN_NAME = "olit";

export const isDev = () => (import.meta as any).env.DEV;

/** What to show: a saved conversation, or a new one on the dataset Galaxy launched Olit on. */
export interface LaunchRequest {
  savedId?: string;
  datasetId?: string;
  /** Asked in a new conversation once the page is ready. */
  question?: string;
}

/** What the host hears of the conversation shown, each way in its own terms. */
export type Report = Pick<SessionStore, "savedState" | "active">;

/** The shell's options for showing `request`, saving to `store` and telling the host through `report`. */
export function shellOptions(
  incoming: OlitIncoming,
  store: Store,
  request: LaunchRequest,
  report: Report,
): OrbitBrowserOptions {
  const base = isDev() ? "" : `static/plugins/visualizations/${PLUGIN_NAME}/`;
  // Galaxy's client is the shell's, handed over at launch, which comes before any save.
  let saves: Saves | undefined;
  return {
    galaxyRoot: incoming.root,
    datasetId: incoming.datasetId,
    galaxyChatUrl: `${incoming.root}api/plugins/${PLUGIN_NAME}`,
    pyodideURL: new URL(`${incoming.root}${base}static/pyodide`, document.baseURI).href,
    createWorker: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    ...OLIT_ARTIFACTS,
    brand: OLIT_BRAND,
    launch: (galaxy) => {
      saves = store.connect(galaxy);
      return launch(galaxy, saves, request);
    },
    sessions: {
      kind: store.kind,
      save: (document, id) => saves!.save(document, id),
      ...report,
      ...store.wording,
    },
  };
}

/**
 * The saved conversation asked for, when Olit can open it; otherwise a new one, saying why the
 * saved one did not open. Nothing of another user's save is used, not even the dataset.
 */
async function launch(
  galaxy: Galaxy,
  saves: Saves,
  { savedId, datasetId, question }: LaunchRequest,
): Promise<LaunchContext> {
  let problem: string | undefined;
  let notYours: string | undefined;
  let opened: Opened | null = null;
  if (savedId) {
    opened = await saves.load(savedId).then(
      (found) => {
        if (!found) problem = "it is not a conversation this version can open";
        return found;
      },
      (e) => {
        if (e instanceof NotYours) notYours = e.message;
        else problem = String((e as Error)?.message ?? e);
        return null;
      },
    );
  }
  let context: LaunchContext;
  if (notYours) {
    context = {
      stop: `Olit opens only your own saved conversations, and ${savedId} is not one: ${notYours}.`,
    };
  } else if (opened) {
    context = await continued(galaxy, savedId!, opened);
  } else {
    context = await fresh(galaxy, datasetId);
    if (problem) {
      context.savedProblem =
        `Could not open saved conversation ${savedId} (${problem}). This is the history's ` +
        "conversation in this browser instead, and Save stores it as a new one.";
    }
  }
  return question ? { ...context, ask: question } : context;
}

/**
 * A saved conversation opens as saved, carrying its own history. One Olit did not save continues in
 * Galaxy's current history, saying so.
 */
async function continued(galaxy: Galaxy, id: string, opened: Opened): Promise<LaunchContext> {
  let context: LaunchContext;
  if (opened.held) {
    const current = await currentHistoryLaunch(galaxy);
    context = current.historyId
      ? {
          saved: { id, document: { ...opened.document, history_id: current.historyId } },
          greeting: opened.held.note,
        }
      : current;
  } else {
    context = { saved: { id, document: opened.document } };
  }
  return context;
}

/** A new conversation: on the dataset Galaxy launched Olit on, or in Galaxy's current history. */
async function fresh(galaxy: Galaxy, datasetId: string | undefined): Promise<LaunchContext> {
  let context: LaunchContext;
  if (datasetId) {
    const found = await resolveLaunch(galaxy, datasetId);
    if (found.historyId) {
      context = {
        historyId: found.historyId,
        ...(found.dataset ? { greeting: summarize(found.dataset) } : {}),
      };
    } else {
      context = { stop: cannotStart(`dataset ${datasetId}`, found.problem) };
    }
  } else {
    context = await currentHistoryLaunch(galaxy);
  }
  return context;
}
