"""python -m unittest (from data-pipeline/). Uses only the SYNTHETIC fixtures in tests/fixtures/."""
import json
import re
import unittest
from pathlib import Path

from tellio_data import OUTPUT_PATH
from tellio_data.build import build
from tellio_data.curate import dedupe, jaccard, shingles
from tellio_data.normalize import calls, email, sms
from tellio_data.scrub import SUSPICIOUS_HOSTS, scrub, scrub_text
from tellio_data.tagging import categorize, find_tags, pattern, pick_cues, split_tags, tag_excerpt
from tellio_data.validate import validate
from tellio_data.vocabulary import SIGNALS, VOCAB_TS, load, parse

FIX = Path(__file__).parent / 'fixtures'
DIRS = {'email': FIX / 'email', 'sms': FIX / 'sms', 'call': FIX / 'call'}


def fixture_build():
    return build(('email', 'sms', 'call'), write=False, dirs=DIRS)


def assert_cues_exact(case, text, cues):
    spans = []
    for c in cues:
        case.assertIn(c['quote'], text)
        case.assertTrue(3 <= len(c['quote']) <= 120)
        start = text.find(c['quote'], spans[-1][1] if spans else 0)
        case.assertGreaterEqual(start, 0, f'cue overlaps or is out of order: {c}')
        spans.append((start, start + len(c['quote'])))


class Vocabulary(unittest.TestCase):
    def test_parses_real_vocabulary_ts(self):
        v = load()
        self.assertEqual(v['Tactic'], ('urgency', 'authority', 'suspicious_link', 'otp_request', 'info_request',
                                       'reward', 'fear'))
        self.assertEqual(len(v['ScamCategory']), 6)
        self.assertEqual(set(v['Channel']), {'sms', 'email', 'call'})
        self.assertFalse(set(SIGNALS) & set(v['Tactic']), 'signals must not duplicate tactics')

    def test_fails_loudly_if_enum_shape_changes(self):
        src = VOCAB_TS.read_text().replace("export const Tactic = z.enum(", "export const Tactic = z.union(")
        with self.assertRaises(ValueError):
            parse(src)


class Readers(unittest.TestCase):
    def test_email_skips_malformed_and_empty_rows(self):
        rows = list(email.read(DIRS['email'], files=('Nazario.csv',)))
        self.assertEqual(len(rows), 8)  # 10 rows minus missing label and empty body
        self.assertTrue(all(r['label'] in ('0', '1') and r['text'].strip() for r in rows))

    def test_calls_split_transcripts(self):
        rows = list(calls.read(DIRS['call']))
        self.assertEqual([r['kind'] for r in rows], ['scam'] * 3 + ['legitimate'] * 2)
        self.assertFalse(rows[0]['text'].startswith('1.'))

    def test_sms_finds_columns_and_skips_unlabeled(self):
        rows = list(sms.read(DIRS['sms']))
        self.assertEqual([r['kind'] for r in rows], ['scam', 'legitimate'])


class Scrubbing(unittest.TestCase):
    def test_pii_urls_and_brands(self):
        out = scrub_text('Dear John Smith, your PayPal and UPS account at 123 Main Street. Call (604) 555-1234, '
                         'mail john.smith@gmail.com, visit http://192.0.2.1/paypal/login?u=john. sign ups welcome. '
                         'Regards, Jane Doe')
        for leaked in ('John', 'Smith', 'PayPal', '604', 'gmail', '192.0.2.1', 'Main Street', 'Jane'):
            self.assertNotIn(leaked, out)
        self.assertIn('Dear Customer', out)
        self.assertIn('[Payment Service]', out)
        self.assertIn('[Courier]', out)
        self.assertIn('sign ups', out)  # all-caps brands match case-sensitively
        self.assertRegex(out, r'http://(%s)/login\.' % '|'.join(map(re.escape, SUSPICIOUS_HOSTS)))

    def test_legitimate_links_stay_unsuspicious(self):
        self.assertIn('http://links.example/', scrub_text('see http://secure-login.example-bank.com/x', scam=False))

    def test_junk_and_off_topic_rows_dropped(self):
        rec = {'kind': 'scam', 'subject': '', 'text': 'hi'}
        self.assertIsNone(scrub(rec))
        self.assertIsNone(scrub({**rec, 'text': 'Buy viagra pills now at the lowest price on the whole internet, '
                                                'friends, you will not regret it at all.'}))
        self.assertIsNone(scrub({**rec, 'kind': 'legitimate', 'subject': 'Re: lunch',
                                 'text': '> lunch?\nsure, see you at noon by the fountain, and bring the notes too.'}))

    def test_truncates_to_contract_limit(self):
        out = scrub({'kind': 'scam', 'subject': 'S' * 300, 'text': ' '.join(f'Notice {i}: please verify the account.' for i in range(200))})
        self.assertLessEqual(len(out['text']), 1200)
        self.assertLessEqual(len(out['subject']), 200)


class Tagging(unittest.TestCase):
    TEXT = ('Your account has been suspended. Click here and enter the verification code we sent, plus your '
            'password, immediately or face legal action.')

    def test_tactics_signals_and_implications(self):
        tactics, signals = split_tags(find_tags(self.TEXT))
        self.assertIn('otp_request', tactics)     # implied by verification_code
        self.assertIn('info_request', tactics)    # implied by credential_request
        self.assertIn('suspicious_link', tactics)
        self.assertIn('verification_code', signals)
        self.assertIn('credential_request', signals)
        self.assertIn('account_security', signals)
        self.assertLessEqual(len(tactics), 4)

    def test_cues_are_exact_and_non_overlapping(self):
        hits = find_tags(self.TEXT)
        tactics, signals = split_tags(hits)
        cues = pick_cues(self.TEXT, hits, tactics + signals)
        self.assertGreaterEqual(len(cues), 3)
        self.assertLessEqual(len(cues), 6)
        assert_cues_exact(self, self.TEXT, cues)

    def test_legitimate_gets_no_tactics(self):
        tags = tag_excerpt(self.TEXT, 'legitimate', self.TEXT)
        self.assertEqual((tags['tactics'], tags['signals'], tags['cues']), ([], [], []))

    def test_category_mapping(self):
        self.assertEqual(categorize('Your [Courier] parcel is held. Pay the redelivery fee with the tracking number.'),
                         'shipping')
        self.assertEqual(categorize('Unusual activity on your [Bank] debit card: review the transaction.'), 'banking')
        self.assertEqual(categorize('Your mailbox quota is full; log in with your password.'), 'account_security')
        self.assertEqual(categorize('Payroll update from human resources for every employee.'), 'workplace')
        self.assertIsNone(categorize('I am a barrister; my late client left an inheritance in a bank account.'))
        self.assertIsNone(categorize('hello there'))

    def test_pattern_uses_own_words_and_exact_cues(self):
        src = ('[Greetings], this is the fraud department of your bank. We noticed suspicious activity on your '
               'account. Please read me the one-time code we sent, and act immediately or it will be frozen.')
        p = pattern(src, 'scam', 'call')
        self.assertEqual(p['category'], 'banking')
        self.assertIn('otp_request', p['tactics'])
        assert_cues_exact(self, p['text'], p['cues'])
        src_words = re.findall(r'\w+', src.lower())
        five_grams = {' '.join(src_words[i:i + 5]) for i in range(len(src_words) - 4)}
        self.assertFalse(any(g in ' '.join(re.findall(r'\w+', p['text'].lower())) for g in five_grams))


class Curation(unittest.TestCase):
    def test_exact_duplicates_removed(self):
        a = {'id': 'email-1', 'channel': 'email', 'text': 'Verify your account NOW!'}
        b = {'id': 'email-2', 'channel': 'email', 'text': 'verify your account now'}
        self.assertEqual(dedupe([b, a]), [a])

    def test_near_duplicates_detected(self):
        x = 'we detected unusual activity on your account click here to verify within 24 hours'
        self.assertGreaterEqual(jaccard(shingles(x), shingles(x + ' thanks')), 0.5)


class Output(unittest.TestCase):
    def test_fixture_build_is_valid_deduped_and_deterministic(self):
        doc = fixture_build()
        report = doc.pop('_report')
        self.assertEqual(validate(doc), [])
        ex = doc['examples']
        texts = [e['text'] for e in ex if e['channel'] == 'email']
        self.assertEqual(sum('unusual activity' in t for t in texts), 1, 'exact + near duplicates collapse to one')
        self.assertFalse(any('viagra' in t.lower() for t in texts))
        self.assertTrue(all(e['textKind'] == 'pattern' for e in ex if e['channel'] in ('call', 'sms')))
        self.assertEqual(report['email']['raw_rows'], 8)
        for e in ex:
            assert_cues_exact(self, e['text'], e['cues'])
        again = fixture_build()
        again.pop('_report')
        self.assertEqual(json.dumps(doc, sort_keys=True), json.dumps(again, sort_keys=True))

    def test_validator_catches_contract_breaks(self):
        doc = fixture_build()
        doc.pop('_report')
        bad = json.loads(json.dumps(doc))
        e = next(x for x in bad['examples'] if x['cues'])
        e['cues'][0]['quote'] = 'not in the text at all'
        e['tactics'].append('romance')
        e['category'] = 'investment'
        errors = ' '.join(validate(bad))
        for needle in ('cue not an exact', 'tactics must be', 'bad category'):
            self.assertIn(needle, errors)

    @unittest.skipUnless(OUTPUT_PATH.exists(), 'no committed scam-library.json yet')
    def test_committed_library_is_valid(self):
        doc = json.loads(OUTPUT_PATH.read_text(encoding='utf-8'))
        self.assertEqual(validate(doc), [])
        self.assertLess(OUTPUT_PATH.stat().st_size, 1.5 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
