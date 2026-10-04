"""Columns are found by name (UCI uses v1/v2), so another labelled SMS CSV can be
dropped in.
"""

from pathlib import Path

import pandas as pd

from ..sources import SOURCES

SRC = SOURCES['sms']
TEXT_COLS = ('text', 'message', 'sms', 'content', 'body', 'v2')
LABEL_COLS = ('label', 'target', 'class', 'category', 'spam', 'is_spam', 'v1')
SCAM = {'spam', '1', 'scam', 'smishing', 'fraud', 'true'}
LEGIT = {'ham', '0', 'legit', 'legitimate', 'normal', 'false'}


def _col(df, names):
    lower = {c.lower().strip(): c for c in df.columns}
    return next((lower[n] for n in names if n in lower), None)


def read(directory: Path):
    for path in sorted(directory.rglob('*.csv')):
        try:
            df = pd.read_csv(path, dtype=str, keep_default_na=False)
        except UnicodeDecodeError:  # the UCI file is Windows-1252
            df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding='cp1252')
        text_col, label_col = _col(df, TEXT_COLS), _col(df, LABEL_COLS)
        # UCI rows with stray commas spill into these
        spill = [c for c in df.columns if c.startswith('Unnamed')]
        if not text_col or not label_col:
            continue  # e.g. an unlabeled test split or a submission template
        for i, r in df.iterrows():
            label = str(r[label_col]).strip()
            kind = (
                'scam'
                if label.lower() in SCAM
                else 'legitimate'
                if label.lower() in LEGIT
                else None
            )
            text = ' '.join(
                [str(r[text_col]), *(str(r[c]) for c in spill if str(r[c]).strip())]
            ).strip()
            if kind and text:
                yield {
                    'channel': 'sms',
                    'dataset': SRC['dataset'],
                    'row': f'{path.name}:{i}',
                    'label': label,
                    'kind': kind,
                    'text': text,
                    'subject': '',
                }
