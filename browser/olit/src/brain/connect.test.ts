import { afterEach, describe, expect, it, vi } from "vitest";

import { connectHost, type HostConnection } from "./connect";
import { PROTOCOL_VERSION } from "./protocol";

/**
 * A GalaxyAI host written as raw messages, so the wire contract is checked rather than this
 * module's own JSON-RPC code: it answers `initialize` as told and records what the brain posts.
 */
function mockHost(answer: "galaxy" | "silent" | "other-version" | "no-chat" = "galaxy") {
  const received: any[] = [];
  const parent = {
    postMessage: vi.fn((message: any) => {
      received.push(message);
      if (message.method === "initialize" && answer !== "silent") {
        post({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: answer === "other-version" ? "1999-01-01" : PROTOCOL_VERSION,
            hostInfo: { name: "galaxy", version: "test" },
            capabilities: answer === "no-chat" ? {} : { chat: {} },
          },
        });
      }
    }),
  } as unknown as Window;
  function post(data: unknown, origin = window.location.origin) {
    setTimeout(() =>
      window.dispatchEvent(new MessageEvent("message", { data, origin, source: parent as never })),
    );
  }
  return { parent, received, post };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

let connections: HostConnection[] = [];
afterEach(() => {
  connections.forEach((c) => c.close());
  connections = [];
});

async function connect(host: ReturnType<typeof mockHost>, timeoutMs = 100) {
  const open = vi.fn();
  const ask = vi.fn();
  const connection = await connectHost({
    clientInfo: { name: "olit", version: "test" },
    handlers: { open, ask },
    parent: host.parent,
    timeoutMs,
  });
  if (connection) connections.push(connection);
  return { connection, open, ask };
}

describe("connecting to GalaxyAI", () => {
  it("initializes, then says it is initialized", async () => {
    const host = mockHost();
    const { connection } = await connect(host);
    expect(connection?.host).toEqual({ name: "galaxy", version: "test" });
    expect(host.received).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: "olit", version: "test" },
          capabilities: { chat: {} },
        },
      },
      { jsonrpc: "2.0", method: "initialized" },
    ]);
  });

  it.each([
    ["no host answers", "silent"],
    ["the host speaks another version", "other-version"],
    ["the host does not take part in chat", "no-chat"],
  ] as const)("is not connected when %s", async (_, answer) => {
    const host = mockHost(answer);
    const { connection } = await connect(host);
    expect(connection).toBeNull();
    expect(host.received.some((m) => m.method === "initialized")).toBe(false);
  });

  it("is not connected without a window that mounted it", async () => {
    const connection = await connectHost({
      clientInfo: { name: "olit", version: "test" },
      handlers: { open: vi.fn(), ask: vi.fn() },
      parent: window,
    });
    expect(connection).toBeNull();
  });
});

describe("a connection", () => {
  it("accepts commands and acknowledges them", async () => {
    const host = mockHost();
    const { open, ask } = await connect(host);
    host.post({ jsonrpc: "2.0", id: 1, method: "chat/open", params: { exchange_id: "c1" } });
    host.post({ jsonrpc: "2.0", id: 2, method: "chat/open", params: {} });
    host.post({ jsonrpc: "2.0", id: 3, method: "chat/ask", params: { question: "How many?" } });
    await flush();
    expect(open.mock.calls).toEqual([[{ exchange_id: "c1" }], [{}]]);
    expect(ask).toHaveBeenCalledWith({ question: "How many?" });
    expect(host.received.slice(2)).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
      { jsonrpc: "2.0", id: 3, result: {} },
    ]);
  });

  it("refuses malformed commands and ones it does not know", async () => {
    const host = mockHost();
    const { ask } = await connect(host);
    host.post({ jsonrpc: "2.0", id: 4, method: "chat/ask", params: { question: " " } });
    host.post({ jsonrpc: "2.0", id: 5, method: "context/changed", params: {} });
    await flush();
    expect(ask).not.toHaveBeenCalled();
    expect(host.received.slice(2)).toEqual([
      { jsonrpc: "2.0", id: 4, error: { code: -32602, message: "question must be text" } },
      {
        jsonrpc: "2.0",
        id: 5,
        error: { code: -32601, message: "Method not found: context/changed" },
      },
    ]);
  });

  it("ignores messages from elsewhere", async () => {
    const host = mockHost();
    const { open } = await connect(host);
    host.post({ jsonrpc: "2.0", id: 6, method: "chat/open", params: {} }, "https://elsewhere");
    await flush();
    expect(open).not.toHaveBeenCalled();
  });

  it("reports the chat shown", async () => {
    const host = mockHost();
    const { connection } = await connect(host);
    connection!.activeChanged("c1");
    connection!.activeChanged(null);
    expect(host.received.slice(2)).toEqual([
      { jsonrpc: "2.0", method: "chat/activeChanged", params: { exchange_id: "c1" } },
      { jsonrpc: "2.0", method: "chat/activeChanged", params: { exchange_id: null } },
    ]);
  });
});
