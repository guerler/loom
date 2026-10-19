/**
 * The brain's side of GalaxyAI's brain protocol (`protocol.ts`): initializes with the window that
 * mounted it, then takes its commands, reports the conversation shown and asks what the host offers
 * over the port the host hands back. Knows nothing of Olit.
 */
import { createPeer, DEFAULT_TIMEOUT_MS, isMessage, type Message, RpcError } from "./jsonrpc";
import {
  type Capabilities,
  type ChatAskParams,
  type ChatOpenParams,
  ERRORS,
  type Info,
  type InitializeParams,
  type InitializeResult,
  METHODS,
  PROTOCOL_VERSION,
} from "./protocol";

export interface BrainHandlers {
  /** Accept a command; its effect is reported later, through `activeChanged`. */
  open(params: ChatOpenParams): void;
  ask(params: ChatAskParams): void;
}

export interface HostConnection {
  host: Info;
  /** The features the host takes part in: a request belongs to one the host declared. */
  capabilities: Capabilities;
  /** Tell the host which saved chat is shown now, null while it is not saved. */
  activeChanged(exchangeId: string | null): void;
  request<T = unknown>(method: string, params?: object): Promise<T>;
  close(): void;
}

export interface ConnectOptions {
  clientInfo: Info;
  handlers: BrainHandlers;
  /** How long to wait for the host's answer to `initialize`. */
  timeoutMs?: number;
  /** The window that mounted this one, and this one; for tests. */
  parent?: Window;
  self?: Window;
}

function invalid(message: string): never {
  throw new RpcError(ERRORS.INVALID_PARAMS, message);
}

function openParams(params: unknown): ChatOpenParams {
  const id = (params as ChatOpenParams | undefined)?.exchange_id;
  if (id !== undefined && (typeof id !== "string" || !id)) invalid("exchange_id must be a chat id");
  return id ? { exchange_id: id } : {};
}

function askParams(params: unknown): ChatAskParams {
  const question = (params as ChatAskParams | undefined)?.question;
  if (typeof question !== "string" || !question.trim()) invalid("question must be text");
  return { question };
}

/** The host's answer to `initialize`, and the port the session goes over. */
function handshake(
  parent: Window,
  self: Window,
  origin: string,
  params: InitializeParams,
  timeoutMs: number,
): Promise<{ result: InitializeResult; port: MessagePort }> {
  const id = 1;
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      self.removeEventListener("message", listener);
    };
    const listener = (event: MessageEvent) => {
      const message = event.data as Message;
      if (
        event.source === parent &&
        event.origin === origin &&
        isMessage(message) &&
        message.id === id
      ) {
        done();
        const error = message.error as { code?: unknown; message?: unknown } | undefined;
        const port = event.ports[0];
        if (error) {
          reject(new RpcError(Number(error.code), String(error.message ?? "error")));
        } else if (!port) {
          reject(new Error("the host's answer brought no port for the session"));
        } else {
          resolve({ result: message.result as InitializeResult, port });
        }
      }
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`no answer within ${timeoutMs} ms`));
    }, timeoutMs);
    self.addEventListener("message", listener);
    parent.postMessage({ jsonrpc: "2.0", id, method: METHODS.initialize, params }, origin);
  });
}

/**
 * Connects to the GalaxyAI host that mounted this frame, for a brain that is in one. Rejects, saying why, when the host does not
 * answer in time, speaks another version or does not take part in chat. The handlers may be called
 * from the moment it resolves.
 */
export async function connectHost(options: ConnectOptions): Promise<HostConnection> {
  const parent = options.parent ?? window.parent;
  const self = options.self ?? window;
  // The document's origin: a frame without a src reads "null" from location.origin, not Galaxy's.
  // DOMs for tests lack it, and have a location to fall back to.
  const origin = self.origin ?? self.location.origin;
  const { result, port } = await handshake(
    parent,
    self,
    origin,
    {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: options.clientInfo,
      capabilities: { chat: {} },
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let problem: string | undefined;
  if (result?.protocolVersion !== PROTOCOL_VERSION) {
    problem = `the host speaks version ${result?.protocolVersion}, this brain ${PROTOCOL_VERSION}`;
  } else if (!result.capabilities?.chat) {
    problem = "the host does not take part in chat";
  }
  let connection: HostConnection | undefined;
  if (problem) {
    port.close();
  } else {
    const peer = createPeer((message) => port.postMessage(message), {
      requests: {
        [METHODS.chatOpen]: (params) => options.handlers.open(openParams(params)),
        [METHODS.chatAsk]: (params) => options.handlers.ask(askParams(params)),
      },
    });
    port.onmessage = (event) => peer.receive(event.data);
    peer.notify(METHODS.initialized);
    connection = {
      host: result.hostInfo,
      capabilities: result.capabilities,
      activeChanged: (exchangeId) =>
        peer.notify(METHODS.chatActiveChanged, { exchange_id: exchangeId }),
      request: (method, params) => peer.request(method, params),
      close: () => {
        peer.close("The brain closed the connection.");
        port.close();
      },
    };
  }
  if (!connection) throw new Error(problem);
  return connection;
}
