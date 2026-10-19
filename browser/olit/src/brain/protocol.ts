/**
 * Mirrors Galaxy's `client/src/components/GalaxyAI/brain/protocol.ts`: the protocol, not
 * shared code, is the contract between the two.
 *
 * The protocol between GalaxyAI's wrapper (the host, Galaxy's client) and the AI brain it mounts
 * (`ai_chat_plugin`, a same-origin iframe). JSON-RPC 2.0 over `postMessage`, initialized and
 * negotiated as MCP Apps does, without the rest of MCP Apps.
 *
 * Galaxy's API stays authoritative for data and state: the brain reads and writes them itself, with
 * the user's session. Messages only coordinate the two UIs: commands the host gives, and events the
 * brain reports.
 *
 * Lifecycle:
 * 1. The host listens before it loads the brain.
 * 2. The brain requests `initialize`; the host answers with its version, info and capabilities.
 * 3. The brain notifies `initialized`. The host sends nothing before it.
 * 4. The host sends one initial command (`chat/open` or `chat/ask`), then any others as they come.
 * Each `initialize` starts a new session; a brain that loads again ends the one before, and each side
 * fails the requests still pending in it. When the host removes the brain it fails its own pending
 * requests and stops listening.
 *
 * Rules:
 * - Each side accepts messages only from its counterpart (the brain's frame, the parent window) and
 *   only from Galaxy's origin, and posts to that origin, never to "*". No batches.
 * - Every request gets one response. The requester times it out; a late response is dropped.
 * - A command's result says it was accepted, not that its effect is done: effects are reported by
 *   events, which are authoritative.
 * - Additive evolution: params and results are objects, unknown fields and unknown notifications are
 *   ignored, an unknown request is answered with `METHOD_NOT_FOUND`. Methods come in features, which
 *   each side declares in `capabilities`; neither side calls a feature the other did not declare.
 *   `protocolVersion` changes only for a breaking change.
 */

/** The version spoken here. */
export const PROTOCOL_VERSION = "2026-10-19";

export const METHODS = {
  initialize: "initialize",
  initialized: "initialized",
  chatOpen: "chat/open",
  chatAsk: "chat/ask",
  chatActiveChanged: "chat/activeChanged",
} as const;

/** JSON-RPC 2.0's own error codes, the only ones this version uses. */
export const ERRORS = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export interface Info {
  name: string;
  version: string;
}

/**
 * Features each side takes part in, keyed by name; unknown keys are ignored. `chat`: the brain
 * handles `chat/open` and `chat/ask` and sends `chat/activeChanged`; the host sends the commands and
 * accepts the event.
 */
export interface Capabilities {
  chat?: Record<string, never>;
  [feature: string]: unknown;
}

export interface InitializeParams {
  protocolVersion: string;
  clientInfo: Info;
  capabilities: Capabilities;
}

export interface InitializeResult {
  protocolVersion: string;
  hostInfo: Info;
  capabilities: Capabilities;
}

/** Show this saved chat; without an id, the brain's own default (e.g. the conversation it last had). */
export interface ChatOpenParams {
  exchange_id?: string;
}

/** Start a new conversation with this question. Accepted, not answered, when the request returns. */
export interface ChatAskParams {
  question: string;
}

/** The conversation the brain now shows, by its saved chat's id; null while it is not saved. */
export interface ChatActiveChangedParams {
  exchange_id: string | null;
}
