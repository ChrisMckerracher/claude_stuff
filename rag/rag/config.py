"""Source type registry and pipeline constants.

This table IS the architecture. Adding a new data source means adding one
row. The pipeline reads this to route crawling, scrubbing, chunking, and
tokenization.
"""

from __future__ import annotations

from rag.models.types import SensitivityTier, SourceTypeDef

SOURCE_TYPES: dict[str, SourceTypeDef] = {
    # -- Code (CLEAN) --
    "CODE_LOGIC": SourceTypeDef(
        corpus_type="CODE_LOGIC",
        sensitivity=SensitivityTier.CLEAN,
        description="Source code: functions, classes, methods",
        chunker_kind="ast",
        bm25_tokenizer="code",
    ),
    "CODE_DEPLOY": SourceTypeDef(
        corpus_type="CODE_DEPLOY",
        sensitivity=SensitivityTier.CLEAN,
        description="Kubernetes YAMLs, Dockerfiles, Helm charts",
        chunker_kind="yaml",
        bm25_tokenizer="code",
    ),
    "CODE_CONFIG": SourceTypeDef(
        corpus_type="CODE_CONFIG",
        sensitivity=SensitivityTier.CLEAN,
        description="Config files: .env templates, go.mod, package.json",
        chunker_kind="yaml",
        bm25_tokenizer="code",
    ),
    # -- Documentation (CLEAN to MAYBE_SENSITIVE) --
    "DOC_README": SourceTypeDef(
        corpus_type="DOC_README",
        sensitivity=SensitivityTier.CLEAN,
        description="In-repo markdown docs and READMEs",
        chunker_kind="markdown",
        bm25_tokenizer="nlp",
    ),
    "DOC_RUNBOOK": SourceTypeDef(
        corpus_type="DOC_RUNBOOK",
        sensitivity=SensitivityTier.MAYBE_SENSITIVE,
        description="Operational runbooks (may reference people/incidents)",
        chunker_kind="markdown",
        bm25_tokenizer="nlp",
    ),
    "DOC_ADR": SourceTypeDef(
        corpus_type="DOC_ADR",
        sensitivity=SensitivityTier.MAYBE_SENSITIVE,
        description="Architecture decision records",
        chunker_kind="markdown",
        bm25_tokenizer="nlp",
    ),
    "DOC_GOOGLE": SourceTypeDef(
        corpus_type="DOC_GOOGLE",
        sensitivity=SensitivityTier.SENSITIVE,
        description="Google Docs exports (design docs, specs, meeting notes)",
        chunker_kind="markdown",
        bm25_tokenizer="nlp",
    ),
    # -- Conversations (MAYBE_SENSITIVE to SENSITIVE) --
    "CONVO_SLACK": SourceTypeDef(
        corpus_type="CONVO_SLACK",
        sensitivity=SensitivityTier.MAYBE_SENSITIVE,
        description="Slack threads (may mention people, incidents)",
        chunker_kind="thread",
        bm25_tokenizer="nlp",
    ),
    "CONVO_TRANSCRIPT": SourceTypeDef(
        corpus_type="CONVO_TRANSCRIPT",
        sensitivity=SensitivityTier.SENSITIVE,
        description="Meeting transcripts, call recordings",
        chunker_kind="thread",
        bm25_tokenizer="nlp",
    ),
    "CONVO_OTHER": SourceTypeDef(
        corpus_type="CONVO_OTHER",
        sensitivity=SensitivityTier.MAYBE_SENSITIVE,
        description="Other conversation-like content",
        chunker_kind="sliding",
        bm25_tokenizer="nlp",
    ),
}
