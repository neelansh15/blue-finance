"""Bundled generated defaults; callers cannot promote these to calibrated evidence."""
import json
from pathlib import Path

DECLARED = json.loads((Path(__file__).parent / 'generated/blue_parameters.json').read_text())
BLUE_DEFAULTS = DECLARED['blue']
