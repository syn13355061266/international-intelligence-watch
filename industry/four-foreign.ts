/** Publicly reported activities in China; never infer a visit from a publisher's nationality. */
export const FOUR_FOREIGN_TAGS = ["外国驻华使领馆", "外国驻华企业", "外国来华团组", "外国媒体搜情踏查"] as const;

export function fourForeignTags(text: string): string[] {
  const value = text.replace(/\s+/g, " ");
  const tags: string[] = [];
  if (/(?:驻华|驻中国|驻北京|驻上海|驻广州|驻成都|驻武汉|驻沈阳|驻重庆).{0,20}(?:使馆|领馆|大使|领事)|(?:embassy|consulate|ambassador).{0,65}(?:in|to) (?:China|Beijing|Shanghai|Guangzhou|Chengdu)\b/i.test(value)) tags.push(FOUR_FOREIGN_TAGS[0]);
  if (/(?:在华|驻华|在中国).{0,30}(?:外资企业|外国企业|外企|跨国企业|跨国公司)|(?:外资企业|外国企业|外企|跨国企业|跨国公司).{0,30}(?:在华|驻华|在中国)|(?:foreign(?:-invested)? (?:companies|enterprises|businesses)|multinational (?:companies|corporations)).{0,55}(?:in China|China operations)|(?:在华|驻华)商会|(?:foreign|European|American|British|German) chamber of commerce in China/i.test(value)) tags.push(FOUR_FOREIGN_TAGS[1]);
  if (/(?:外国|外方|外宾|海外|国际).{0,20}(?:代表团|访问团|考察团|团组).{0,40}(?:来华|访华|赴华|访问中国)|(?:来华|访华|赴华).{0,25}(?:代表团|访问团|考察团|团组)|(?:foreign|overseas|international|European|American|British|German|French).{0,25}delegation.{0,65}(?:visit.{0,12}China|to China|in China)|delegation.{0,25}(?:visits? China|visit to China)/i.test(value)) tags.push(FOUR_FOREIGN_TAGS[2]);
  if (/(?:外国|外媒|境外).{0,12}(?:媒体|记者).{0,45}(?:来华|在华|访华|在中国).{0,40}(?:采访|调研|踏查|走访|采风|考察)|(?:外国|外媒|境外).{0,12}(?:媒体|记者).{0,30}(?:采访团|采风团|调研团).{0,20}(?:来华|访华|中国)|(?:foreign|international|overseas) (?:media|journalists|reporters).{0,55}(?:visit|tour|fieldwork|interview).{0,30}(?:China|Beijing|Shanghai)/i.test(value)) tags.push(FOUR_FOREIGN_TAGS[3]);
  return tags;
}
