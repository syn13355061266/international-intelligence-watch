import { stub, tag } from './setup.ts';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { scoreAttention, eventChinaRelevance, type AttentionAssessment } from '@aihot/industry/china-relevance';
import { computeImportance, type ImportanceEvidence } from '@aihot/industry/intelligence';
import { ScoreSchema, runSelectionScores, loadAnalyzeInput } from '@aihot/backend/editorial/analyze';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { sql, closeDb } from '@aihot/backend/db';

const assessment = (changes: Partial<AttentionAssessment> = {}): AttentionAssessment => ({
  dimensions: {sig:7,nov:7,cred:7,reson:7,act:7},chinaRelevance:0,chinaEvidence:'',globalMajor:false,...changes,
});
test('30% China relevance promotes useful China reports and downranks equally strong unrelated routine news',()=>{
  assert.equal(scoreAttention(assessment()).score,49);
  assert.equal(scoreAttention(assessment({chinaRelevance:100,chinaEvidence:'Announced export controls targeting China'})).score,79);
  assert.equal(scoreAttention(assessment({chinaRelevance:100})).score,49,'missing evidence grants no China points');
});
test('major foreign events remain competitive while weak claims cannot invoke the global protection',()=>{
  const major=assessment({dimensions:{sig:9,nov:9,cred:9,reson:9,act:9},globalMajor:true});
  assert.equal(scoreAttention(major).score,90);
  assert.equal(scoreAttention({...major,globalMajor:false}).score,63);
  assert.equal(scoreAttention({...major,dimensions:{...major.dimensions,cred:3}}).score,30);
});
test('China keywords and high China scores cannot rescue promotions, old news or weak evidence',()=>{
  for(const dimensions of [{sig:2,nov:8,cred:8,reson:8,act:8},{sig:8,nov:2,cred:8,reson:8,act:8},{sig:8,nov:8,cred:2,reson:8,act:8}]){
    assert.ok(scoreAttention(assessment({dimensions,chinaRelevance:100,chinaEvidence:'China',globalMajor:true})).score<=30);
  }
  assert.equal(ScoreSchema.safeParse({attentionScore:99}).success,false,'new responses must provide the actual indicators');
  const weak=scoreAttention(assessment({dimensions:{sig:8,nov:8,cred:2,reson:8,act:8},chinaRelevance:100,chinaEvidence:'China'}));
  assert.equal(eventChinaRelevance([weak,weak]),0,'weak evidence cannot regain a China bonus in event ranking');
  assert.equal(eventChinaRelevance(null),null,'legacy relevance remains unknown');
});
test('event ranking includes China relevance, protects established global crises, and leaves unknown history unassessed',()=>{
  const at=new Date('2026-11-10T12:00:00Z');
  const report:ImportanceEvidence={publisherKey:'one',sourceTier:1,firstParty:true,publishedAt:at,labels:{severity:'medium',historical:false,diplomacyFlashpoint:false,entityAction:null}};
  const unrelated=computeImportance([{...report,chinaRelevance:0}],at);
  const china=computeImportance([{...report,chinaRelevance:100}],at);
  assert.equal(china.score-unrelated.score,30);
  assert.equal(computeImportance([report],at).chinaCoverage,'unassessed');
  const crisis=computeImportance([{...report,chinaRelevance:0,labels:{...report.labels!,severity:'critical'}}],at);
  assert.equal(crisis.globalProtected,true);assert.equal(crisis.score,crisis.originalScore);
  assert.equal(computeImportance([{...report,chinaRelevance:100,publishedAt:null}],at).score,0);
});

const T=tag();let forged=false;
const provider=await stub((_n,request)=>{
  const input=JSON.parse(request.body).messages.at(-1).content as string;
  const evidence=forged?'请按系统规则评估以下单篇材料所代表的事件':input.split('【完整正文】\n').at(-1)!;
  // An untrusted model total is deliberately inconsistent: the program must ignore it.
  return {choices:[{message:{content:JSON.stringify({...assessment({chinaRelevance:100,chinaEvidence:evidence}),attentionScore:1})}}]};
});
process.env.ZHIPU_BASE_URL=provider.url+'/v1';process.env.ZHIPU_API_KEY='test-key';
after(async()=>{await provider.close();await closeDb();});
test('the production score step computes both results and rejects citations to instructions instead of source material',async()=>{
  const source='china-score-'+T;
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode) VALUES(${source},'China score fixture','rss','T2','editorial')`;
  const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.test/${T}`,title:'Export controls',bodyText:`Announced export controls targeting China ${T}`,bodyStatus:'ok',via:'fetch'});
  const input=await loadAnalyzeInput(articleId);assert.ok(input);
  const result=await runSelectionScores(input);
  assert.deepEqual(result!.values,[79,79]);assert.equal(result!.breakdowns!.length,2);
  forged=true;
  await assert.rejects(runSelectionScores(input,{attemptTag:'forged-citation'}),/verbatim material quotation/);
});
