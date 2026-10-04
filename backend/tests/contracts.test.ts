import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessmentSchema } from '../app/schemas/attempt.js';
import { preferencesSchema } from '../app/schemas/user.js';
import { profileRequestSchema,profileSchema,recommendRequestSchema,recommendationSchema } from '../app/schemas/personalization.js';
import { PersonalizationService } from '../app/services/personalization_service.js';

const fixture=async (name:string) => JSON.parse(await readFile(`contracts/${name}.json`,'utf8'));

test('shared request/response fixtures satisfy TypeScript contracts',async () => {
  profileRequestSchema.parse(await fixture('profile.request'));
  profileSchema.parse(await fixture('profile.response'));
  recommendRequestSchema.parse(await fixture('recommend.request'));
  recommendationSchema.parse(await fixture('recommend.response'));
  assessmentSchema.parse(await fixture('assessment'));
});

test('profile input rejects empty names/channels, duplicates, and impersonation',() => {
  for (const input of [
    {name:' ',enabledChannels:['text']},
    {name:'Kelvin',enabledChannels:[]},
    {name:'Kelvin',enabledChannels:['text','text']},
    {name:'Kelvin',enabledChannels:['fax']},
    {name:'Kelvin',enabledChannels:['text'],userId:'some-other-user'},
    {name:'Kelvin',enabledChannels:['text'],authIdentity:'other'},
  ]) assert.equal(preferencesSchema.safeParse(input).success,false);
});

test('malformed AI assessments are rejected',async () => {
  const assessment=await fixture('assessment');
  for (const data of [
    {...assessment,score:101},
    {...assessment,score:NaN},
    {...assessment,classification:'maybe'},
    {...assessment,findings:[...assessment.findings,...assessment.findings]},
    {...assessment,feedback:''},
    {...assessment,score:100,userId:'spoofed'},
  ]) assert.equal(assessmentSchema.safeParse(data).success,false);
});

test('failed/invalid personalization responses return retryable 503 errors',async () => {
  const fail:typeof fetch=async () => {throw new Error('offline');};
  const invalid:typeof fetch=async () => new Response(JSON.stringify({score:100}));
  const unauthorized:typeof fetch=async () => new Response('',{status:401});
  for (const fetcher of [fail,invalid,unauthorized]) {
    const service=new PersonalizationService('http://internal','secret',fetcher);
    await assert.rejects(service.profile([]),(error:unknown) => {
      assert.equal((error as {status:number}).status,503);
      return true;
    });
  }
});

test('bridge supplies credentials and aborts on timeout',async () => {
  let hasCredential=false;
  const delayed:typeof fetch=async (_url,init) => {
    hasCredential=new Headers(init?.headers).get('X-Service-Key')==='secret';
    return new Promise<Response>((_resolve,reject) => {
      const timer=setTimeout(() => reject(new Error('test timed out')),100);
      init?.signal?.addEventListener('abort',() => {clearTimeout(timer);reject(init.signal?.reason);},{once:true});
    });
  };
  const service=new PersonalizationService('http://internal','secret',delayed,10);
  await assert.rejects(service.profile([]),{status:503});
  assert.ok(hasCredential);
});

test('bridge rejects recommendations for disabled channels',async () => {
  const response=await fixture('recommend.response');
  const req=recommendRequestSchema.parse(await fixture('recommend.request'));
  req.enabledChannels=['text'];
  const fetcher:typeof fetch=async () => new Response(JSON.stringify({...response,channel:'call'}));
  await assert.rejects(new PersonalizationService('http://internal','secret',fetcher).recommend(req),{status:503});
});
