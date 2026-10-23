/**
 * Where Olit's conversations are saved in Galaxy. Each way Galaxy runs Olit saves to a store of its
 * own (visualizations.ts, chats.ts), and launch.ts opens and saves through whichever it is given.
 */
import type { Galaxy, SessionDocument, SessionStore } from "@galaxyproject/orbit-browser";

/** A saved session the signed-in user does not own, which Galaxy may still show them. */
export class NotYours extends Error {}

/** A saved conversation as Olit opens it. */
export interface Opened {
  document: SessionDocument;
  /**
   * Set for a conversation Olit did not save, such as a chat GalaxyAI held: it continues in Galaxy's
   * current history, this is said after the ready line, and a save adds a new one rather than replace it.
   */
  held?: { note: string };
}

/** A store's saves, through the signed-in user's Galaxy. */
export interface Saves {
  /**
   * The conversation saved at `id`, or null if it is not one Olit can open. Throws `NotYours` for
   * one the signed-in user does not own.
   */
  load(id: string): Promise<Opened | null>;
  /** Create, or replace the save at `id`, returning the save's id. */
  save(document: SessionDocument, id?: string): Promise<string>;
}

export interface Store {
  /** The store's name, which this browser knows its saves by (`SessionStore.kind`). */
  kind: string;
  /** What the page says of saving, naming where a save goes. */
  wording: Pick<SessionStore, "savedNote" | "label" | "keepHint" | "reopenHint">;
  connect(galaxy: Galaxy): Saves;
}
