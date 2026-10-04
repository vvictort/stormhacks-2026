from pathlib import Path

import pandas as pd

from ..sources import SOURCES

SRC = SOURCES['email']


def read(directory: Path, files=SRC['files']):
    for name in files:
        path = directory / name
        if not path.exists():
            continue
        df = pd.read_csv(
            path, encoding_errors='replace', dtype=str, keep_default_na=False
        )
        for i, r in enumerate(df.itertuples(index=False)):
            label = (getattr(r, 'label', '') or '').strip()
            body = getattr(r, 'body', '') or ''
            if label not in ('0', '1') or not body.strip():
                continue  # malformed or empty row
            yield {
                'channel': 'email',
                'dataset': SRC['dataset'],
                'row': f'{name}:{i}',
                'label': label,
                'kind': 'scam' if label == '1' else 'legitimate',
                'text': body,
                'subject': getattr(r, 'subject', '') or '',
            }
