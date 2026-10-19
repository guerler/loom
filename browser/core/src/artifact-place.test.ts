/**
 * The artifact pane apart from the chat: a place the shell hands its artifacts to while it is there,
 * and the page that shows them (`mountArtifactView`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveCredentials } from "./credentials";
import { mountArtifactView } from "./artifact-view";
import { mountOrbitBrowser, type ArtifactPlace } from "./shell";
import type { Artifact } from "./artifacts";
import type { WorkerMessage } from "./agent/worker";

// A kind drawn as its text, so the tests read what was drawn where.
const KINDS = [{ kind: "note", toPage: null }] as any;
const RENDERERS = {
  note: (body: HTMLElement, a: { text: string }) => (body.textContent = a.text),
} as any;
const note = (text: string) => ({ kind: "note", title: "", text }) as unknown as Artifact;

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A place the test moves in and out, recording what it was given. */
function fakePlace() {
  let changed: (() => void) | undefined;
  const place = {
    here: false,
    shows: [] as Array<{ texts: string[]; reveal: boolean }>,
    present: () => place.here,
    show: (artifacts: Artifact[], reveal: boolean) =>
      place.shows.push({ texts: artifacts.map((a) => (a as any).text), reveal }),
    watch: (callback: () => void, _signal: AbortSignal) => (changed = callback),
    move: (here: boolean) => {
      place.here = here;
      changed?.();
    },
  };
  return place satisfies ArtifactPlace;
}

function fakeWorker() {
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
    say: (data: unknown) => worker.onmessage?.({ data } as MessageEvent),
  };
  return worker;
}

/** A result that made these artifacts, as the worker reports it live. */
const made = (...artifacts: Artifact[]) =>
  ({
    type: "events",
    events: [
      {
        type: "message_end",
        entry: {
          id: 1,
          conversationId: 1,
          kind: "pi.tool-result",
          model: [
            {
              role: "toolResult",
              toolCallId: "c1",
              toolName: "make",
              content: [{ type: "text", text: "made" }],
              details: { artifacts },
              isError: false,
              timestamp: 0,
            },
          ],
        },
      },
    ],
  }) as unknown as WorkerMessage;

let container: HTMLElement;
beforeEach(() => {
  saveCredentials({ provider: "galaxy" });
  container = document.body.appendChild(document.createElement("div"));
});
afterEach(() => {
  container.remove();
  sessionStorage.clear();
  localStorage.clear();
});

async function mountWith(place: ArtifactPlace) {
  const worker = fakeWorker();
  const handle = await mountOrbitBrowser(container, {
    galaxyRoot: "/",
    galaxyChatUrl: "/api/plugins/test",
    pyodideURL: "/pyodide/",
    createWorker: () => worker as unknown as Worker,
    launch: async () => ({ historyId: "h1" }),
    artifactKinds: KINDS,
    renderers: RENDERERS,
    artifactPlace: place,
  });
  const content = () => container.querySelector("#artifact-content")!;
  const button = () => container.querySelector<HTMLButtonElement>("#artifact-btn")!;
  return { worker, handle, content, button };
}

describe("the shell with a place apart", () => {
  it("clears a place already there as it mounts, so it does not show the last conversation's", async () => {
    const place = fakePlace();
    place.here = true;
    await mountWith(place);
    await settle();
    expect(place.shows).toEqual([{ texts: [], reveal: false }]);
  });

  it("hands what a result made to the place, opening it, and keeps its own pane empty", async () => {
    const place = fakePlace();
    place.here = true;
    const { worker, content, button } = await mountWith(place);
    worker.say(made(note("chart")));
    await settle();
    expect(place.shows.at(-1)).toEqual({ texts: ["chart"], reveal: true });
    expect(content().childElementCount).toBe(0);
    // Its button brings the place into view rather than opening an empty pane.
    expect(button().classList.contains("hidden")).toBe(false);
    button().click();
    expect(place.shows.at(-1)).toEqual({ texts: ["chart"], reveal: true });
  });

  it("draws in its own pane while there is no place, and moves what it shows as the place comes and goes", async () => {
    const place = fakePlace();
    const { worker, content } = await mountWith(place);
    worker.say(made(note("chart")));
    await settle();
    expect(content().textContent).toContain("chart");
    expect(place.shows).toEqual([]);
    place.move(true);
    await settle();
    // Not opened: the place came, nothing new was made.
    expect(place.shows).toEqual([{ texts: ["chart"], reveal: false }]);
    expect(content().childElementCount).toBe(0);
    place.move(false);
    await settle();
    expect(content().textContent).toContain("chart");
    // Handed back, it opens beside the chat, where the place showed it until now.
    expect(document.body.classList.contains("artifact-collapsed")).toBe(false);
  });

  it("empties the place for a new conversation", async () => {
    const place = fakePlace();
    place.here = true;
    const { worker } = await mountWith(place);
    worker.say(made(note("chart")));
    worker.say({ type: "ready" });
    await settle();
    place.shows.length = 0;
    container.querySelector<HTMLButtonElement>("#reset-btn")!.click();
    await settle();
    expect(place.shows).toEqual([{ texts: [], reveal: false }]);
  });

  it("stops listening for the place once disposed", async () => {
    const place = fakePlace();
    const watch = vi.spyOn(place, "watch");
    const { handle } = await mountWith(place);
    const signal = watch.mock.calls[0]![1] as AbortSignal;
    handle.dispose();
    expect(signal.aborted).toBe(true);
  });
});

describe("the pane on a page of its own", () => {
  const view = () =>
    mountArtifactView(container, { galaxyRoot: "/", artifactKinds: KINDS, renderers: RENDERERS });

  it("says what shows there while it has nothing", () => {
    view();
    expect(container.textContent).toContain("Charts and diagrams Orbit makes show here.");
  });

  it("shows what it is given in place of what it showed", async () => {
    const pane = view();
    await pane.show([note("first")]);
    await pane.show([note("second"), note("third")]);
    const shown = container.querySelector(".artifact-view-content")!.textContent;
    expect(shown).toContain("second");
    expect(shown).toContain("third");
    expect(shown).not.toContain("first");
    expect(container.querySelector<HTMLElement>(".artifact-view-empty")!.hidden).toBe(true);
    await pane.show([]);
    expect(container.querySelector<HTMLElement>(".artifact-view-empty")!.hidden).toBe(false);
  });

  it("says when it cannot draw one, and goes on with the rest", async () => {
    const pane = view();
    await pane.show([{ kind: "unknown", title: "" } as unknown as Artifact, note("after")]);
    const shown = container.querySelector(".artifact-view-content")!.textContent;
    expect(shown).toContain("Could not show the artifact");
    expect(shown).toContain("after");
  });
});
