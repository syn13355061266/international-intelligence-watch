import type { Route } from "./+types/item-original";
import type { SiteItemDetail } from "@aihot/contracts/site";
import { loadOr404 } from "../lib/api.server";
import { data as withHeaders } from "react-router";

export { default, headers, meta } from "./item";

export async function loader({ params, request }: Route.LoaderArgs) {
  const item = await loadOr404<SiteItemDetail>(`/api/site/items/${encodeURIComponent(params.id)}/original`, { signal: request.signal });
  return withHeaders({ item }, { headers: item.localPreview ? { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } : {} });
}
