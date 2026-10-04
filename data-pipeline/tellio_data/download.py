"""Fetch raw datasets into data-pipeline/raw/ (gitignored) with kagglehub.

Public datasets download anonymously. The SMS competition needs credentials (KAGGLE_USERNAME/KAGGLE_KEY or
~/.kaggle/kaggle.json, read by kagglehub itself) and its rules accepted on kaggle.com.
"""

import os
from pathlib import Path

from . import RAW_DIR
from .sources import SOURCES

CACHE = RAW_DIR / '.kagglehub'


def download(channel: str) -> Path:
    os.environ.setdefault('KAGGLEHUB_CACHE', str(CACHE))
    import kagglehub  # imported late so the cache location above applies

    src = SOURCES[channel]
    if src['kind'] == 'competition':
        return Path(kagglehub.competition_download(src['dataset']))
    return Path(kagglehub.dataset_download(src['dataset']))


def local_dir(channel: str) -> Path | None:
    """Where a source's raw files live: the kagglehub cache, or raw/<slug>/ if dropped in by hand."""
    slug = SOURCES[channel]['dataset']
    candidates = sorted(CACHE.glob(f'datasets/{slug}/versions/*')) + sorted(
        CACHE.glob(f'competitions/{slug}*')
    )
    manual = RAW_DIR / slug.split('/')[-1]
    if manual.is_dir():
        candidates.append(manual)
    return candidates[-1] if candidates else None
