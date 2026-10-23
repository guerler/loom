/**
 * Olit as GalaxyAI's chat: Galaxy commands it over the brain protocol (brain/), it saves as GalaxyAI's
 * chats, and its artifacts show in a pane apart while GalaxyAI has one mounted.
 */
import { mountOrbitBrowser, type OrbitBrowserHandle } from "@galaxyproject/orbit-browser";
import packageJson from "../../package.json";
import { connectHost, type HostConnection } from "../brain/connect";
import { PLUGIN_NAME, shellOptions, type LaunchRequest } from "../launch";
import { chatSide } from "../pane-link";
import { chats } from "../stores/chats";
import type { OlitMode } from "./mode";

export const chatMode: OlitMode = {
  async mount(container, incoming) {
    let connection: HostConnection | null = null;
    const artifactPlace = chatSide(() => connection?.showPane());
    let mounted: OrbitBrowserHandle | undefined;
    let mounting: Promise<void> = Promise.resolve();
    /** What GalaxyAI was last told of unsaved changes; it hears only of a change. */
    let unsaved: boolean | undefined;
    function reportUnsaved(value: boolean) {
      if (value !== unsaved) {
        unsaved = value;
        connection?.unsavedChanged(value);
      }
    }

    /** Mount the shell anew for what GalaxyAI asked, once the mount before it is disposed. */
    function show(request: LaunchRequest) {
      mounting = mounting.then(async () => {
        mounted?.dispose();
        // The conversation about to be shown has nothing unsaved yet.
        reportUnsaved(false);
        mounted = await mountOrbitBrowser(container, {
          ...shellOptions(
            incoming,
            chats,
            { ...request, datasetId: incoming.datasetId },
            {
              savedState: (saved) => reportUnsaved(!saved),
              active: (id) => connection?.activeChanged(id),
            },
          ),
          artifactPlace,
        });
      });
    }

    // Olit shows what GalaxyAI tells it to; a host that does not answer is a failure to say, not
    // a reason to run another way.
    connection = await connectHost({
      clientInfo: { name: PLUGIN_NAME, version: packageJson.version },
      capabilities: { chat: { unsaved: {}, pane: {} } },
      handlers: {
        open: ({ exchange_id }) => show({ savedId: exchange_id }),
        ask: ({ question }) => show({ question }),
      },
    }).catch((e) => {
      const line = document.createElement("p");
      line.setAttribute("role", "alert");
      line.textContent =
        `Olit could not connect to GalaxyAI (${String((e as Error)?.message ?? e)}). ` +
        "Reload the page to try again.";
      container.replaceChildren(line);
      return null;
    });
    // Said once right after the handshake: nothing is shown yet, so nothing is unsaved.
    reportUnsaved(false);
  },
};
