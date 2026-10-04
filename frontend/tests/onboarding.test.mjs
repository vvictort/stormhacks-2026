import assert from 'node:assert/strict'
import test from 'node:test'
import { splitPhone, toE164, validateOnboarding } from '../src/features/profile/validation.ts'
const base = { name: 'Alex', countryCode: '+1', phone: '6045551234', profession: '', interests: '' }
test('onboarding requires a name, a country code and a phone number', () => {
  assert.deepEqual(Object.keys(validateOnboarding({ ...base, name: '', phone: '123' })), ['name', 'phone'])
  assert.deepEqual(Object.keys(validateOnboarding({ ...base, countryCode: '' })), ['countryCode'])
  assert.deepEqual(validateOnboarding({ ...base, interests: 'gaming, travel' }), {})
})
test('the phone number is accepted in any format and joined to E.164', () => {
  for (const phone of ['6045551234', '604 555 1234', '(604) 555-1234', '604.555.1234', '604-5551234'])
    assert.equal(toE164('+1', phone), '+16045551234', phone)
  assert.equal(toE164('1', '6045551234'), '+16045551234')
  assert.equal(toE164('+44', '07700 900123'), '+447700900123', 'drops the UK trunk 0')
  assert.equal(toE164('+39', '06 1234 5678'), '+390612345678', 'Italy keeps its 0')
  assert.equal(toE164('', '+44 7700 900123'), '+447700900123', 'a pasted + number wins')
  assert.equal(toE164('+1', '555'), null)
  assert.equal(toE164('', '6045551234'), null)
})
test('stored numbers split back into the two boxes', () => {
  assert.deepEqual(splitPhone('+16045551234'), { countryCode: '+1', phone: '6045551234' })
  assert.deepEqual(splitPhone('+447700900123'), { countryCode: '', phone: '+447700900123' })
  assert.deepEqual(splitPhone(null), { countryCode: '+1', phone: '' })
})
test('optional personalization fields have bounded sizes', () => {
  assert.ok(validateOnboarding({ ...base, profession: 'x'.repeat(201) }).profession)
  assert.ok(validateOnboarding({ ...base, interests: Array(31).fill('gaming').join(',') }).interests)
})
