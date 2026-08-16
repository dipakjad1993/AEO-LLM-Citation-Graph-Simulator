"""
Shared brand pattern utilities for the AEO analytics engine.
Centralizes flex-separator brand matching so every module uses
identical, correct regexes.
"""

import re
from typing import Dict

__all__ = ['build_flex_pattern', 'build_brand_patterns']


def build_flex_pattern(name: str) -> str:
    """Build a regex matching a brand name with flexible separators.

    Splits the name into words on spaces/underscores/hyphens and joins them
    with ``[_ -]?`` so that ``Northwind Cloud`` matches ``Northwind Cloud``,
    ``Northwind-Cloud``, ``Northwind_Cloud``, ``Northwind  Cloud``, etc.
    """
    parts = [p for p in re.split(r'[_ -]+', name.strip()) if p]
    if not parts:
        return re.escape(name)
    return r'\b' + r'[_ -]?'.join(re.escape(p) for p in parts) + r'\b'


def build_brand_patterns(entity_config: Dict) -> Dict[str, str]:
    """Build brand regex pattern strings from the entity configuration."""
    patterns = {}
    your_brand = entity_config.get('your_brand', {}) or {}
    if your_brand.get('primary_name'):
        name = your_brand['primary_name']
        patterns[name] = build_flex_pattern(name)
    for comp in entity_config.get('competitors', []) or []:
        if comp.get('primary_name'):
            name = comp['primary_name']
            patterns[name] = build_flex_pattern(name)
    return patterns
