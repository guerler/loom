import { afterEach, describe, expect, it, vi } from "vitest";
import { chatStore } from "./agent/fake-chats";
import { connectGalaxy } from "@galaxyproject/orbit-browser/testing";
import { SCHEMA, type SessionDocument } from "@galaxyproject/orbit-browser/agent";
import { AGENT_TYPE, heldSession, reportSavedState, savedSessions, turnsOf } from "./saved-session";

const document = (): SessionDocument => ({
  olit_session: SCHEMA,
  session: {
    id: "0123abcd-0000-0000-0000-000000000000",
    title: "",
    createdAt: "2026-10-06T00:00:00Z",
    updatedAt: "2026-10-06T00:00:00Z",
    turn: 1,
    models: [],
    usage: { input: 0, output: 0, cost: null },
  },
  entries: [
    { kind: "pi.user", model: [{ role: "user", content: "a", timestamp: 0 }] },
    {
      kind: "pi.assistant",
      model: [{ role: "assistant", content: [{ type: "text", text: "b" }] }],
    } as unknown as SessionDocument["entries"][number],
  ],
});

/** A Galaxy that keeps the user's chats in memory. */
function fakeGalaxy() {
  const { rows, answer } = chatStore();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => (await answer(request))!),
  );
  return { rows, saved: savedSessions(connectGalaxy({ root: "http://galaxy/" })) };
}

describe("a saved Olit chat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is stored as Olit's, with the turns Galaxy lists and the whole session", async () => {
    const { rows, saved } = fakeGalaxy();
    const id = await saved.save(document());
    expect(rows.get(id)).toEqual({
      agent_type: AGENT_TYPE,
      messages: [{ query: "a", response: "b" }],
      document: document(),
    });
  });

  it("reads back what was saved, as Olit's", async () => {
    const { saved } = fakeGalaxy();
    const id = await saved.save(document());
    expect(await saved.load(id)).toEqual({ document: document(), olit: true });
  });

  it("replaces the chat it was opened from", async () => {
    const { rows, saved } = fakeGalaxy();
    const id = await saved.save(document());
    expect(await saved.save(document(), id)).toBe(id);
    expect(rows.size).toBe(1);
  });

  it("saves a chat GalaxyAI held, or one Galaxy no longer has, as a new chat", async () => {
    const { rows, saved } = fakeGalaxy();
    rows.set("g1", {
      agent_type: "router",
      messages: [{ query: "q", response: "r" }],
      document: null,
    });
    const added = await saved.save(document(), "g1");
    expect(added).not.toBe("g1");
    expect(rows.get("g1")!.document).toBeNull();
    expect(await saved.save(document(), "gone")).not.toBe("gone");
  });

  it("opens a chat GalaxyAI held from its questions and answers", async () => {
    const { rows, saved } = fakeGalaxy();
    rows.set("g1", {
      agent_type: "router",
      messages: [{ query: "q", response: "r" }],
      document: null,
    });
    const opened = (await saved.load("g1"))!;
    expect(opened.olit).toBe(false);
    expect(turnsOf(opened.document.entries)).toEqual([{ query: "q", response: "r" }]);
  });

  it("opens nothing from a chat whose document is not an Olit session", async () => {
    const { rows, saved } = fakeGalaxy();
    rows.set("x1", { agent_type: "other", messages: [], document: { settings: {} } });
    expect(await saved.load("x1")).toBeNull();
  });

  it("refuses to save before the first question", async () => {
    const { saved } = fakeGalaxy();
    await expect(saved.save({ ...document(), entries: [] })).rejects.toThrow(/nothing to save/);
  });

  it("surfaces a failed save instead of pretending it worked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(
      savedSessions(connectGalaxy({ root: "http://galaxy/" })).save(document()),
    ).rejects.toThrow(/500/);
  });
});

describe("turnsOf", () => {
  it("answers each question with the last text before the next one", () => {
    const entries = [
      { kind: "pi.user", model: [{ role: "user", content: "plot it" }] },
      {
        kind: "pi.assistant",
        model: [{ role: "assistant", content: [{ type: "text", text: "On it." }] }],
      },
      {
        kind: "pi.tool-result",
        model: [{ role: "toolResult", content: [{ type: "text", text: "ok" }] }],
      },
      {
        kind: "pi.assistant",
        model: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }],
      },
      { kind: "pi.user", model: [{ role: "user", content: "thanks" }] },
    ] as unknown as SessionDocument["entries"];
    expect(turnsOf(entries)).toEqual([
      { query: "plot it", response: "Done." },
      { query: "thanks", response: "" },
    ]);
  });
});

describe("heldSession", () => {
  it("is a session Olit opens, its answers from a model Olit is not", () => {
    const held = heldSession([
      { role: "user", content: "q", timestamp: "2026-10-01T10:00:00" },
      { role: "assistant", content: "r", agent_type: "router", timestamp: "2026-10-01T10:00:00" },
    ]);
    expect(held.olit_session).toBe(SCHEMA);
    expect(held.session.turn).toBe(1);
    expect(held.entries.map((e) => e.kind)).toEqual(["pi.user", "pi.assistant"]);
    expect(held.entries[1]!.model![0]).toMatchObject({ provider: "galaxy-ai", model: "router" });
  });
});

describe("reportSavedState", () => {
  /** Galaxy listens on the window that owns the iframe, so a report to our own window is lost. */
  function fakeParent() {
    const postMessage = vi.fn();
    Object.defineProperty(window, "parent", { value: { postMessage }, configurable: true });
    return postMessage;
  }

  it("tells the embedding window that a turn left the session unsaved", () => {
    const postMessage = fakeParent();
    reportSavedState(false);
    expect(postMessage).toHaveBeenCalledWith(
      { from: "galaxy-visualization", visualization_saved: false },
      "*",
    );
  });

  it("tells the embedding window that a save stored the session", () => {
    const postMessage = fakeParent();
    reportSavedState(true);
    expect(postMessage).toHaveBeenCalledWith(
      { from: "galaxy-visualization", visualization_saved: true },
      "*",
    );
  });
});
