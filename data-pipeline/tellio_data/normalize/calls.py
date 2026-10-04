import re
from pathlib import Path

from ..sources import SOURCES

SRC = SOURCES['call']
FILES = {'English_Scam.txt': ('scam', 'scam'), 'English_NonScam.txt': ('non-scam', 'legitimate')}


def read(directory: Path):
    for name, (label, kind) in FILES.items():
        path = directory / name
        if not path.exists():
            continue
        # One transcript per paragraph; the scam file numbers them ("12.\t...").
        paragraphs = re.split(r'\n\s*\n', path.read_text(encoding='utf-8', errors='replace').replace('\r', ''))
        n = 0
        for para in paragraphs:
            text = re.sub(r'^\s*\d+\.\s*', '', para).strip()
            if not text:
                continue
            n += 1
            yield {'channel': 'call', 'dataset': SRC['dataset'], 'row': f'{name}:{n}', 'label': label,
                   'kind': kind, 'text': text, 'subject': ''}
