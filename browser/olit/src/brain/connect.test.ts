import { afterEach, describe, expect, it, vi } from "vitest";

import { connectHost, type HostConnection } from "./connect";
import { PROTOCOL_VERSION } from "./protocol";
import { flush, mockHost } from "./testing";

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
  connections.push(connection);
  await flush();
  return { connection, open, ask };
}

describe("connecting to GalaxyAI", () => {
  it("initializes on the window, then says it is initialized on the port it was given", async () => {
    const host = mockHost();
    const { connection } = await connect(host);
    expect(connection.host).toEqual({ name: "galaxy", version: "test" });
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
    ["no host answers", "silent", /no answer within 100 ms/],
    ["the host speaks another version", "other-version", /version 1999-01-01/],
    ["the host does not take part in chat", "no-chat", /does not take part in chat/],
    ["the host's answer brings no port", "no-port", /no port/],
  ] as const)("fails, saying why, when %s", async (_, answer, why) => {
    const host = mockHost(answer);
    await expect(connect(host)).rejects.toThrow(why);
    await flush();
    expect(host.received.some((m) => m.method === "initialized")).toBe(false);
  });

  it("takes the answer only from the window that mounted it, at Galaxy's origin", async () => {
    const host = mockHost("silent");
    const connecting = connectHost({
      clientInfo: { name: "olit", version: "test" },
      handlers: { open: vi.fn(), ask: vi.fn() },
      parent: host.parent,
      timeoutMs: 100,
    });
    const answer = {
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: PROTOCOL_VERSION, hostInfo: {}, capabilities: { chat: {} } },
    };
    const { port2 } = new MessageChannel();
    host.toWindow(answer, { origin: "https://elsewhere", ports: [port2] });
    host.toWindow(answer, { source: window as never, ports: [port2] });
    await expect(connecting).rejects.toThrow(/no answer/);
    port2.close();
  });
});

describe("a connection", () => {
  it("accepts commands on its port and acknowledges them", async () => {
    const host = mockHost();
    const { open, ask } = await connect(host);
    host.send({ jsonrpc: "2.0", id: 1, method: "chat/open", params: { exchange_id: "c1" } });
    host.send({ jsonrpc: "2.0", id: 2, method: "chat/open", params: {} });
    host.send({ jsonrpc: "2.0", id: 3, method: "chat/ask", params: { question: "How many?" } });
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
    host.send({ jsonrpc: "2.0", id: 4, method: "chat/ask", params: { question: " " } });
    host.send({ jsonrpc: "2.0", id: 5, method: "context/changed", params: {} });
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

  it("takes nothing from the window once it has its port", async () => {
    const host = mockHost();
    const { open } = await connect(host);
    host.toWindow({ jsonrpc: "2.0", id: 6, method: "chat/open", params: {} });
    await flush();
    expect(open).not.toHaveBeenCalled();
  });

  it("reports the chat shown", async () => {
    const host = mockHost();
    const { connection } = await connect(host);
    connection.activeChanged("c1");
    connection.activeChanged(null);
    await flush();
    expect(host.received.slice(2)).toEqual([
      { jsonrpc: "2.0", method: "chat/activeChanged", params: { exchange_id: "c1" } },
      { jsonrpc: "2.0", method: "chat/activeChanged", params: { exchange_id: null } },
    ]);
  });

  it("asks the host for a feature the host declared, and gets its answer", async () => {
    const host = mockHost("galaxy", { chat: {}, example: {} });
    const { connection } = await connect(host);
    expect(connection.capabilities).toEqual({ chat: {}, example: {} });
    const echoed = connection.request("example/echo", { text: "hello" });
    await flush();
    const asked = host.received[2];
    expect(asked).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "example/echo",
      params: { text: "hello" },
    });
    host.send({ jsonrpc: "2.0", id: asked.id, result: { text: "hello" } });
    await expect(echoed).resolves.toEqual({ text: "hello" });
  });

  it("is told when the host refuses what it asks", async () => {
    const host = mockHost();
    const { connection } = await connect(host);
    const navigated = connection.request("ui/navigate", { path: "/" });
    await flush();
    host.send({
      jsonrpc: "2.0",
      id: host.received[2].id,
      error: { code: -32601, message: "Method not found: ui/navigate" },
    });
    await expect(navigated).rejects.toMatchObject({ code: -32601 });
  });
});
