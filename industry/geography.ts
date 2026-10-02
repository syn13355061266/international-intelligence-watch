import { readFileSync } from "node:fs";

/** UN M49 country/area coverage and regional grouping; EU membership dated in the dataset. */
const data = JSON.parse(readFileSync(new URL("./geography-data.json", import.meta.url), "utf8")) as {
  countries: Array<{ code: string; name: string; englishName: string; regions: string[] }>;
  regions: Array<{ code: string; name: string; members?: string[] }>;
};
export const COUNTRIES = data.countries;
export const REGIONS = data.regions;
const countriesByCode = new Map(COUNTRIES.map((c) => [c.code, c]));
const regionsByCode = new Map(REGIONS.map((r) => [r.code, r]));

/** Only explicit subject countries, never the publisher's nationality or guessed locations. */
export function geographyTags(countries: readonly string[] = [], regions: readonly string[] = []): string[] {
  const tags = new Set<string>();
  for (const input of countries.slice(0, 20)) {
    const country = countriesByCode.get(input.trim().toUpperCase());
    if (!country) continue;
    tags.add(`country:${country.code}`);
    for (const region of country.regions) tags.add(`region:${region}`);
    for (const region of REGIONS) if (region.members?.includes(country.code)) tags.add(`region:${region.code}`);
  }
  for (const input of regions.slice(0, 20)) {
    const code = input.trim().toUpperCase();
    if (regionsByCode.has(code)) {
      tags.add(`region:${code}`);
      const chain = COUNTRIES.find(c => c.regions.includes(code))?.regions ?? [];
      for (const parent of chain.slice(0, chain.indexOf(code))) tags.add(`region:${parent}`);
    }
  }
  return [...tags];
}

export const REGION_GUIDE = REGIONS.map((r) => `${r.code}=${r.name}`).join("、");
