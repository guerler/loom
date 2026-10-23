import type { OlitIncoming } from "../incoming";

/**
 * One way Galaxy runs Olit, picked by the view Galaxy mounts it with (main.ts). Each mode decides
 * what it shows and how it tells its host; launching and saving go through launch.ts and the
 * mode's store, so the agent, the shell and the tools never know which mode they run in.
 */
export interface OlitMode {
  mount(container: HTMLElement, incoming: OlitIncoming): Promise<void>;
}
