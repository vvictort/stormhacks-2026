"""Schema check for scam-library.json (the contract shared with backend/app library loader)."""

import hashlib

from .vocabulary import SIGNALS, load


def validate(doc: dict) -> list[str]:
    v = load()
    tactics, categories = set(v['Tactic']), set(v['ScamCategory'])
    errors = []
    if doc.get('version') != 1:
        errors.append('version must be 1')
    sources = {}
    for s in doc.get('sources', []):
        if s.get('channel') not in v['Channel'] or s.get('redistribution') not in (
            'excerpts',
            'derived-only',
        ):
            errors.append(f'bad source {s}')
        for k in ('dataset', 'url', 'license'):
            if not isinstance(s.get(k), str) or not s[k]:
                errors.append(f'source missing {k}: {s}')
        sources[s.get('dataset')] = s
    ids = set()
    for ex in doc.get('examples', []):
        eid = ex.get('id', '?')
        err = lambda msg: errors.append(f'{eid}: {msg}')  # noqa: E731
        src = ex.get('source') or {}
        if eid in ids:
            err('duplicate id')
        ids.add(eid)
        expected = hashlib.sha1(
            f'{src.get("dataset")}:{src.get("row")}'.encode()
        ).hexdigest()[:12]
        if eid != f'{ex.get("channel")}-{expected}':
            err('id is not <channel>-sha1(dataset:row)[:12]')
        if ex.get('channel') not in v['Channel']:
            err('bad channel')
        if ex.get('kind') not in ('scam', 'legitimate'):
            err('bad kind')
        if ex.get('category') is not None and ex.get('category') not in categories:
            err('bad category')
        if ex.get('difficulty') not in v['Difficulty']:
            err('bad difficulty')
        if not set(ex.get('tactics', [])) <= tactics or len(ex.get('tactics', [])) > 4:
            err('tactics must be <=4 Tellio tactics')
        if not set(ex.get('signals', [])) <= set(SIGNALS):
            err('unknown signal')
        if ex.get('kind') == 'legitimate' and ex.get('tactics'):
            err('legitimate example with tactics')
        text = ex.get('text')
        if not isinstance(text, str) or not text.strip() or len(text) > 1200:
            err('text missing or > 1200 chars')
            continue
        if ex.get('textKind') not in ('excerpt', 'pattern'):
            err('bad textKind')
        if 'subject' in ex and (ex['channel'] != 'email' or len(ex['subject']) > 200):
            err('subject only on email, <= 200 chars')
        s = sources.get(src.get('dataset'))
        if not s or s['channel'] != ex.get('channel'):
            err('source dataset not listed in sources for this channel')
        elif s['redistribution'] == 'derived-only' and ex.get('textKind') != 'pattern':
            err('derived-only source must use textKind=pattern')
        if not all(
            isinstance(src.get(k), str) and src[k] for k in ('license', 'row', 'label')
        ):
            err('source needs license, row, label')
        cues = ex.get('cues', [])
        if len(cues) > 6:
            err('more than 6 cues')
        allowed = set(ex.get('tactics', [])) | set(ex.get('signals', []))
        pos = 0
        for c in (
            cues
        ):  # cues are in text order, so each must be found after the previous one ends
            q = c.get('quote', '')
            if c.get('tag') not in allowed:
                err(f'cue tag {c.get("tag")} not in tactics/signals')
            if not 3 <= len(q) <= 120:
                err(f'cue length {len(q)}')
            at = text.find(q, pos)
            if at < 0:
                err(f'cue not an exact, non-overlapping, in-order substring: {q!r}')
            else:
                pos = at + len(q)
    return errors
