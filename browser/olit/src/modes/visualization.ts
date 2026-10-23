/**
 * Olit as a visualization of its own: opened from Galaxy's visualizations or on a dataset, saved as
 * a visualization, and telling Galaxy whether it is saved as any visualization does.
 */
import { mountOrbitBrowser } from "@galaxyproject/orbit-browser";
import { shellOptions } from "../launch";
import { visualizations } from "../stores/visualizations";
import type { OlitMode } from "./mode";

/** Tells the Galaxy host whether this session is stored on the server. */
export function reportSavedState(saved: boolean) {
  window.parent?.postMessage({ from: "galaxy-visualization", visualization_saved: saved }, "*");
}

export const visualizationMode: OlitMode = {
  async mount(container, incoming) {
    await mountOrbitBrowser(
      container,
      shellOptions(
        incoming,
        visualizations,
        { savedId: incoming.visualizationId, datasetId: incoming.datasetId },
        { savedState: reportSavedState },
      ),
    );
  },
};
