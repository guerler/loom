/** Olit: Orbit's browser shell as GalaxyAI's chat, mounted by Galaxy as a visualization plugin. */
import {
  cannotStart,
  currentHistoryLaunch,
  mountOrbitBrowser,
  type Galaxy,
  type LaunchContext,
} from "@galaxyproject/orbit-browser";
import { OLIT_ARTIFACTS } from "./artifacts/renderers";
import { OLIT_BRAND } from "./brand";
import { parseIncoming, type OlitIncoming } from "./incoming";
import {
  reportSavedState,
  savedSessions,
  type SavedChat,
  type SavedSessions,
} from "./saved-session";
import { resolveLaunch, summarize } from "./seed-dataset";

const PLUGIN_NAME = "olit";

const isDev = () => (import.meta as any).env.DEV;

/** Dev-only: synthesize data-incoming from the plugin XML (no framework host). */
async function seedDevIncoming(container: HTMLElement): Promise<void> {
  const { parseXML } = await import("galaxy-charts-xml-parser");
  const pageUrl = new URL(window.location.href);
  container.dataset.incoming = JSON.stringify({
    root: "/",
    visualization_config: {
      dataset_id: pageUrl.searchParams.get("dataset_id") || undefined,
      settings: {},
    },
    visualization_plugin: await parseXML("olit.xml"),
  });
}

/** Where a conversation starts that no saved chat opens: the dataset Galaxy launched Olit on, or
 * Galaxy's current history. */
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

/**
 * A chat GalaxyAI held continues in Galaxy's current history, from its questions and answers.
 * Galaxy refuses to replace it, so a save adds the continuation as a new chat.
 */
async function held(galaxy: Galaxy, id: string, chat: SavedChat): Promise<LaunchContext> {
  const current = await currentHistoryLaunch(galaxy);
  let context: LaunchContext = current;
  if (current.historyId) {
    context = {
      saved: { id, document: { ...chat.document, history_id: current.historyId } },
      greeting:
        "This conversation was held by GalaxyAI before Olit: its questions and answers are here, " +
        "the steps behind them are not. Saving keeps it as a new chat and leaves the original.",
    };
  }
  return context;
}

/**
 * The saved chat GalaxyAI opened continues; otherwise the history's own conversation. A question
 * GalaxyAI handed over is asked in a new conversation once it is ready.
 */
async function launch(galaxy: Galaxy, incoming: OlitIncoming): Promise<LaunchContext> {
  const { exchangeId, question } = incoming;
  let problem: string | undefined;
  let chat: SavedChat | null = null;
  if (exchangeId) {
    chat = await savedSessions(galaxy)
      .load(exchangeId)
      .catch((e) => {
        problem = String((e as Error)?.message ?? e);
        return null;
      });
    problem = chat || problem ? problem : "it is not a conversation this version can open";
  }
  let context: LaunchContext;
  if (chat?.olit) {
    context = { saved: { id: exchangeId!, document: chat.document } };
  } else if (chat) {
    context = await held(galaxy, exchangeId!, chat);
  } else {
    context = await fresh(galaxy, incoming.datasetId);
  }
  if (problem) {
    context.savedProblem =
      `Could not open saved conversation ${exchangeId} (${problem}). This is the history's ` +
      "conversation in this browser instead, and Save stores it as a new one.";
  }
  return question ? { ...context, ask: question } : context;
}

async function main() {
  const scriptUrl = new URL(import.meta.url);
  const containerId = scriptUrl.searchParams.get("container") || "app";
  const container = document.getElementById(containerId)!;

  if (isDev()) {
    await seedDevIncoming(container);
  }

  const incoming = parseIncoming(container);
  const base = isDev() ? "" : `static/plugins/visualizations/${PLUGIN_NAME}/`;
  // Galaxy's client is the shell's, handed over at launch, which comes before any save.
  let saved: SavedSessions | undefined;
  await mountOrbitBrowser(container, {
    galaxyRoot: incoming.root,
    datasetId: incoming.datasetId,
    galaxyChatUrl: `${incoming.root}api/plugins/${PLUGIN_NAME}`,
    pyodideURL: new URL(`${incoming.root}${base}static/pyodide`, document.baseURI).href,
    createWorker: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    ...OLIT_ARTIFACTS,
    brand: OLIT_BRAND,
    launch: (galaxy) => {
      saved = savedSessions(galaxy);
      return launch(galaxy, incoming);
    },
    sessions: {
      save: (document, id) => saved!.save(document, id),
      savedState: reportSavedState,
      savedNote: "Saved. Open it from GalaxyAI's chats on any device.",
      label: "Save this conversation to GalaxyAI's chats to reopen it on any device",
      keepHint: "Save it to GalaxyAI's chats to keep it.",
      reopenHint: "To reopen a saved conversation, open it from GalaxyAI's chats.",
    },
  });
}

void main();
