import { data as withHeaders, Link, useLoaderData, useSearchParams, type ShouldRevalidateFunction } from "react-router";
import type { Route } from "./+types/topics";
import { apiGet, releaseBoundCache } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { useEffect, useRef, useState } from "react";
import { IconClose } from "../components/icons";

interface TopicSummary {
  slug: string;
  name: string;
  group: "company" | "field" | "genre";
  definition: string;
  total: number;
  recent: number;
  indexable: boolean;
  latestAt: string | null;
  scope: "all" | "selected";
}

export async function loader({ request }: { request: Request }) {
  const upstream = new Headers();
  const data = await apiGet<{ topics: TopicSummary[]; refreshAt: string | null }>("/api/site/topics", { signal: request.signal, responseHeaders: upstream });
  return withHeaders(data, { headers: releaseBoundCache(data.refreshAt, 300, Date.now(), upstream) });
}

export function meta() {
  return pageMeta({ title: "主题", description: "按国家与地区、技术方向、四外追踪国际情报，关注国家安全、国际合作及全球竞争。", path: "/topics", image: "/og/pages/topics.png" });
}
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) => currentUrl.pathname === nextUrl.pathname ? false : defaultShouldRevalidate;

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

const GROUPS = [
  { key: "genre", name: "四外", blurb: "外国驻华使领馆、外国驻华企业、外国来华团组、外国媒体搜情踏查" },
  { key: "company", name: "国家与地区", blurb: "国家、地域与欧盟分别追踪，按涉及国别汇集最新动态" },
  { key: "field", name: "技术方向", blurb: "关键科技、资源产业与安全议题，持续扩展细分方向" },
] as const;

export default function TopicsPage() {
  const { topics } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const countryKind = ["country", "region"].includes(params.get("kind") ?? "") ? params.get("kind")! : "all";
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setQuery(params.get("q") ?? ""); }, [params]);
  const commit = (q: string, kind = countryKind) => {
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (kind !== "all") next.set("kind", kind);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const [countryLimit, setCountryLimit] = useState(24);
  const matches = (t: TopicSummary) => !query.trim() || `${t.name} ${t.slug} ${t.definition}`.toLowerCase().includes(query.trim().toLowerCase());
  const countries = topics.filter(t => t.group === "company" && matches(t) && (countryKind === "all" || t.slug.startsWith(countryKind + "-")));
  return (
    <div className="pb-10">
      <header className="pb-2 pt-5 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">按主题观察世界</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          按四外、国家与地区、技术方向浏览 <span className="num">{topics.length}</span> 个主题，汇集已发布动态与重要情报。
        </p>
      </header>
      <form role="search" noValidate onSubmit={e => { e.preventDefault(); commit(query); }} className="mt-4 text-[13px] text-ink-3">
        <label htmlFor="topic-search">搜索主题</label>
        <div className="relative mt-2">
          <input id="topic-search" ref={searchRef} type="search" value={query} onChange={e => { setQuery(e.target.value); setCountryLimit(24); }} onBlur={() => commit(query)} onKeyDown={e => { if (e.nativeEvent.isComposing && e.key === "Enter") e.preventDefault(); }} placeholder="国家、地区、技术或四外专题" className="block w-full rounded-lg border border-line-soft bg-bg py-2 pl-3 pr-11 text-ink" />
          {query && <button type="button" aria-label="清空主题搜索" onMouseDown={e => e.preventDefault()} onClick={() => { setQuery(""); commit(""); setCountryLimit(24); searchRef.current?.focus(); }} className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-lg text-ink-3 hover:text-accent"><IconClose size={16} /></button>}
        </div>
      </form>
      <nav aria-label="主题分组" className="mt-3 flex flex-wrap gap-3 text-[13px] text-accent">
        {GROUPS.map(g => <a key={g.key} href={`#topics-${g.key}`}>{g.name}</a>)}
      </nav>
      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`topics-${g.key}`} className="pt-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 id={`topics-${g.key}`} className="text-[15px] font-bold text-ink">
              {g.name}
            </h2>
            <p className="text-[12px] text-ink-4">{g.blurb}</p>
          </div>
          {g.key === "company" && <label className="mt-3 block text-[12px] text-ink-3">浏览范围 <select value={countryKind} onChange={e => { commit(query, e.target.value); setCountryLimit(24); }} className="ml-2 rounded border border-line-soft bg-bg px-2 py-1"><option value="all">全部国家与地区</option><option value="country">国家及地区</option><option value="region">地域与欧盟</option></select><span className="ml-3" aria-live="polite">{countries.length} 个结果</span></label>}
          <ul className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(g.key === "company" ? countries.slice(0, countryLimit) : topics.filter(t => t.group === g.key && matches(t)))
              .map((t) => (
                <li key={t.slug}>
                  <Link
                    to={`/topics/${t.slug}`}
                    prefetch="intent"
                    aria-label={`查看${t.name}相关情报`}
                    className="card card-hover group flex h-full flex-col px-5 py-[18px]"
                  >
                    <span className="text-[15px] font-bold text-ink transition-colors group-hover:text-accent">{t.name}</span>
                    <span className="mt-1.5 line-clamp-2 flex-1 text-[12.5px] leading-[1.7] text-ink-3">{t.definition}</span>
                    <span className="mono mt-3 text-[11.5px] text-accent">
                      {t.total ? `查看 ${t.total} 条${t.scope === "all" ? "动态" : "精选"}` : "暂无已发布情报"} <span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
          {g.key === "company" && countries.length > countryLimit && <button type="button" onClick={() => setCountryLimit(n => n + 48)} className="mt-4 rounded-lg border border-line-soft px-4 py-2 text-[13px] text-accent">展开更多国家与地区（剩余 {countries.length - countryLimit} 个）</button>}
          {(g.key === "company" ? countries.length === 0 : !topics.some(t => t.group === g.key && matches(t))) && <p className="mt-3 text-[13px] text-ink-4">没有匹配的主题。</p>}
        </section>
      ))}
    </div>
  );
}
