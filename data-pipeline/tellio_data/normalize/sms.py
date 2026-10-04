"""The competition's schema could not be inspected (login required), so columns are found by name."""
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
        df = pd.read_csv(path, encoding_errors='replace', dtype=str, keep_default_na=False)
        text_col, label_col = _col(df, TEXT_COLS), _col(df, LABEL_COLS)
        if not text_col or not label_col:
            continue  # e.g. an unlabeled test split or a submission template
        for i, r in df.iterrows():
            label = str(r[label_col]).strip()
            kind = 'scam' if label.lower() in SCAM else 'legitimate' if label.lower() in LEGIT else None
            if kind and str(r[text_col]).strip():
                yield {'channel': 'sms', 'dataset': SRC['dataset'], 'row': f'{path.name}:{i}', 'label': label,
                       'kind': kind, 'text': str(r[text_col]), 'subject': ''}
