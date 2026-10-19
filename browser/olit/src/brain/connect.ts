/**
 * The brain's side of GalaxyAI's brain protocol (`protocol.ts`): initializes with the window that
 * mounted it, takes its commands and reports the conversation shown. Knows nothing of Olit.
 */
import { createPeer, isMessage, RpcError } from "./jsonrpc";
import {
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
  /** Tell the host which saved chat is shown now, null while it is not saved. */
  activeChanged(exchangeId: string | null): void;
  close(): void;
}

export interface ConnectOptions {
  clientInfo: Info;
  handlers: BrainHandlers;
  /** How long to wait for a host to answer `initialize`; none answering means there is none. */
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

/**
 * Connects to the GalaxyAI host that mounted this frame, or resolves null when there is none: no
 * parent, no answer, another protocol version, or a host that does not take part in chat. The
 * handlers may be called from the moment it resolves.
 */
export async function connectHost(options: ConnectOptions): Promise<HostConnection | null> {
  const parent = options.parent ?? window.parent;
  const self = options.self ?? window;
  // The document's origin: a frame without a src reads "null" from location.origin, not Galaxy's.
  // DOMs for tests lack it, and have a location to fall back to.
  const origin = self.origin ?? self.location.origin;
  let connection: HostConnection | null = null;
  if (parent && parent !== self) {
    const peer = createPeer((message) => parent.postMessage(message, origin), {
      requests: {
        [METHODS.chatOpen]: (params) => options.handlers.open(openParams(params)),
        [METHODS.chatAsk]: (params) => options.handlers.ask(askParams(params)),
      },
    });
    const listener = (event: MessageEvent) => {
      if (event.source === parent && event.origin === origin && isMessage(event.data)) {
        peer.receive(event.data);
      }
    };
    self.addEventListener("message", listener);
    const close = () => {
      self.removeEventListener("message", listener);
      peer.close("The brain closed the connection.");
    };
    const params: InitializeParams = {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: options.clientInfo,
      capabilities: { chat: {} },
    };
    const result = await peer
      .request<InitializeResult>(METHODS.initialize, params, options.timeoutMs ?? 3000)
      .catch(() => null);
    if (result?.protocolVersion === PROTOCOL_VERSION && result.capabilities?.chat) {
      peer.notify(METHODS.initialized);
      connection = {
        host: result.hostInfo,
        activeChanged: (exchangeId) =>
          peer.notify(METHODS.chatActiveChanged, { exchange_id: exchangeId }),
        close,
      };
    } else {
      close();
    }
  }
  return connection;
}
