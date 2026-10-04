import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalize,
  scoreFlags,
  splitIntoPhrases,
} from '../src/features/training/flagging.ts'

test('normalize strips punctuation, lowercases, and collapses whitespace', () => {
  assert.equal(
    normalize('  Hello, World! Urgent Action: Now...  '),
    'hello world urgent action now',
  )
  assert.equal(
    normalize('bank.secure-login.info/verify'),
    'bank secure login info verify',
  )
})

test('splitIntoPhrases splits text into natural clauses and sentences', () => {
  const text =
    'Your account is suspended. Please click the link below, or your card will be blocked.'
  const phrases = splitIntoPhrases(text)
  assert.ok(phrases.length >= 2)
  assert.equal(phrases[0], 'Your account is suspended.')
  assert.ok(phrases.some((p) => p.includes('your card will be blocked.')))
})

test('scoreFlags accurately counts caught, missed, and false flags', () => {
  const indicators = [
    {
      quote: 'Immediate action required',
      title: 'Artificial Urgency',
      detail: 'Pressure',
    },
    {
      quote: 'support@paypa1-security.com',
      title: 'Spoofed Address',
      detail: 'Typo',
    },
  ]

  // Case 1: User flagged 1 matching phrase, 1 missed, 0 wrong
  let score = scoreFlags(['Immediate action required'], indicators)
  assert.equal(score.caught, 1)
  assert.equal(score.missed, 1)
  assert.equal(score.wrong, 0)
  assert.equal(score.totalIndicators, 2)
  assert.equal(score.details[0].caught, true)
  assert.equal(score.details[1].caught, false)

  // Case 2: Substring matching (user flagged a slightly broader clause containing the quote)
  score = scoreFlags(
    ['Warning: Immediate action required before 5 PM', 'Hello Kelvin'],
    indicators,
  )
  // 'Warning: Immediate action required before 5 PM' contains 'Immediate action required' -> caught
  // 'Hello Kelvin' does not match any indicator -> wrong: 1
  assert.equal(score.caught, 1)
  assert.equal(score.missed, 1)
  assert.equal(score.wrong, 1)
  assert.equal(score.userFlags[0].matched, true)
  assert.equal(score.userFlags[1].matched, false)

  // Case 3: All caught with exact quotes
  score = scoreFlags(
    ['Immediate action required', 'support@paypa1-security.com'],
    indicators,
  )
  assert.equal(score.caught, 2)
  assert.equal(score.missed, 0)
  assert.equal(score.wrong, 0)

  // Case 4: User flagged everything blindly (10 false flags)
  const spamFlags = [
    'Dear Customer',
    'Thank you',
    'Have a nice day',
    'support@paypa1-security.com',
    'Please verify',
  ]
  score = scoreFlags(spamFlags, indicators)
  assert.equal(score.caught, 1)
  assert.equal(score.missed, 1)
  assert.equal(score.wrong, 4) // 4 false alarms
})
