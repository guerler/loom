/** Olit's artifact pane, which GalaxyAI mounts apart from its chat (`chat.pane`). */
import { mountArtifactView } from "@galaxyproject/orbit-browser";
import { OLIT_ARTIFACTS } from "../artifacts/renderers";
import { OLIT_BRAND } from "../brand";
import { paneSide } from "../pane-link";
import type { OlitMode } from "./mode";

export const paneMode: OlitMode = {
  async mount(container, incoming) {
    // The chat's frame fills it.
    paneSide(
      mountArtifactView(container, {
        galaxyRoot: incoming.root,
        ...OLIT_ARTIFACTS,
        brand: OLIT_BRAND,
      }),
    );
  },
};
