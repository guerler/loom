/** Thin adapter for the Charts framework `data-incoming` contract. */

/** Olit as a visualization of its own; what Galaxy means by giving no view. */
export const VISUALIZATION_VIEW = "visualization";
/** The view GalaxyAI mounts Olit with as its chat (`CHAT_CONFIG` in Galaxy's `AiChatBrain.vue`). */
export const CHAT_VIEW = "chat";
/** The view GalaxyAI mounts Olit's pane apart from that chat with (`chat.pane`, `PANE_CONFIG`). */
export const PANE_VIEW = "pane";

export type View = typeof VISUALIZATION_VIEW | typeof CHAT_VIEW | typeof PANE_VIEW;

const VIEWS: readonly string[] = [VISUALIZATION_VIEW, CHAT_VIEW, PANE_VIEW];

export interface OlitIncoming {
  root: string;
  /** How Galaxy mounted Olit. */
  view: View;
  /** Set when Galaxy opened a saved visualization, naming the record to write back to. */
  visualizationId?: string;
  datasetId?: string;
  specs: Record<string, any>;
  settings: Record<string, any>;
}

/** `hostSearch` is the hosting page's query, read for a `visualization_id` the config lacks. */
export function parseIncoming(container: HTMLElement, hostSearch = ""): OlitIncoming {
  let raw: any;
  try {
    raw = JSON.parse(container.dataset.incoming || "{}");
  } catch (e) {
    throw new Error(`data-incoming is not JSON: ${e}`);
  }
  const config = raw.visualization_config || {};
  const plugin = raw.visualization_plugin || {};
  return {
    root: raw.root || "/",
    view: VIEWS.includes(config.view) ? config.view : VISUALIZATION_VIEW,
    visualizationId:
      raw.visualization_id || new URLSearchParams(hostSearch).get("visualization_id") || undefined,
    datasetId: config.dataset_id,
    specs: plugin.specs || raw.specs || {},
    settings: config.settings || {},
  };
}

/** The hosting Galaxy page's query; its iframe has no src, so it shares Galaxy's origin. */
export function hostSearch(): string {
  try {
    return window.parent === window ? "" : window.parent.location.search;
  } catch {
    return "";
  }
}
