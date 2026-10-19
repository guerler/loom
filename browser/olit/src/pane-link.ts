/**
 * Olit's chat and its pane apart (`chat.pane`): two frames of this plugin on one Galaxy page, which
 * find each other among the page's frames and talk by `postMessage`, so Galaxy only places them.
 * Each marks its own window with its role; the page's frames are its siblings.
 */
import type { ArtifactPlace, ArtifactView } from "@galaxyproject/orbit-browser";
import type { Artifact } from "@galaxyproject/orbit-browser/artifacts";

const ROLE = "__olitView";

type Role = "chat" | "pane";

/** What one frame tells the other. */
type Note = { olit: "pane-here" } | { olit: "pane-gone" } | { olit: "show"; artifacts: Artifact[] };

const NOTES = new Set(["pane-here", "pane-gone", "show"]);

function isNote(data: unknown): data is Note {
  return NOTES.has((data as { olit?: unknown } | null)?.olit as string);
}

/** This frame's sibling playing `role`; a frame of another origin is not one. */
export function sibling(role: Role, self: Window = window): Window | undefined {
  let found: Window | undefined;
  const frames = self.parent.frames;
  for (let i = 0; i < frames.length && !found; i++) {
    try {
      const frame = frames[i]!;
      if (frame !== self && (frame as any)[ROLE] === role) found = frame;
    } catch {
      // Another origin's frame, which is not Olit's.
    }
  }
  return found;
}

/**
 * The chat's side: a pane apart is where the artifacts show while it is there. `reveal` asks Galaxy
 * to bring it into view.
 */
export function chatSide(reveal: () => void, self: Window = window): ArtifactPlace {
  (self as any)[ROLE] = "chat";
  const origin = self.origin ?? self.location.origin;
  return {
    present: () => !!sibling("pane", self),
    show(artifacts, open) {
      const note: Note = { olit: "show", artifacts };
      sibling("pane", self)?.postMessage(note, origin);
      if (open) reveal();
    },
    watch(changed, signal) {
      self.addEventListener(
        "message",
        (event) => {
          const note = event.data;
          if (event.origin === origin && isNote(note) && note.olit !== "show") changed();
        },
        { signal },
      );
    },
  };
}

/** The pane's side: shows what the chat sends, and tells the chat when it comes and goes. */
export function paneSide(view: ArtifactView, self: Window = window): void {
  (self as any)[ROLE] = "pane";
  const origin = self.origin ?? self.location.origin;
  self.addEventListener("message", (event) => {
    const note = event.data;
    if (event.origin === origin && isNote(note) && note.olit === "show") {
      void view.show(note.artifacts);
    }
  });
  const tell = (note: Note) => sibling("chat", self)?.postMessage(note, origin);
  // A chat that loads later finds the pane there and fills it as it mounts.
  tell({ olit: "pane-here" });
  self.addEventListener("pagehide", () => {
    // No longer a pane by the time the chat looks again.
    (self as any)[ROLE] = undefined;
    tell({ olit: "pane-gone" });
  });
}
