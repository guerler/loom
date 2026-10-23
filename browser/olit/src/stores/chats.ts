/** Saves as GalaxyAI's chats, where Olit runs as GalaxyAI's chat: one chat, whose document is the
 * whole session and whose turns are what Galaxy lists and shows of it.
 *
 * Saving is deliberate, as it was for GalaxyAI's own chats, so a save marks a point the user
 * asked for rather than a conversation turn.
 */

import {
  HttpError,
  isSessionDocument,
  SCHEMA,
  segment,
  type Galaxy,
  type SessionDocument,
} from "@galaxyproject/orbit-browser";
import type { Opened, Saves, Store } from "./store";

/** Recorded on each turn Galaxy keeps, naming who held the conversation. */
export const AGENT_TYPE = "olit";

type Entry = SessionDocument["entries"][number];

/** A turn as Galaxy keeps it: what the user asked and what was answered. */
export interface Turn {
  query: string;
  response: string;
}

/** A message of a chat GalaxyAI held, as `api/chat/exchange/{id}/messages` returns it. */
export interface HeldMessage {
  role: "user" | "assistant";
  content: string;
  agent_type?: string;
  timestamp?: string | null;
}

/** A message's text: the string a user typed, or the text blocks of a reply. */
function textOf(message: { content?: unknown }): string {
  let text = "";
  if (typeof message.content === "string") {
    text = message.content;
  } else if (Array.isArray(message.content)) {
    text = message.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
  }
  return text;
}

/** The conversation's turns: each user message, and the last text answered before the next. */
export function turnsOf(entries: readonly Entry[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      const said = textOf(message as { content?: unknown });
      if (entry.kind === "pi.user" && message.role === "user") {
        turns.push({ query: said, response: "" });
      } else if (message.role === "assistant" && said.trim() && turns.length) {
        turns[turns.length - 1]!.response = said;
      }
    }
  }
  return turns;
}

const NO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * A chat GalaxyAI held, as a session Olit continues: its questions and answers, without the steps
 * behind them, which Galaxy never stored. Each answer is from a model Olit is not, so a model
 * continuing it reads them as plain text.
 */
export function heldSession(messages: readonly HeldMessage[], now = new Date()): SessionDocument {
  const when = (message: HeldMessage) => Date.parse(message.timestamp ?? "") || now.getTime();
  const entries: Entry[] = messages.map((message) =>
    message.role === "user"
      ? {
          kind: "pi.user",
          model: [{ role: "user", content: message.content, timestamp: when(message) }],
        }
      : {
          kind: "pi.assistant",
          model: [
            {
              role: "assistant",
              content: [{ type: "text", text: message.content }],
              api: "galaxy-ai",
              provider: "galaxy-ai",
              model: message.agent_type || "galaxy-ai",
              usage: NO_USAGE,
              stopReason: "stop",
              timestamp: when(message),
            },
          ],
        },
  ) as Entry[];
  const started = messages[0]?.timestamp ?? now.toISOString();
  return {
    olit_session: SCHEMA,
    session: {
      id: crypto.randomUUID(),
      title: "",
      createdAt: started,
      updatedAt: started,
      turn: messages.filter((message) => message.role === "user").length,
      models: [{ provider: "galaxy-ai" }],
      usage: { input: 0, output: 0, cost: null },
    },
    entries,
  };
}

/** Said for a chat GalaxyAI held: Olit continues it, and saving adds a chat rather than replace it. */
export const HELD_NOTE =
  "This conversation was held by GalaxyAI before Olit: its questions and answers are here, " +
  "the steps behind them are not. Saving keeps it as a new chat and leaves the original.";

export const chats: Store = {
  kind: "chat",
  wording: {
    savedNote: "Saved. Open it from GalaxyAI's chats on any device.",
    label: "Save this conversation to GalaxyAI's chats to reopen it on any device",
    keepHint: "Save it to GalaxyAI's chats to keep it.",
    reopenHint: "To reopen a saved conversation, open it from GalaxyAI's chats.",
  },
  connect(galaxy: Galaxy): Saves {
    async function create(payload: object): Promise<string> {
      const created = await galaxy.post("api/chat/exchanges", payload);
      return created.id;
    }
    return {
      async load(id) {
        // Galaxy answers only with the signed-in user's own chats.
        const body = await galaxy.get(`api/chat/exchange/${segment(id)}/document`);
        let found: Opened | null = null;
        if (isSessionDocument(body?.document)) {
          found = { document: body.document };
        } else if (body?.document === null) {
          const messages: HeldMessage[] = await galaxy.get(
            `api/chat/exchange/${segment(id)}/messages`,
          );
          found = { document: heldSession(messages), held: { note: HELD_NOTE } };
        }
        return found;
      },
      async save(document, id) {
        const messages = turnsOf(document.entries);
        if (!messages.length) {
          throw new Error("there is nothing to save before the first question");
        }
        const payload = { agent_type: AGENT_TYPE, messages, document };
        let saved: string;
        if (id) {
          // Galaxy replaces only a chat Olit saved; one it no longer has, or one GalaxyAI held,
          // is saved as a new chat.
          saved = await galaxy.put(`api/chat/exchange/${segment(id)}`, payload).then(
            () => id,
            (e) => {
              if (e instanceof HttpError && e.status === 404) return create(payload);
              throw e;
            },
          );
        } else {
          saved = await create(payload);
        }
        return saved;
      },
    };
  },
};
