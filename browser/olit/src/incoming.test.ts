import { describe, expect, it } from "vitest";
import { CHAT_VIEW, PANE_VIEW, parseIncoming, VISUALIZATION_VIEW } from "./incoming";

const container = (incoming: object) => {
  const element = document.createElement("div");
  element.dataset.incoming = JSON.stringify(incoming);
  return element;
};

describe("the view Galaxy mounts Olit with", () => {
  it("is a visualization of its own when Galaxy names none", () => {
    expect(parseIncoming(container({ visualization_config: { dataset_id: "d1" } })).view).toBe(
      VISUALIZATION_VIEW,
    );
  });

  it("is GalaxyAI's chat or its pane when Galaxy says so", () => {
    expect(parseIncoming(container({ visualization_config: { view: CHAT_VIEW } })).view).toBe(
      CHAT_VIEW,
    );
    expect(parseIncoming(container({ visualization_config: { view: PANE_VIEW } })).view).toBe(
      PANE_VIEW,
    );
  });

  it("is a visualization of its own for a view this version does not know", () => {
    expect(parseIncoming(container({ visualization_config: { view: "dock" } })).view).toBe(
      VISUALIZATION_VIEW,
    );
  });

  it("reads a saved visualization's id from the config or the host page's query", () => {
    expect(parseIncoming(container({ visualization_id: "v1" })).visualizationId).toBe("v1");
    expect(parseIncoming(container({}), "?visualization_id=v2").visualizationId).toBe("v2");
  });
});
