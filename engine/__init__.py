"""VersionLens comparison engine.

Deterministic where possible. AI where useful. Source-backed everywhere.
Human-reviewed for final judgment.
"""

from .changes import Category, Change, ChangeType, Importance, ReviewStatus
from .compare import DISCLAIMER, ComparisonResult, Stage, compare_documents
from .model import ENGINE_VERSION, EXTRACTION_VERSION, Citation, Document
from .semantic import SemanticAnalyzer

__all__ = [
    "Category",
    "Change",
    "ChangeType",
    "Citation",
    "ComparisonResult",
    "DISCLAIMER",
    "Document",
    "ENGINE_VERSION",
    "EXTRACTION_VERSION",
    "Importance",
    "ReviewStatus",
    "SemanticAnalyzer",
    "Stage",
    "compare_documents",
]
