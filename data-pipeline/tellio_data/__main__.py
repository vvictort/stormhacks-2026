"""python -m tellio_data {download,build,stats} [--channel email|sms|call]"""

import argparse
import json
from collections import Counter

from . import OUTPUT_PATH
from .sources import SOURCES
from .vocabulary import load


def stats(doc: dict) -> None:
    from .validate import validate

    ex = doc['examples']
    errors = validate(doc)
    print(
        f'{OUTPUT_PATH.relative_to(OUTPUT_PATH.parents[2])}: {len(ex)} examples, '
        f'{OUTPUT_PATH.stat().st_size / 1024:.0f} KB, validation: {"OK" if not errors else errors[:5]}'
    )
    for s in doc['sources']:
        print(
            f'  source {s["channel"]:5} {s["dataset"]} [{s["license"]}] {s["redistribution"]}'
        )
    cats = list(load()['ScamCategory']) + [None]
    channels = sorted({e['channel'] for e in ex})
    for kind in ('scam', 'legitimate'):
        print(f'\n{kind} by channel x category (>=2 cues in brackets)')
        print(f'  {"category":18}' + ''.join(f'{c:>12}' for c in channels))
        for cat in cats:
            row = [
                [
                    e
                    for e in ex
                    if e['kind'] == kind and e['channel'] == c and e['category'] == cat
                ]
                for c in channels
            ]
            cells = ''.join(
                f'{len(r):>5} [{sum(len(e["cues"]) >= 2 for e in r):>3}] ' for r in row
            )
            print(f'  {str(cat):18}{cells}')
    for field in ('tactics', 'signals'):
        print(
            f'\n{field}:', dict(Counter(t for e in ex for t in e[field]).most_common())
        )
    print(
        '\ncues per scam example:',
        dict(
            sorted(Counter(len(e['cues']) for e in ex if e['kind'] == 'scam').items())
        ),
    )
    print('difficulty:', dict(Counter(e['difficulty'] for e in ex)))
    print('textKind:', dict(Counter((e['channel'], e['textKind']) for e in ex)))


def main() -> None:
    parser = argparse.ArgumentParser(prog='python -m tellio_data')
    parser.add_argument('command', choices=('download', 'build', 'stats'))
    parser.add_argument(
        '--channel', choices=tuple(SOURCES), help='limit to one channel (default: all)'
    )
    args = parser.parse_args()
    channels = (args.channel,) if args.channel else tuple(SOURCES)

    if args.command == 'download':
        from .download import download

        failed = False
        for channel in channels:
            try:
                print(f'{channel}: {download(channel)}')
            except Exception as e:  # noqa: BLE001 - report every source, then fail
                failed = True
                print(
                    f'{channel}: FAILED ({type(e).__name__}: {e}). '
                    'Competition data needs KAGGLE_USERNAME/KAGGLE_KEY (or ~/.kaggle/kaggle.json) '
                    'and the competition rules accepted on kaggle.com.'
                )
        raise SystemExit(1 if failed else 0)
    if args.command == 'build':
        from .build import build

        doc = build(channels)
        print(json.dumps(doc.pop('_report'), indent=1))
        stats(doc)
    else:
        stats(json.loads(OUTPUT_PATH.read_text(encoding='utf-8')))


if __name__ == '__main__':
    main()
