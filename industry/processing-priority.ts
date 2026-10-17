// Hints for which unassessed reports to read first. These never decide relevance or publication.
export function processingHint(text: string): number {
  const urgent = /\b(?:missiles?|airstrikes?|invasion|ceasefire|sanctions?|coup|blockade|mobilization|nuclear weapons?|cyberattacks?|ransomware|embassy attack|evacuation|export ban|export controls?|supply disruption)\b|导弹|空袭|入侵|停火|制裁|政变|封锁|军事动员|核武|网络攻击|勒索软件|使馆遇袭|撤侨|出口禁令|出口管制|供应中断/i;
  const strategic = /\b(?:geopolitic\w*|diploma\w*|military|defen[sc]e|embass\w*|rare earths?|critical minerals?|oil|petroleum|natural gas|semiconductors?|artificial intelligence|nuclear|supply chain|central bank|sovereign debt|financial crisis|protests?|riots?)\b|地缘政治|外交|军事|国防|使领馆|稀土|关键矿产|石油|天然气|半导体|人工智能|核能|供应链|央行|主权债务|金融危机|抗议|骚乱/i;
  return (urgent.test(text) ? 180 : 0) + (strategic.test(text) ? 60 : 0);
}
