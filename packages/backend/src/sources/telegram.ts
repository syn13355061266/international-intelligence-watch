import * as cheerio from "cheerio";
import { guardedFetch } from "../lib/http-fetch.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";

/** Only public channel previews; private channels and accounts are never accessed. */
export function parseTelegram(html: string, channelUrl: string): Candidate[] {
  const expected = /^https:\/\/t\.me\/s\/([a-zA-Z0-9_]+)\/?$/.exec(channelUrl)?.[1];
  if (!expected) throw new FetchError("Telegram URL must name a public channel preview");
  const $=cheerio.load(html); const candidates: Candidate[]=[];
  for (const node of $(".tgme_widget_message").toArray()) {
    const el=$(node); const post=el.attr("data-post") ?? "";
    const match=/^([a-zA-Z0-9_]+)\/(\d+)$/.exec(post);
    if (!match || match[1]!.toLowerCase() !== expected.toLowerCase()) continue;
    const text=el.find(".tgme_widget_message_text").text().replace(/\s+/g," ").trim();
    const time=el.find("time").attr("datetime"); const date=time ? new Date(time) : null;
    if (!text || !date || !Number.isFinite(date.getTime())) continue;
    candidates.push({url:`https://t.me/${post}`,title:text.slice(0,180),excerpt:text.slice(0,2000),bodyText:text,bodyStatus:"ok",publishedAt:date,author:expected,raw:{telegramChannel:expected,messageId:match[2]}});
  }
  return candidates;
}
export async function fetchTelegram(source: SourceRow): Promise<Candidate[]> {
  const url=String(source.config.url ?? "");
  if (!/^https:\/\/t\.me\/s\/[a-zA-Z0-9_]+\/?$/.test(url)) throw new FetchError("Invalid public Telegram channel URL");
  const res=await guardedFetch(url,{timeoutMs:25000});
  if(res.status!==200) throw new FetchError(`Telegram HTTP ${res.status}`,res.status);
  const candidates=parseTelegram(res.text(),url);
  if(!candidates.length && !res.text().includes("tgme_widget_message")) throw new FetchError("Telegram public preview unavailable; channel may be private or blocked");
  return candidates;
}
