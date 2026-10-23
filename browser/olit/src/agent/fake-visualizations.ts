/** For tests: Galaxy's saved visualizations, as a test scripts them. */
import { json } from "@galaxyproject/orbit-browser/testing";

/** A saved visualization as Galaxy keeps it: its config, and the user who owns it. */
export interface VisualizationRow {
  title?: string;
  type?: string;
  config?: unknown;
  owner?: string;
}

/**
 * Galaxy's visualizations, kept in memory, each owned by the signed-in user `me` who saved it.
 * `answer` serves a request under `api/visualizations` or `api/users/current`, else undefined.
 */
export function visualizationStore(me: string | null) {
  const rows = new Map<string, VisualizationRow>();
  let next = 1;
  async function answer(request: Request): Promise<Response | undefined> {
    if (request.url.endsWith("/api/users/current")) {
      return json(me ? { id: me } : { username: "Anonymous" });
    }
    if (!request.url.includes("/api/visualizations")) return undefined;
    const id = request.url.split("/api/visualizations/")[1];
    if (request.method === "GET") {
      const row = rows.get(id!);
      return row
        ? json({ user_id: row.owner, latest_revision: { config: row.config } })
        : json("not found", 404);
    }
    const body = JSON.parse(await request.text());
    if (request.method === "POST") {
      const created = `v${next++}`;
      rows.set(created, { ...body, owner: me ?? undefined });
      return json({ id: created });
    }
    rows.set(id!, { ...rows.get(id!), ...body });
    return json({});
  }
  return { rows, answer };
}
