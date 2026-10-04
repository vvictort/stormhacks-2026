import { after,before,beforeEach,describe,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import supertest from 'supertest';
import { createDatabase,type Database } from '../app/db/database.js';
import { migrate } from '../app/db/migrate.js';
import { seedPatterns } from '../app/db/seed.js';
import { Repositories } from '../app/db/repositories.js';
import { PersonalizationService } from '../app/services/personalization_service.js';
import { AnalyticsService } from '../app/services/analytics_service.js';
import { SimulationService } from '../app/services/simulation_service.js';
import { CampaignWorker } from '../app/workers/campaign_worker.js';
import { createApp } from '../app/server.js';
import { preferencesSchema } from '../app/schemas/user.js';
import type { User } from '../app/schemas/user.js';
import type { Assessment } from '../app/schemas/attempt.js';
import type { Pattern,Recommendation } from '../app/schemas/personalization.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
const pythonUrl=process.env.TEST_PERSONALIZATION_URL;
const key=process.env.PERSONALIZATION_SERVICE_KEY??'test-personalization-secret';
const scenario={title:'Incoming message',sender:'Demo sender',openingText:'A fixture message appears on your device.'};
// Test-only auth middleware; production must verify actual account credentials.
const authenticate:RequestHandler=(req,res,next) => {
  const subject=req.get('X-Test-Subject');
  if (subject) res.locals.auth={subject};
  next();
};

describe('PostgreSQL and live Python learning loop',{skip:!databaseUrl||!pythonUrl},() => {
  let db:Database;
  let repo:Repositories;
  let personalization:PersonalizationService;
  before(async () => {
    // This suite truncates fixtures; refuse to run against a non-test database.
    const parsed=new URL(databaseUrl!);
    assert.match(parsed.pathname,/_test$/,'TEST_DATABASE_URL database name must end in _test');
    db=createDatabase(databaseUrl!);
    repo=new Repositories(db);
    personalization=new PersonalizationService(pythonUrl!,key);
    await migrate(db);
    await migrate(db);
  });
  beforeEach(async () => {
    await db.query('TRUNCATE users,scam_patterns CASCADE');
    await seedPatterns(db);
  });
  after(async () => {await db?.end();});

  async function player(subject='player-a') {
    return repo.saveUser(subject,preferencesSchema.parse({name:subject,profession:'student',interests:['shopping'],enabledChannels:['text','email','call']}));
  }
  async function reserve(user:User,pattern?:Pattern) {
    const p=pattern??(await repo.patterns()).find((p) => p.kind==='scam'&&p.channel==='text'&&p.tactics.includes('urgency'))!;
    const now=new Date();
    const session=await repo.startSession(user.id,0,now);
    const rec:Recommendation={patternId:p.id,channel:p.channel,difficulty:'beginner',targetedTactics:p.tactics,explanation:'Fixture recommendation',engineVersion:'rules-v1',randomSeed:42};
    const attempt=await repo.reserveAttempt(user.id,session.id,rec,now);
    assert.ok(attempt);
    return {attempt,session,pattern:p,rec};
  }
  async function assessed(user:User,tactic='urgency',kind='scam') {
    const p=(await repo.patterns()).find((p) => p.kind===kind&&p.channel==='text'&&(kind==='legitimate'||p.tactics.includes(tactic as 'urgency')))!;
    const {attempt}=await reserve(user,p);
    await repo.publishAttempt(user.id,attempt.id,scenario);
    const assessment:Assessment={attemptId:attempt.id,rubricVersion:'fixture-v1',score:20,classification:'incorrect',findings:p.tactics.map((t) => ({tactic:t,outcome:'missed',evidence:'Observed fixture action'})),feedback:'Fixture feedback'};
    await repo.finalizeAssessment(user.id,assessment);
    await repo.acknowledgeFeedback(user.id,attempt.id,0);
    return {attempt,assessment};
  }

  test('migrations and seed are repeatable and include 24 patterns',async () => {
    await seedPatterns(db);
    const patterns=await repo.patterns();
    assert.equal(patterns.length,24);
    for (const c of ['text','email','call']) {
      assert.equal(patterns.filter((p) => p.channel===c&&p.kind==='scam').length,5);
      assert.equal(patterns.filter((p) => p.channel===c&&p.kind==='legitimate').length,3);
    }
  });

  test('verified login identity isolates users and survives reconstructed API instances',async () => {
    const app=createApp({repo,personalization,authenticate});
    await supertest(app).get('/api/v1/users/me').set('Authorization','pretend').expect(401);
    const first=await supertest(app).put('/api/v1/users/me').set('X-Test-Subject','account-a').send({name:'Alice',enabledChannels:['text']}).expect(200);
    const second=await supertest(app).put('/api/v1/users/me').set('X-Test-Subject','account-b').send({name:'Bob',enabledChannels:['email']}).expect(200);
    assert.notEqual(first.body.id,second.body.id);
    assert.equal(first.body.authIdentity,undefined);
    await supertest(app).put('/api/v1/users/me').set('X-Test-Subject','account-a').send({name:'Alice',enabledChannels:['text'],userId:second.body.id}).expect(400);
    const reconstructed=createApp({repo:new Repositories(db),personalization,authenticate});
    const recovered=await supertest(reconstructed).get('/api/v1/users/me').set('X-Test-Subject','account-a').expect(200);
    assert.equal(recovered.body.id,first.body.id);
    assert.equal(recovered.body.name,'Alice');
    await supertest(app).post('/api/v1/assessments').set('X-Test-Subject','account-a').send({score:100}).expect(404);
  });

  test('concurrent reservations create exactly one active attempt',async () => {
    const user=await player();
    const {session,rec,attempt}=await reserve(user);
    await repo.abandonAttempt(user.id,attempt.id);
    await db.query('UPDATE game_sessions SET next_arrival_at=now() WHERE id=$1',[session.id]);
    const attempts=await Promise.all(Array.from({length:10},() => repo.reserveAttempt(user.id,session.id,rec,new Date(Date.now()+100))));
    assert.equal(attempts.filter(Boolean).length,1);
    const rows=await db.query("SELECT * FROM attempts WHERE session_id=$1 AND status='reserved'",[session.id]);
    assert.equal(rows.rowCount,1);
  });

  test('ownership enforced in repositories and composite foreign keys',async () => {
    const a=await player('a');
    const b=await player('b');
    const {attempt,session}=await reserve(a);
    await assert.rejects(repo.publicAttempt(b.id,attempt.id),{status:404});
    await assert.rejects(repo.setSessionStatus(b.id,session.id,'paused',15000),{status:404});
    const bs=await repo.startSession(b.id,0);
    await assert.rejects(db.query('UPDATE game_sessions SET active_attempt_id=$1,next_arrival_at=NULL WHERE id=$2',[attempt.id,bs.id]),{code:'23503'});
    await assert.rejects(db.query('INSERT INTO messages(id,user_id,attempt_id,role,content,occurred_at) VALUES($1,$2,$3,$4,$5,now())',[randomUUID(),b.id,attempt.id,'user','spoofed']),{code:'23503'});
  });

  test('duplicate events, messages, and assessments never double-count',async () => {
    const user=await player();
    const {attempt}=await reserve(user);
    await repo.publishAttempt(user.id,attempt.id,scenario);
    const event={eventId:randomUUID(),action:'opened' as const,occurredAt:new Date().toISOString(),metadata:{}};
    const events=await Promise.all([repo.appendEvent(user.id,attempt.id,event),repo.appendEvent(user.id,attempt.id,event)]);
    assert.equal(events.filter(Boolean).length,1);
    const message={id:randomUUID(),role:'user' as const,content:'I will verify this independently.',occurredAt:new Date().toISOString()};
    assert.equal(await repo.appendMessage(user.id,attempt.id,message),true);
    assert.equal(await repo.appendMessage(user.id,attempt.id,message),false);
    const context = await repo.assessmentContext(user.id, attempt.id);
    assert.equal(context.messages.length, 1);
    assert.equal(context.events.length, 1);
    assert.equal(context.pattern.kind, 'scam');
    const assessment:Assessment={attemptId:attempt.id,rubricVersion:'fixture',score:20,classification:'incorrect',findings:[{tactic:'urgency',outcome:'missed',evidence:'Observed action'}],feedback:'Check independently.'};
    const results=await Promise.all([repo.finalizeAssessment(user.id,assessment),repo.finalizeAssessment(user.id,{...assessment,score:100})]);
    assert.deepEqual(results[0],results[1]);
    assert.equal((await repo.history(user.id)).length,1);
    assert.equal((await personalization.profile(await repo.history(user.id))).weaknesses.urgency.evidenceCount,1);
    assert.equal(await repo.appendEvent(user.id,attempt.id,event),false);
  });

  test('refresh recovers public state without answer keys; feedback releases next arrival',async () => {
    const user=await player();
    const {attempt,session}=await reserve(user);
    await repo.publishAttempt(user.id,attempt.id,scenario);
    const app=createApp({repo,personalization,authenticate});
    const recovered=await supertest(app).get('/api/v1/game-sessions/current').set('X-Test-Subject','player-a').expect(200);
    assert.equal(recovered.body.attempt.id,attempt.id);
    for (const field of ['patternId','recommendation','kind','warningSigns','targetedTactics','explanation']) assert.equal(recovered.body.attempt[field],undefined);
    assert.equal(recovered.body.attempt.feedback,null);
    const other=await player('other');
    assert.equal((await repo.currentSession(other.id)),null);
    await repo.finalizeAssessment(user.id,{attemptId:attempt.id,rubricVersion:'fixture',score:80,classification:'correct',findings:[{tactic:'urgency',outcome:'caught',evidence:'Verified sender'}],feedback:'Good verification.'});
    const feedback=await repo.publicAttempt(user.id,attempt.id);
    assert.equal(feedback.feedback?.kind,'scam');
    assert.equal((await repo.currentSession(user.id))?.nextArrivalAt,null);
    await repo.acknowledgeFeedback(user.id,attempt.id,20000);
    assert.equal((await repo.currentSession(user.id))?.activeAttemptId,null);
    assert.ok((await repo.currentSession(user.id))?.nextArrivalAt);
    assert.equal(session.id,(await repo.startSession(user.id,20000)).id);
  });

  test('paused sessions stop scheduling/actions and resume without replacing an attempt',async () => {
    const user=await player();
    const session=await repo.startSession(user.id,0);
    await repo.setSessionStatus(user.id,session.id,'paused',15000);
    const sim=new SimulationService(repo,personalization);
    assert.equal(await sim.next(user,session.id,42),null);
    assert.equal((await repo.currentSession(user.id))?.nextArrivalAt,null);
    await repo.setSessionStatus(user.id,session.id,'active',0);
    const next=await sim.next(user,session.id,42,new Date(Date.now()+100));
    assert.ok(next);
    await repo.publishAttempt(user.id,next.attempt.id,scenario);
    await repo.setSessionStatus(user.id,session.id,'paused',15000);
    await assert.rejects(repo.appendEvent(user.id,next.attempt.id,{eventId:randomUUID(),action:'opened',occurredAt:new Date().toISOString(),metadata:{}}),{status:409});
    const resumed=await repo.setSessionStatus(user.id,session.id,'active',15000);
    assert.equal(resumed.activeAttemptId,next.attempt.id);
    assert.equal(resumed.nextArrivalAt,null);
  });

  test('ending a session clears its active attempt and permits a new session',async () => {
    const user = await player();
    const { attempt, session } = await reserve(user);
    await repo.endSession(user.id, session.id);
    await repo.endSession(user.id, session.id);
    assert.equal(await repo.currentSession(user.id), null);
    assert.equal((await repo.attempt(user.id, attempt.id)).status, 'abandoned');
    assert.equal((await repo.history(user.id)).length, 0);
    assert.notEqual((await repo.startSession(user.id, 15000)).id, session.id);
  });

  test('two users learn different weaknesses and receive different recommendations',async () => {
    const a=await player('urgency-user');
    const b=await player('authority-user');
    for (let i=0;i<3;i++) {await assessed(a,'urgency');await assessed(b,'authority');}
    const analytics=new AnalyticsService(repo,personalization);
    const pa=await analytics.forUser(a.id);
    const pb=await analytics.forUser(b.id);
    assert.equal(pa.weaknesses.urgency.evidenceCount,3);
    assert.equal(pb.weaknesses.authority.evidenceCount,3);
    assert.equal(pa.scoreHistory.length,3);
    assert.equal(pa.scamMisses.rate,1);
    const patterns=await repo.patterns();
    let differs=false;
    for (let seed=0;seed<20&&!differs;seed++) {
      const ra=await personalization.recommend({history:await repo.history(a.id),profile:await personalization.profile(await repo.history(a.id)),enabledChannels:a.enabledChannels,profession:a.profession,interests:a.interests,candidatePatterns:patterns,recentPatternIds:[],randomSeed:seed});
      const rb=await personalization.recommend({history:await repo.history(b.id),profile:await personalization.profile(await repo.history(b.id)),enabledChannels:b.enabledChannels,profession:b.profession,interests:b.interests,candidatePatterns:patterns,recentPatternIds:[],randomSeed:seed});
      differs=ra.targetedTactics.includes('urgency')&&rb.targetedTactics.includes('authority');
    }
    assert.ok(differs);
    const app=createApp({repo,personalization,authenticate});
    const body=await supertest(app).get('/api/v1/analytics/me').set('X-Test-Subject','authority-user').expect(200);
    assert.equal(body.body.weaknesses.urgency.evidenceCount,0);
    assert.equal(body.body.weaknesses.authority.evidenceCount,3);
  });

  test('legitimate errors remain separate; unknown and abandoned attempts do not improve scores',async () => {
    const user=await player();
    await assessed(user,'urgency','legitimate');
    const {attempt}=await reserve(user);
    await repo.publishAttempt(user.id,attempt.id,scenario);
    await repo.finalizeAssessment(user.id,{attemptId:attempt.id,rubricVersion:'fixture',score:100,classification:'unknown',findings:[{tactic:'urgency',outcome:'unknown',evidence:'Insufficient evidence'}],feedback:'No observable outcome.'});
    await repo.acknowledgeFeedback(user.id,attempt.id,0);
    const abandoned=await reserve(user);
    await repo.abandonAttempt(user.id,abandoned.attempt.id);
    const analytics=await new AnalyticsService(repo,personalization).forUser(user.id);
    assert.equal(analytics.falseAlarms.rate,1);
    assert.equal(analytics.scamMisses.rate,null);
    assert.equal(analytics.weaknesses.urgency.evidenceCount,0);
    assert.equal(analytics.currentDifficulty,'beginner');
    assert.equal(analytics.scoreHistory.length,1);
    assert.equal(analytics.assessedCount,1);
    assert.equal(analytics.finalizedCount,2);
  });

  test('disabled channel updates affect future recommendations without changing active attempts',async () => {
    let user=await player();
    const {attempt}=await reserve(user);
    user=await repo.saveUser('player-a',preferencesSchema.parse({name:user.name,enabledChannels:['call']}));
    assert.equal((await repo.attempt(user.id,attempt.id)).channel,'text');
    await repo.abandonAttempt(user.id,attempt.id);
    const session=(await repo.currentSession(user.id))!;
    await db.query('UPDATE game_sessions SET next_arrival_at=now() WHERE id=$1',[session.id]);
    const next=await new SimulationService(repo,personalization).next(user,session.id,42,new Date(Date.now()+100));
    assert.equal(next?.attempt.channel,'call');
  });

  test('personalization failures preserve due state; generation failures release reservation',async () => {
    const user=await player();
    const session=await repo.startSession(user.id,0);
    const broken=new PersonalizationService('http://offline','secret',async () => {throw new Error('offline');});
    await assert.rejects(new SimulationService(repo,broken).next(user,session.id,42),{status:503});
    assert.equal((await repo.currentSession(user.id))?.activeAttemptId,null);
    assert.ok((await repo.currentSession(user.id))?.nextArrivalAt);
    const worker=new CampaignWorker(repo,new SimulationService(repo,personalization),{generate:async () => {throw new Error('AI offline');}});
    await assert.rejects(worker.tick(user,session.id),/AI offline/);
    assert.equal((await repo.currentSession(user.id))?.activeAttemptId,null);
    const {rows}=await db.query("SELECT status FROM attempts WHERE user_id=$1",[user.id]);
    assert.equal(rows[0]?.status,'generation_failed');
  });

  test('worker reserves before generation and rejects scenario/assessment answer-key injection',async () => {
    const user=await player();
    const session=await repo.startSession(user.id,0);
    let calls=0;
    const worker=new CampaignWorker(repo,new SimulationService(repo,personalization),{generate:async () => {calls++;return scenario;}});
    const results=await Promise.all([worker.tick(user,session.id),worker.tick(user,session.id)]);
    assert.equal(calls,1);
    assert.equal(results.filter(Boolean).length,1);
    const id=(await repo.currentSession(user.id))!.activeAttemptId!;
    await assert.rejects(repo.finalizeAssessment(user.id,{attemptId:id,rubricVersion:'fixture',score:200,classification:'correct',findings:[],feedback:'Bad score.'}));
    assert.equal((await repo.history(user.id)).length,0);
    await repo.abandonAttempt(user.id,id);
    await db.query('UPDATE game_sessions SET next_arrival_at=now() WHERE id=$1',[session.id]);
    const next=await new SimulationService(repo,personalization).next(user,session.id,42,new Date(Date.now()+100));
    assert.ok(next);
    await assert.rejects(repo.publishAttempt(user.id,next.attempt.id,{...scenario,kind:'scam'} as typeof scenario));
  });
});
