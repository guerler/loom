/**
 * Olit runs two ways (modes/) over one agent. What differs between them stays in the mode and its
 * store, so the agent, its tools and artifacts, the shared launch and the brain protocol never
 * learn which way they run, and a mode never reaches into the other's store.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { specifiers } from "@galaxyproject/orbit-browser/testing";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    let found: string[] = [];
    if (statSync(path).isDirectory()) found = sources(path);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) found = [path];
    return found;
  });
}

/** Each source under src/, by its path there, with the src/ modules it imports, by theirs. */
const graph = new Map(
  sources(SRC).map((file) => [
    relative(SRC, file),
    specifiers(readFileSync(file, "utf8"))
      .filter((spec) => spec.startsWith("."))
      .map((spec) => relative(SRC, resolve(dirname(file), spec)).replace(/\.ts$/, "")),
  ]),
);

/** The src/ modules under `prefix` that import one matching `target`. */
function importing(prefix: string, target: RegExp): string[] {
  return [...graph]
    .filter(([file, imports]) => file.startsWith(prefix) && imports.some((i) => target.test(i)))
    .map(([file]) => file);
}

const MODE_SPECIFIC = /^(modes\/|stores\/|launch$|incoming$|main$|brain\/|pane-link$)/;

describe("olit's two modes", () => {
  it("are found as sources, so the checks below see something", () => {
    expect([...graph.keys()]).toEqual(
      expect.arrayContaining(["main.ts", "launch.ts", "modes/chat.ts", "stores/chats.ts"]),
    );
  });

  it("stay out of the agent, its tools and its artifacts", () => {
    expect(importing("agent/", MODE_SPECIFIC)).toEqual([]);
    expect(importing("artifacts/", MODE_SPECIFIC)).toEqual([]);
    expect(importing("worker", MODE_SPECIFIC)).toEqual([]);
  });

  it("are picked only by main.ts", () => {
    expect(
      [...graph]
        .filter(
          ([file, imports]) =>
            !file.startsWith("modes/") && imports.some((i) => i.startsWith("modes/")),
        )
        .map(([file]) => file),
    ).toEqual(["main.ts"]);
  });

  it("each save only to their own store", () => {
    expect(importing("modes/visualization", /^stores\/(?!visualizations$|store$)/)).toEqual([]);
    expect(importing("modes/chat", /^stores\/(?!chats$|store$)/)).toEqual([]);
  });

  it("share a launch that knows stores only by their interface", () => {
    expect(importing("launch", /^(stores\/(?!store$)|modes\/|brain\/)/)).toEqual([]);
  });

  it("keep their stores apart from the modes and from each other", () => {
    expect(importing("stores/", /^(modes\/|launch$|brain\/|stores\/(?!store$))/)).toEqual([]);
  });

  it("keep the brain protocol to the chat mode, knowing nothing of Olit", () => {
    expect(importing("", /^brain\//).filter((file) => !file.startsWith("brain/"))).toEqual([
      "modes/chat.ts",
    ]);
    expect(importing("brain/", /^(?!brain\/)/)).toEqual([]);
  });
});
