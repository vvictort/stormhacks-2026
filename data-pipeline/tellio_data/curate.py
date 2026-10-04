"""Dedupe + diversity sampling. Deterministic: per-group RNGs seeded from SEED and the group key."""
import random
import re
from collections import defaultdict

from . import SEED

# Max examples per (channel, kind, category); None = uncategorised. Scam text is what Tellio scenarios reuse.
SCAM_QUOTA = {'email': 70, 'sms': 50, 'call': 45}
SCAM_NULL_QUOTA = {'email': 40, 'sms': 25, 'call': 30}
LEGIT_QUOTA = {'email': 15, 'sms': 15, 'call': 12}
LEGIT_NULL_QUOTA = {'email': 45, 'sms': 30, 'call': 20}
NEAR_DUP = 0.5


def norm(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


def shingles(text: str, n: int = 4) -> set:
    words = norm(text).split()
    return {' '.join(words[i:i + n]) for i in range(max(1, len(words) - n + 1))}


def jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def readable(ex: dict) -> bool:
    text = ex['text']
    letters = [c for c in text if c.isalpha()]
    shouting = sum(c.isupper() for c in letters) > 0.3 * len(letters)
    return 150 <= len(text) <= 1100 and not shouting and text.count('[') <= 6


def tier(ex: dict) -> int:
    """0 = demo-ready (readable, >=2 cues), 1 = fine, 2 = filler."""
    if ex['kind'] == 'legitimate':
        return 0 if readable(ex) or ex['textKind'] == 'pattern' else 2
    good_text = readable(ex) or ex['textKind'] == 'pattern'
    return 0 if good_text and len(ex['cues']) >= 2 else 1 if good_text or len(ex['cues']) >= 2 else 2


def dedupe(examples: list[dict]) -> list[dict]:
    seen, out = set(), []
    for ex in sorted(examples, key=lambda e: e['id']):
        key = (ex['channel'], norm(ex['text']))
        if key not in seen:
            seen.add(key)
            out.append(ex)
    return out


def select(examples: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for ex in dedupe(examples):
        if ex['kind'] == 'scam' and not ex['tactics']:
            continue  # nothing to teach
        groups[(ex['channel'], ex['kind'], ex['category'] or '')].append(ex)

    chosen, kept_shingles = [], defaultdict(list)
    for key in sorted(groups):
        channel, kind, category = key
        quota = (SCAM_QUOTA if kind == 'scam' else LEGIT_QUOTA) if category else \
                (SCAM_NULL_QUOTA if kind == 'scam' else LEGIT_NULL_QUOTA)
        rng = random.Random(f'{SEED}:{key}')
        pool = groups[key]
        rng.shuffle(pool)
        pool.sort(key=tier)  # stable: shuffled order within a tier
        # Round-robin over lead tactic so one trick doesn't crowd out the rest.
        lanes = defaultdict(list)
        for ex in pool:
            if tier(ex) < 2:
                lanes[(tier(ex), ex['tactics'][0] if ex['tactics'] else '')].append(ex)
        picked = 0
        for t in (0, 1):
            queues = [lanes[k] for k in sorted(lanes) if k[0] == t]
            while picked < quota[channel] and any(queues):
                for q in queues:
                    if not q or picked >= quota[channel]:
                        continue
                    ex = q.pop(0)
                    sh = shingles(ex['text'])
                    # ponytail: O(n^2) near-dup scan per channel; fine for ~1k picks, MinHash if quotas grow 10x.
                    # Pattern summaries are short and formulaic by design: exact dedupe only.
                    if ex['textKind'] == 'excerpt' and any(jaccard(sh, o) >= NEAR_DUP for o in kept_shingles[channel]):
                        continue
                    kept_shingles[channel].append(sh)
                    chosen.append(ex)
                    picked += 1
    return sorted(chosen, key=lambda e: (e['channel'], e['kind'], e['category'] or '~', e['id']))
