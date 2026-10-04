import assert from 'node:assert/strict'
import test from 'node:test'
import { validateOnboarding } from '../src/features/profile/validation.ts'
test('onboarding requires a name and international phone number', () => {
  assert.deepEqual(Object.keys(validateOnboarding({name:'',phone:'6045551234',profession:'',interests:''})),['name','phone'])
  assert.deepEqual(validateOnboarding({name:'Alex',phone:'+1 (604) 555-1234',profession:'',interests:'gaming, travel'}),{})
})
test('optional personalization fields have bounded sizes', () => {
  assert.ok(validateOnboarding({name:'Alex',phone:'+16045551234',profession:'x'.repeat(201),interests:''}).profession)
  assert.ok(validateOnboarding({name:'Alex',phone:'+16045551234',profession:'',interests:Array(31).fill('gaming').join(',')}).interests)
})
