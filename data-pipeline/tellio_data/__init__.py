"""Offline pipeline: Kaggle scam datasets -> backend/fixtures/scam-library.json."""
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent
RAW_DIR = PIPELINE_DIR / 'raw'
OUTPUT_PATH = REPO_DIR / 'backend' / 'fixtures' / 'scam-library.json'
SEED = 1337
