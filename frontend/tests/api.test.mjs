import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthenticatedApi } from '../src/lib/authenticatedRequest.ts'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
function fixture(request) {
  const user = { uid: 'account-a', getIdToken: async () => 'fixture-token' }
  const session = { currentUser: user, authStateReady: async () => {} }
  let signouts = 0
  const api = createAuthenticatedApi(session, async () => { signouts += 1 }, request)
  return { session, user, api, signouts: () => signouts }
}
const otherUser = () => ({ uid: 'account-b', getIdToken: async () => 'other-fixture-token' })

test('profile requests use the current token and JSON content type', async () => {
  const { api } = fixture(async (path, init) => {
    assert.equal(path, '/api/users/me')
    assert.equal(init.headers.get('Authorization'), 'Bearer fixture-token')
    assert.equal(init.headers.get('Content-Type'), 'application/json')
    return Response.json({ name: 'Saved name' })
  })
  assert.deepEqual(await api('/users/me', { method: 'PUT', body: '{"name":"Saved name"}' }, 'account-a'), { name: 'Saved name' })
})

test('a profile save cannot use another account after waiting for auth restoration', async () => {
  const ready = deferred()
  let requests = 0
  const { api, session } = fixture(async () => { requests += 1; return Response.json({}) })
  session.authStateReady = () => ready.promise
  const save = api('/users/me', { method: 'PUT', body: '{}' }, 'account-a')
  session.currentUser = otherUser()
  ready.resolve()
  await assert.rejects(save, /Session changed/)
  assert.equal(requests, 0)
})

test('switching accounts during token refresh prevents sending the old request', async () => {
  const token = deferred()
  const started = deferred()
  let requests = 0
  const { api, session, user } = fixture(async () => { requests += 1; return Response.json({}) })
  user.getIdToken = () => { started.resolve(); return token.promise }
  const save = api('/users/me', { method: 'PUT', body: '{}' }, 'account-a')
  await started.promise
  session.currentUser = otherUser()
  token.resolve('fixture-token')
  await assert.rejects(save, /Session changed/)
  assert.equal(requests, 0)
})

test('delayed success or rejection from a previous account cannot change the current session', async () => {
  for (const status of [200, 401]) {
    const response = deferred()
    const started = deferred()
    const { api, session, signouts } = fixture(() => { started.resolve(); return response.promise })
    const save = api('/users/me', { method: 'PUT', body: '{}' }, 'account-a')
    await started.promise
    const newUser = otherUser()
    session.currentUser = newUser
    response.resolve(Response.json({ name: 'Previous account' }, { status }))
    await assert.rejects(save, /Session changed/)
    assert.equal(signouts(), 0)
    assert.equal(session.currentUser, newUser)
  }
})

test('a rejected current session signs out while service failures remain retryable', async () => {
  for (const status of [401, 503]) {
    const { api, signouts } = fixture(async () => Response.json({ error: {} }, { status }))
    await assert.rejects(api('/users/me'), new RegExp(`failed with ${status}`))
    assert.equal(signouts(), status === 401 ? 1 : 0)
  }
})

test('aborting a request discards its late authentication error', async () => {
  const response = deferred()
  const started = deferred()
  const controller = new AbortController()
  const { api, signouts } = fixture(() => { started.resolve(); return response.promise })
  const read = api('/users/me', { signal: controller.signal }, 'account-a')
  await started.promise
  controller.abort()
  response.resolve(Response.json({}, { status: 401 }))
  await assert.rejects(read, { name: 'AbortError' })
  assert.equal(signouts(), 0)
})
