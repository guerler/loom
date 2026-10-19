import { describe, expect, it, vi } from "vitest";

import { chatSide, paneSide, sibling } from "./pane-link";

const ORIGIN = "https://galaxy.example";

/** A frame of the Galaxy page: events it is posted are delivered to it, from Galaxy's origin. */
function frame(parent: { frames: unknown[] }) {
  const target = new EventTarget() as EventTarget & Record<string, any>;
  Object.assign(target, {
    origin: ORIGIN,
    parent,
    postMessage: vi.fn((data: unknown, origin: string) =>
      target.dispatchEvent(new MessageEvent("message", { data, origin })),
    ),
  });
  parent.frames.push(target);
  return target as unknown as Window;
}

function page() {
  const parent = { frames: [] as unknown[] };
  return { parent, frame: () => frame(parent) };
}

const view = () => ({ show: vi.fn(async () => {}) });

describe("Olit's chat and its pane apart", () => {
  it("find each other among the page's frames, and not in a frame of another origin", () => {
    const { parent, frame } = page();
    const chat = frame();
    parent.frames.push({
      get __olitView() {
        throw new DOMException("Blocked a frame with origin", "SecurityError");
      },
    });
    chatSide(() => {}, chat);
    expect(sibling("pane", chat)).toBeUndefined();
    const pane = frame();
    paneSide(view(), pane);
    expect(sibling("pane", chat)).toBe(pane);
    expect(sibling("chat", pane)).toBe(chat);
  });

  it("show the chat's artifacts in the pane, and ask Galaxy to reveal it only for something new", () => {
    const { frame } = page();
    const chat = frame();
    const reveal = vi.fn();
    const place = chatSide(reveal, chat);
    const pane = frame();
    const shown = view();
    paneSide(shown, pane);
    expect(place.present()).toBe(true);
    const chart = { kind: "vega-lite", title: "c", spec: {} } as any;
    place.show([chart], false);
    expect(shown.show).toHaveBeenLastCalledWith([chart]);
    expect(reveal).not.toHaveBeenCalled();
    place.show([chart], true);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("tell the chat when the pane comes and goes, and the pane is gone once it said so", () => {
    const { frame } = page();
    const chat = frame();
    const place = chatSide(() => {}, chat);
    const changed = vi.fn();
    const watching = new AbortController();
    place.watch(changed, watching.signal);
    const pane = frame();
    paneSide(view(), pane);
    expect(changed).toHaveBeenCalledTimes(1);
    pane.dispatchEvent(new Event("pagehide"));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(place.present()).toBe(false);
    watching.abort();
    paneSide(view(), frame());
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("ignore notes from another origin", () => {
    const { frame } = page();
    const chat = frame();
    const changed = vi.fn();
    chatSide(() => {}, chat).watch(changed, new AbortController().signal);
    chat.dispatchEvent(
      new MessageEvent("message", { data: { olit: "pane-here" }, origin: "https://elsewhere" }),
    );
    expect(changed).not.toHaveBeenCalled();
  });
});
