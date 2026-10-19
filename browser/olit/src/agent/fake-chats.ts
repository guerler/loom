/** For tests: GalaxyAI's saved chats, as a test scripts them. */
import { json } from "@galaxyproject/orbit-browser/testing";

/** A chat as Galaxy keeps it: its turns, and the document a chat plugin saved, null for GalaxyAI's. */
export interface ChatRow {
  agent_type: string;
  messages: Array<{ query: string; response: string }>;
  document: unknown;
}

/**
 * The signed-in user's chats, kept in memory. `answer` serves a request under `api/chat/`, else
 * undefined. Like Galaxy, a replace is refused for a chat no plugin saved.
 */
export function chatStore() {
  const rows = new Map<string, ChatRow>();
  let next = 1;
  async function answer(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname;
    let response: Response | undefined;
    if (path.endsWith("/api/chat/exchanges") && request.method === "POST") {
      const created = `c${next++}`;
      rows.set(created, JSON.parse(await request.text()));
      response = json({ id: created });
    } else if (path.includes("/api/chat/exchange/")) {
      const [id, part] = path.split("/api/chat/exchange/")[1]!.split("/");
      const row = rows.get(id!);
      if (!row || (request.method === "PUT" && row.document === null)) {
        response = json({ err_msg: "No accessible chat exchange found" }, 404);
      } else if (request.method === "PUT") {
        rows.set(id!, JSON.parse(await request.text()));
        response = json({ id });
      } else if (part === "document") {
        response = json({ id, agent_type: row.agent_type, document: row.document });
      } else if (part === "messages") {
        response = json(
          row.messages.flatMap((turn) => [
            { role: "user", content: turn.query, timestamp: "2026-10-01T10:00:00" },
            {
              role: "assistant",
              content: turn.response,
              agent_type: row.agent_type,
              timestamp: "2026-10-01T10:00:00",
            },
          ]),
        );
      }
    }
    return response;
  }
  return { rows, answer };
}
