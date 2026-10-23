import { describe, expect, it, vi } from "vitest";
import { reportSavedState } from "./visualization";

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
