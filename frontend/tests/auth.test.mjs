import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAuthForm, validateEmail } from '../src/auth/validation.ts'
import { getAuthErrorMessage, PasswordPolicyError } from '../src/auth/errors.ts'

const valid = { name: 'Alex Taylor', email: 'alex@example.com', password: 'a long password', confirmPassword: 'a long password' }

test('blank signup fields are reported in focus order', () => {
  const errors = validateAuthForm({ name: ' ', email: '', password: '', confirmPassword: '' }, true)
  assert.deepEqual(Object.keys(errors), ['name', 'email', 'password', 'confirmPassword'])
})

test('email validation accepts surrounding whitespace and rejects malformed addresses', () => {
  assert.equal(validateEmail('  alex@example.com  '), undefined)
  for (const email of ['alex', 'alex@', '@example.com', 'alex @example.com', 'alex@example']) {
    assert.ok(validateEmail(email))
  }
})

test('login does not impose signup password or name requirements on existing users', () => {
  assert.deepEqual(validateAuthForm({ ...valid, name: '', password: 'short', confirmPassword: '' }, false), {})
})

test('new passwords require eight characters and matching confirmation', () => {
  assert.ok(validateAuthForm({ ...valid, password: 'short', confirmPassword: 'short' }, true).password)
  assert.ok(validateAuthForm({ ...valid, confirmPassword: 'different' }, true).confirmPassword)
  assert.deepEqual(validateAuthForm(valid, true), {})
})

test('password whitespace is significant and validation never mutates credentials', () => {
  const values = Object.freeze({ ...valid, password: ' password ', confirmPassword: 'password' })
  assert.ok(validateAuthForm(values, true).confirmPassword)
  assert.equal(values.password, ' password ')
})

test('credential errors use the same message without exposing account existence', () => {
  const codes = ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password']
  assert.equal(new Set(codes.map((code) => getAuthErrorMessage({ code }))).size, 1)
})

test('Firebase errors are translated without leaking internal error messages', () => {
  for (const code of ['auth/email-already-in-use', 'auth/too-many-requests', 'auth/network-request-failed', 'auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/unauthorized-domain']) {
    const message = getAuthErrorMessage({ code, message: 'INTERNAL_PROVIDER_DETAILS' })
    assert.ok(message.length > 20)
    assert.ok(!message.includes('INTERNAL_PROVIDER_DETAILS'))
  }
  assert.match(getAuthErrorMessage(null), /try again/i)
  assert.match(getAuthErrorMessage({ code: 'unknown' }), /try again/i)
})

test('password-policy guidance survives error translation', () => {
  assert.equal(getAuthErrorMessage(new PasswordPolicyError('Use an uppercase letter.')), 'Use an uppercase letter.')
})
