import assert from 'node:assert/strict'
import test from 'node:test'
import {
  passwordChecks,
  validateAuthForm,
  validateEmail,
} from '../src/features/auth/validation.ts'
import {
  getAuthErrorMessage,
  PasswordPolicyError,
} from '../src/features/auth/errors.ts'
import {
  resolveGuestRoute,
  resolveProtectedRoute,
  safeReturnPath,
} from '../src/features/auth/redirect.ts'

const valid = {
  name: 'Alex Taylor',
  email: 'alex@example.com',
  password: 'a long password',
  confirmPassword: 'a long password',
}

test('blank signup fields are reported in focus order', () => {
  const errors = validateAuthForm(
    { name: ' ', email: '', password: '', confirmPassword: '' },
    true,
  )
  assert.deepEqual(Object.keys(errors), [
    'name',
    'email',
    'password',
    'confirmPassword',
  ])
})

test('email validation accepts surrounding whitespace and rejects malformed addresses', () => {
  assert.equal(validateEmail('  alex@example.com  '), undefined)
  for (const email of [
    'alex',
    'alex@',
    '@example.com',
    'alex @example.com',
    'alex@example',
  ]) {
    assert.ok(validateEmail(email))
  }
})

test('login does not impose signup password or name requirements on existing users', () => {
  assert.deepEqual(
    validateAuthForm(
      { ...valid, name: '', password: 'short', confirmPassword: '' },
      false,
    ),
    {},
  )
})

test('new passwords require eight characters and matching confirmation', () => {
  assert.ok(
    validateAuthForm(
      { ...valid, password: 'short', confirmPassword: 'short' },
      true,
    ).password,
  )
  assert.ok(
    validateAuthForm({ ...valid, confirmPassword: 'different' }, true)
      .confirmPassword,
  )
  assert.deepEqual(validateAuthForm(valid, true), {})
})

test('password whitespace is significant and validation never mutates credentials', () => {
  const values = Object.freeze({
    ...valid,
    password: ' password ',
    confirmPassword: 'password',
  })
  assert.ok(validateAuthForm(values, true).confirmPassword)
  assert.equal(values.password, ' password ')
})

test('credential errors use the same message without exposing account existence', () => {
  const codes = [
    'auth/invalid-credential',
    'auth/user-not-found',
    'auth/wrong-password',
  ]
  assert.equal(
    new Set(codes.map((code) => getAuthErrorMessage({ code }))).size,
    1,
  )
})

test('Firebase errors are translated without leaking internal error messages', () => {
  for (const code of [
    'auth/email-already-in-use',
    'auth/too-many-requests',
    'auth/network-request-failed',
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/unauthorized-domain',
  ]) {
    const message = getAuthErrorMessage({
      code,
      message: 'INTERNAL_PROVIDER_DETAILS',
    })
    assert.ok(message.length > 20)
    assert.ok(!message.includes('INTERNAL_PROVIDER_DETAILS'))
  }
  assert.match(getAuthErrorMessage(null), /try again/i)
  assert.match(getAuthErrorMessage({ code: 'unknown' }), /try again/i)
})

test('password-policy guidance survives error translation', () => {
  assert.equal(
    getAuthErrorMessage(new PasswordPolicyError('Use an uppercase letter.')),
    'Use an uppercase letter.',
  )
})

test('Google popup outcomes get specific, friendly messages', () => {
  const cancelled = getAuthErrorMessage({ code: 'auth/popup-closed-by-user' })
  assert.match(cancelled, /cancelled/)
  assert.equal(
    getAuthErrorMessage({ code: 'auth/cancelled-popup-request' }),
    cancelled,
  )
  assert.equal(getAuthErrorMessage({ code: 'auth/user-cancelled' }), cancelled)
  assert.match(
    getAuthErrorMessage({ code: 'auth/popup-blocked' }),
    /allow popups/i,
  )
  assert.match(
    getAuthErrorMessage({ code: 'auth/web-storage-unsupported' }),
    /cookies/,
  )
})

const ready = { initializing: false, signedIn: false, pending: null }

test('protected pages wait for the session check, then render or send visitors to login', () => {
  assert.deepEqual(
    resolveProtectedRoute({ ...ready, initializing: true }, '/home'),
    { kind: 'loading' },
  )
  assert.deepEqual(
    resolveProtectedRoute(
      { ...ready, initializing: true, signedIn: true },
      '/home',
    ),
    { kind: 'loading' },
  )
  assert.deepEqual(
    resolveProtectedRoute({ ...ready, signedIn: true }, '/train/a'),
    { kind: 'render' },
  )
  assert.deepEqual(resolveProtectedRoute(ready, '/train/a?step=2'), {
    kind: 'redirect',
    to: '/login',
    from: '/train/a?step=2',
  })
})

test('signing out lands on a plain login page without a return path', () => {
  assert.deepEqual(
    resolveProtectedRoute({ ...ready, pending: 'signout' }, '/train/a'),
    { kind: 'redirect', to: '/login' },
  )
  // Still signed in while sign-out is in flight: keep rendering.
  assert.deepEqual(
    resolveProtectedRoute(
      { ...ready, signedIn: true, pending: 'signout' },
      '/home',
    ),
    { kind: 'render' },
  )
})

test('auth pages render while checking or signed out, and redirect signed-in users home', () => {
  assert.deepEqual(resolveGuestRoute({ ...ready, initializing: true }), {
    kind: 'render',
  })
  assert.deepEqual(
    resolveGuestRoute({ ...ready, initializing: true, signedIn: true }),
    { kind: 'render' },
  )
  assert.deepEqual(resolveGuestRoute(ready), { kind: 'render' })
  assert.deepEqual(resolveGuestRoute({ ...ready, signedIn: true }), {
    kind: 'redirect',
    to: '/home',
  })
  assert.deepEqual(
    resolveGuestRoute({ ...ready, signedIn: true, from: '/train/a' }),
    { kind: 'redirect', to: '/train/a' },
  )
})

test('auth pages wait for signup or sign-in to finish before redirecting', () => {
  // Firebase signs in before the display name is saved; leaving early would drop the profile warning.
  for (const pending of ['signup', 'login', 'google']) {
    assert.deepEqual(resolveGuestRoute({ ...ready, signedIn: true, pending }), {
      kind: 'render',
    })
  }
})

test('return paths stay inside the app and never loop back to auth pages', () => {
  assert.equal(safeReturnPath('/train/abc?x=1#y'), '/train/abc?x=1#y')
  for (const from of [
    undefined,
    null,
    42,
    { pathname: '/home' },
    '',
    'home',
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    '/',
    '/login',
    '/signup',
    '/login?next=1',
    '/signup/',
  ]) {
    assert.equal(safeReturnPath(from), '/home', String(from))
  }
  assert.equal(safeReturnPath('/loginhelp'), '/loginhelp')
})

test('the signup password checklist tracks length and matching live', () => {
  const state = (password, confirm) =>
    passwordChecks(password, confirm).map((check) => check.met)
  assert.deepEqual(state('', ''), [false, false])
  assert.deepEqual(state('short', 'short'), [false, true])
  assert.deepEqual(state('a long password', ''), [true, false])
  assert.deepEqual(state('a long password', 'a long passwor'), [true, false])
  assert.deepEqual(state('a long password', 'a long password'), [true, true])
  // The checklist and submit validation agree on the length rule.
  assert.equal(
    validateAuthForm(
      {
        name: 'A',
        email: 'a@b.co',
        password: '1234567',
        confirmPassword: '1234567',
      },
      true,
    ).password !== undefined,
    !passwordChecks('1234567', '1234567')[0].met,
  )
})
