import { describe, expect, it, vi } from "vitest";

import contract from "./conformance.json";
import { connectHost, type HostConnection } from "./connect";
import { ERRORS, METHODS, PROTOCOL_VERSION } from "./protocol";
import { flush } from "./testing";

/** Errors match by code: their message is the side's own words. */
const matchable = (message: any) =>
  message?.error ? { ...message, error: { code: message.error.code } } : message;

describe("the contract", () => {
  it("names the version, methods and errors protocol.ts does", () => {
    expect(contract.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(contract.methods).toEqual(METHODS);
    expect(contract.errors).toEqual(ERRORS);
  });
});

describe("the brain, replaying the contract's sessions", () => {
  it.each(
    contract.sessions
      .filter((session) => session.checks.includes("brain"))
      .map((s) => [s.name, s] as const),
  )("%s", async (_, session) => {
    const received: any[] = [];
    const parent = { postMessage: vi.fn((message) => received.push(message)) } as unknown as Window;
    let port: MessagePort | undefined;
    let connection: HostConnection | undefined;
    const connecting = connectHost({
      clientInfo: contract.clientInfo,
      capabilities: (session.messages[0]!.message as any).params.capabilities,
      handlers: { open: () => {}, ask: () => {} },
      parent,
    }).then((given) => (connection = given));
    /** What came of each request the brain made, by its id. */
    const outcomes = new Map<unknown, Promise<unknown>>();
    let seen = 0;
    for (const step of session.messages) {
      const message = step.message as any;
      if (step.from === "host") {
        if ((step as { port?: boolean }).port) {
          const channel = new MessageChannel();
          port = channel.port1;
          port.onmessage = (event) => received.push(event.data);
          window.dispatchEvent(
            new MessageEvent("message", {
              data: message,
              origin: window.location.origin,
              source: parent as never,
              ports: [channel.port2],
            }),
          );
          await connecting;
        } else {
          port!.postMessage(message);
        }
        await flush();
        if (!message.method && outcomes.has(message.id)) {
          // The brain's own request is settled as the host answered it.
          const { result, error } = message;
          await expect(outcomes.get(message.id)).resolves.toEqual(
            error ? { error: { code: error.code } } : { result },
          );
        }
      } else {
        // The brain's own requests and reports are made through its connection; the rest it sends
        // by itself: initialize and initialized as it connects, and its answers.
        if (message.method === contract.methods.chatActiveChanged) {
          connection!.activeChanged(message.params.exchange_id);
        } else if (message.method === contract.methods.chatUnsavedChanged) {
          connection!.unsavedChanged(message.params.unsaved);
        } else if (message.method && message.id !== undefined && message.method !== "initialize") {
          outcomes.set(
            message.id,
            connection!.request(message.method, message.params).then(
              (result) => ({ result }),
              (e) => ({ error: { code: e.code } }),
            ),
          );
        }
        await flush();
        expect(matchable(received[seen++])).toEqual(matchable(message));
      }
    }
    expect(received).toHaveLength(seen);
    connection?.close();
  });
});
