"""Raw datasets -> curated, validated backend/fixtures/scam-library.json."""
import hashlib
import json
from collections import Counter

from . import OUTPUT_PATH
from .curate import select
from .download import local_dir
from .normalize import calls, email, sms
from .scrub import scrub
from .sources import SOURCES
from .tagging import pattern, tag_excerpt
from .validate import validate

READERS = {'email': email.read, 'sms': sms.read, 'call': calls.read}


def example(record: dict, mode: str) -> dict | None:
    src = SOURCES[record['channel']]
    if mode == 'excerpts':
        clean = scrub(record)
        if clean is None:
            return None
        tags = tag_excerpt(clean['text'], clean['kind'], f"{clean['subject']}\n{clean['text']}")
        text, subject = clean['text'], clean['subject']
    else:
        # Derived-only: the source text never leaves this function; we keep only our own pattern summary.
        tags = pattern(record['text'], record['kind'], record['channel'])
        text, subject = tags.pop('text'), ''
    ex = {
        'id': f"{record['channel']}-{hashlib.sha1(f'{src['dataset']}:{record['row']}'.encode()).hexdigest()[:12]}",
        'channel': record['channel'], 'kind': record['kind'], 'category': tags['category'],
        'tactics': tags['tactics'], 'signals': tags['signals'], 'cues': tags['cues'],
        'difficulty': tags['difficulty'], 'text': text,
        'textKind': 'excerpt' if mode == 'excerpts' else 'pattern',
    }
    if subject and record['channel'] == 'email':
        ex['subject'] = subject
    ex['source'] = {'dataset': src['dataset'], 'license': src['license'], 'row': record['row'],
                    'label': record['label']}
    return ex


def build(channels=tuple(SOURCES), write: bool = True, dirs: dict | None = None) -> dict:
    dirs = dirs or {c: local_dir(c) for c in channels}
    sources, candidates, report = [], [], {}
    for channel in channels:
        directory, src = dirs.get(channel), SOURCES[channel]
        if directory is None:
            report[channel] = 'missing raw data (run: python -m tellio_data download --channel %s)' % channel
            continue
        raw = kept = 0
        for record in READERS[channel](directory):
            raw += 1
            ex = example(record, src['redistribution'])
            if ex:
                kept += 1
                candidates.append(ex)
        report[channel] = {'raw_rows': raw, 'after_scrub_and_junk_filter': kept}
        if kept:
            sources.append({'channel': channel, 'dataset': src['dataset'], 'url': src['url'],
                            'license': src['license'], 'redistribution': src['redistribution']})
    examples = select(candidates)
    for channel, stats in report.items():
        if isinstance(stats, dict):
            stats['retained'] = sum(e['channel'] == channel for e in examples)
            stats['by_kind'] = dict(Counter(e['kind'] for e in examples if e['channel'] == channel))
    doc = {'version': 1, 'sources': sources, 'examples': examples}
    errors = validate(doc)
    if errors:
        raise SystemExit('scam-library failed validation:\n' + '\n'.join(errors[:20]))
    if write:
        OUTPUT_PATH.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    doc['_report'] = report
    return doc
