/** Export a small public snapshot for GitHub Pages. It contains no credentials or admin data. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { sql } from "../packages/backend/src/db.ts";

const output = new URL("../pages/data.json", import.meta.url);
const sourceUrl = process.argv.find((x) => x.startsWith("--url="))?.slice(6) || process.env.PAGES_SOURCE_URL;
type Item = { id: string; title: string; summary: string | null; source: string; url: string; category: string | null; score: number | null; publishedAt: string | null; discoveredAt: string };

async function fromUrl(url: string): Promise<Item[]> {
  const response = await fetch(`${url.replace(/\/$/, "")}/api/v1/items?limit=30`);
  if (!response.ok) throw new Error(`public source returned HTTP ${response.status}`);
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> };
  return (body.items ?? []).map((item) => ({
    id: String(item.id), title: String(item.title), summary: item.summary ? String(item.summary) : null,
    source: String(item.source_name ?? item.sourceName ?? "公开信源"), url: String(item.url),
    category: item.category ? String(item.category) : null, score: typeof item.score === "number" ? item.score : null,
    publishedAt: item.published_at ? String(item.published_at) : null, discoveredAt: String(item.discovered_at ?? new Date().toISOString()),
  }));
}

async function fromDatabase(): Promise<Item[]> {
  const rows = await sql<Item[]>`
    SELECT p.article_id AS id, p.title, p.summary, s.name AS source, p.url, p.category, p.score,
           p.published_at AS "publishedAt", p.discovered_at AS "discoveredAt"
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE p.visibility = 'public' AND (p.selected OR p.eligible)
    ORDER BY p.sort_at DESC LIMIT 30`;
  return rows;
}

await mkdir(new URL("../pages/", import.meta.url), { recursive: true });
let items: Item[] = [];
try {
  if (sourceUrl) items = await fromUrl(sourceUrl);
  else if (process.env.DATABASE_URL) items = await fromDatabase();
} catch (error) {
  // A Pages build must keep the last good snapshot when the dynamic server is offline.
  try { items = JSON.parse(await readFile(output, "utf8")) as Item[]; } catch { /* first publish */ }
  console.warn(`Pages snapshot kept previous data: ${error instanceof Error ? error.message : String(error)}`);
}
await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2)}\n`);
if (!sourceUrl) await sql.end({ timeout: 2 }).catch(() => {});
