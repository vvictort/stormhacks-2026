import { fakeRepos, testServices } from './harness.ts';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { profileSchema } from '../app/users/users.schema.ts';
import { createDatabase, type Database } from '../app/db/database.ts';
import { migrate } from '../app/db/migrate.ts';
import { createRepositories, type Repositories } from '../app/repositories.ts';
import { createApp } from '../app/server.ts';

const origin = 'http://localhost:5173';
// Profile routes never touch simulations; one shared set keeps createApp's wiring complete.
const sims = testServices(fakeRepos());
after(sims.close);
const services = sims.services;
const identity = (uid: string) => ({ uid, sub: uid, aud: 'test-project', iss: 'https://securetoken.google.com/test-project', auth_time: 0, iat: 0, exp: 9999999999, firebase: { identities: {}, sign_in_provider: 'password' }, email: `${uid}@example.test`, email_verified: true, name: uid === 'alex' ? 'Alex' : undefined }) as DecodedIdToken;
const verifyToken = async (token: string) => {
  if (token === 'alex' || token === 'sam') return identity(token);
  throw Object.assign(new Error('TOKEN_PRIVATE'),{code:'auth/invalid-id-token'});
};
test('profile validation normalizes phone and rejects empty fields, credentials and identity overrides', () => {
  assert.equal(profileSchema.parse({ name: ' Alex ', phone: '+1 (604) 555-1234' }).phone, '+16045551234');
  for (const input of [{name:'',phone:'+16045551234'},{name:'Alex',phone:'6045551234'},{name:'Alex',phone:'+16045551234',uid:'sam'},{name:'Alex',phone:'+16045551234',password:'private'},{name:'Alex',phone:'+16045551234',email:'sam@example.test'}]) assert.equal(profileSchema.safeParse(input).success,false);
});
test('Firebase rejection is 401 but database/provider failures remain retryable without leaking details', async () => {
  const repo = createRepositories({query:async()=>{throw new Error('DATABASE_PASSWORD_PRIVATE');}} as unknown as Database);
  const app = createApp({repos:repo,services,origin,verifyToken});
  await supertest(app).get('/api/users/me').expect(401);
  const invalid = await supertest(app).get('/api/users/me').set('Authorization','Bearer invalid').expect(401);
  assert.equal(invalid.body.error.code,'INVALID_TOKEN');
  const offline = await supertest(app).get('/api/users/me').set('Authorization','Bearer alex').expect(503);
  assert.equal(JSON.stringify(offline.body).includes('PRIVATE'),false);
  const provider = createApp({repos:repo,services,origin,verifyToken:async()=>{throw Object.assign(new Error('Provider unavailable'),{code:'auth/internal-error'});}});
  await supertest(provider).get('/api/users/me').set('Authorization','Bearer alex').expect(503);
});

const url = process.env.TEST_DATABASE_URL;
describe('TigerData-compatible profile persistence', {skip:!url}, () => {
  let db: Database;
  let repo: Repositories;
  let app: ReturnType<typeof createApp>;
  const profile = {name:'Alex Taylor',phone:'+1 (604) 555-1234',profession:'student',interests:['gaming','travel']};
  before(async()=>{
    assert.match(new URL(url!).pathname,/_test$/,'Use a dedicated test database.');
    db=createDatabase(url!);repo=createRepositories(db);
    await migrate(db);await migrate(db);
  });
  beforeEach(async()=>{await db.query('TRUNCATE user_profiles');app=createApp({repos:repo,services,origin,verifyToken});});
  after(async()=>{await db?.end();});
  const get = (token='alex') => supertest(app).get('/api/users/me').set('Authorization',`Bearer ${token}`);
  const put = (body: object,token='alex') => supertest(app).put('/api/users/me').set('Origin',origin).set('Authorization',`Bearer ${token}`).send(body);
  test('first login persists Firebase identity and concurrent retries create one profile', async()=>{
    const results=await Promise.all([get().expect(200),get().expect(200)]);
    assert.equal(results[0].body.id,results[1].body.id);
    assert.equal(results[0].body.uid,'alex');
    assert.equal(results[0].body.email,'alex@example.test');
    assert.equal(results[0].body.emailVerified,true);
    assert.equal(results[0].body.onboardingComplete,false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM user_profiles')).rows[0].n,1);
  });
  test('onboarding persists through repeated saves, relogin and recreated server',async()=>{
    const first=await put(profile).expect(200);
    assert.equal(first.body.onboardingComplete,true);
    assert.equal(first.body.phone,'+16045551234');
    const repeated=await put({...profile,name:'My saved name'}).expect(200);
    const recreated=createApp({repos:createRepositories(db),services,origin,verifyToken});
    const restored=await supertest(recreated).get('/api/users/me').set('Authorization','Bearer alex').expect(200);
    assert.equal(restored.body.id,first.body.id);
    assert.equal(restored.body.name,'My saved name');
    assert.deepEqual(restored.body,repeated.body);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM user_profiles')).rows[0].n,1);
  });
  test('Firebase identities isolate profiles and cannot be overridden in the browser',async()=>{
    const a=await put(profile).expect(200);
    const b=await get('sam').expect(200);
    assert.notEqual(a.body.id,b.body.id);
    assert.equal(b.body.phone,null);
    await put({...profile,uid:'sam'}).expect(400);
    await put({...profile,id:b.body.id}).expect(400);
    await put({...profile,email:'sam@example.test'}).expect(400);
    await supertest(app).get(`/api/users/${b.body.uid}`).set('Authorization','Bearer alex').expect(404);
    assert.equal((await get('sam')).body.onboardingComplete,false);
  });
  test('invalid onboarding never completes and names missing in the token remain editable',async()=>{
    await get('sam').expect(200);
    await put({...profile,phone:'5551234'},'sam').expect(400);
    await put({...profile,name:''},'sam').expect(400);
    assert.equal((await get('sam')).body.onboardingComplete,false);
    assert.equal((await put(profile,'sam')).body.name,'Alex Taylor');
  });
  test('browser writes require the allowed origin and JSON and no passwords are stored',async()=>{
    await supertest(app).put('/api/users/me').set('Authorization','Bearer alex').set('Origin','https://evil.example').send(profile).expect(403);
    await supertest(app).put('/api/users/me').set('Authorization','Bearer alex').send(profile).expect(403);
    await supertest(app).put('/api/users/me').set('Origin',origin).set('Authorization','Bearer alex').type('form').send('name=Alex').expect(415);
    const saved=await put(profile).expect(200);
    assert.equal(JSON.stringify(saved.body).includes('password'),false);
    const columns=await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='user_profiles'");
    assert.equal(columns.rows.some((row)=>/password|token/.test(row.column_name)),false);
  });
  test('account email changes follow Firebase without overwriting personal preferences',async()=>{
    const saved=await put(profile).expect(200);
    const updated=await repo.users.ensureUser({...identity('alex'),email:'updated@example.test',email_verified:false,name:'Provider name'});
    assert.equal(updated.id,saved.body.id);
    assert.equal(updated.email,'updated@example.test');
    assert.equal(updated.emailVerified,false);
    assert.equal(updated.name,profile.name);
    assert.equal(updated.phone,'+16045551234');
  });
});
