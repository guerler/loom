/**
 * The artifact pane on a page of its own: what a host shows apart from the chat, filled by the
 * chat's page with what its pane would show (`ArtifactPlace`).
 */
import "./shell.css";
import { DEFAULT_BRAND, type Brand } from "./agent/brand";
import { briefly, connectGalaxy } from "./agent/galaxy";
import {
  kindsWithoutRenderer,
  registerArtifactRenderers,
  renderArtifact,
  type Artifact,
  type ArtifactRenderers,
} from "./artifacts";
import { registerArtifactKinds, type ArtifactKind } from "./artifacts/kinds";

export interface ArtifactViewOptions {
  galaxyRoot: string;
  artifactKinds?: readonly ArtifactKind<any>[];
  renderers?: ArtifactRenderers;
  brand?: Brand;
}

export interface ArtifactView {
  /** Show these in place of what it showed. */
  show(artifacts: Artifact[]): Promise<void>;
}

/** Mount the pane alone into `container`, which it fills. */
export function mountArtifactView(
  container: HTMLElement,
  options: ArtifactViewOptions,
): ArtifactView {
  registerArtifactKinds(options.artifactKinds ?? []);
  registerArtifactRenderers(options.renderers ?? {});
  const undrawable = kindsWithoutRenderer();
  if (undrawable.length) {
    throw new Error(`No renderer is registered for artifact kinds: ${undrawable.join(", ")}.`);
  }
  const brand = options.brand ?? DEFAULT_BRAND;
  const credentials = (process.env.credentials as RequestCredentials) || "include";
  const galaxy = connectGalaxy({ root: options.galaxyRoot, credentials });
  const rootPath = new URL(galaxy.root, document.baseURI).pathname;
  container.classList.add("artifact-view");
  const content = document.createElement("div");
  content.className = "artifact-view-content";
  const empty = document.createElement("p");
  empty.className = "artifact-view-empty";
  empty.textContent = `Charts and diagrams ${brand.name} makes show here.`;
  container.replaceChildren(empty, content);

  // Charts sized to their container measure it again only on a window resize.
  new ResizeObserver(() => window.dispatchEvent(new Event("resize"))).observe(content);

  /** The latest call wins: an earlier one still drawing stops adding to the pane. */
  let drawing = 0;
  return {
    async show(artifacts) {
      const turn = ++drawing;
      content.replaceChildren();
      empty.hidden = artifacts.length > 0;
      for (const artifact of artifacts) {
        if (turn === drawing) {
          await renderArtifact(content, artifact, rootPath, galaxy).catch((e) => {
            console.error(`[${brand.id}] could not draw an artifact`, e);
            const line = document.createElement("p");
            line.className = "artifact-view-error";
            line.textContent = `Could not show the artifact: ${briefly(String((e as Error)?.message ?? e))}`;
            content.appendChild(line);
          });
        }
      }
    },
  };
}
