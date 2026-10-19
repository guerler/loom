import { vi } from "vitest";

import { PROTOCOL_VERSION } from "./protocol";

/**
 * A GalaxyAI host written as raw messages, so the wire contract is checked rather than this
 * module's own JSON-RPC code: it answers `initialize` into this window with a port, as told, and
 * records what the brain posts on the window and on the port.
 */
export function mockHost(
  answer: "galaxy" | "silent" | "other-version" | "no-chat" | "no-port" = "galaxy",
  capabilities: object = { chat: {} },
) {
  const received: any[] = [];
  let port: MessagePort | undefined;
  const parent = {
    postMessage: vi.fn((message: any) => {
      received.push(message);
      if (message.method === "initialize" && answer !== "silent") {
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (event) => received.push(event.data);
        toWindow(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: answer === "other-version" ? "1999-01-01" : PROTOCOL_VERSION,
              hostInfo: { name: "galaxy", version: "test" },
              capabilities: answer === "no-chat" ? {} : capabilities,
            },
          },
          { ports: answer === "no-port" ? [] : [channel.port2] },
        );
      }
    }),
  } as unknown as Window;
  /** Posts into this window, as the host answers the handshake. */
  function toWindow(data: unknown, overrides: Partial<MessageEventInit> = {}) {
    setTimeout(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin: window.location.origin,
          source: parent as never,
          ...overrides,
        }),
      ),
    );
  }
  /** Posts on the session's port, as everything after the handshake goes. */
  const send = (data: unknown) => port!.postMessage(data);
  return { parent, received, toWindow, send, port: () => port };
}

/** Lets messages on a port arrive, which they do as tasks of their own. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 10));
