"""Tests for core type definitions."""

from __future__ import annotations

from pathlib import Path

import pytest

from rag.config import SOURCE_TYPES
from rag.models.types import (
    CrawlSource,
    SensitivityTier,
    SourceKind,
    SourceTypeDef,
)


class TestSensitivityTier:
    def test_all_values_exist(self) -> None:
        assert SensitivityTier.CLEAN.value == "clean"
        assert SensitivityTier.SENSITIVE.value == "sensitive"
        assert SensitivityTier.MAYBE_SENSITIVE.value == "maybe_sensitive"

    def test_values_are_distinct(self) -> None:
        values = [t.value for t in SensitivityTier]
        assert len(values) == len(set(values)) == 3


class TestSourceKind:
    def test_all_values_exist(self) -> None:
        assert SourceKind.REPO.value == "repo"
        assert SourceKind.SLACK_EXPORT.value == "slack_export"
        assert SourceKind.TRANSCRIPT_DIR.value == "transcript_dir"
        assert SourceKind.RUNBOOK_DIR.value == "runbook_dir"
        assert SourceKind.GOOGLE_DOCS_DIR.value == "gdocs_dir"

    def test_count(self) -> None:
        assert len(SourceKind) == 5


class TestSourceTypeDef:
    def test_frozen(self) -> None:
        std = SourceTypeDef(
            corpus_type="TEST",
            sensitivity=SensitivityTier.CLEAN,
            description="test",
            chunker_kind="ast",
            bm25_tokenizer="code",
        )
        with pytest.raises(AttributeError):
            std.corpus_type = "OTHER"  # type: ignore[misc]

    def test_fields(self) -> None:
        std = SourceTypeDef(
            corpus_type="CODE_LOGIC",
            sensitivity=SensitivityTier.CLEAN,
            description="Source code",
            chunker_kind="ast",
            bm25_tokenizer="code",
        )
        assert std.corpus_type == "CODE_LOGIC"
        assert std.sensitivity == SensitivityTier.CLEAN
        assert std.chunker_kind == "ast"
        assert std.bm25_tokenizer == "code"


class TestSourceTypesRegistry:
    def test_registry_has_10_entries(self) -> None:
        assert len(SOURCE_TYPES) == 10

    def test_all_corpus_types_present(self) -> None:
        expected = {
            "CODE_LOGIC", "CODE_DEPLOY", "CODE_CONFIG",
            "DOC_README", "DOC_RUNBOOK", "DOC_ADR", "DOC_GOOGLE",
            "CONVO_SLACK", "CONVO_TRANSCRIPT", "CONVO_OTHER",
        }
        assert set(SOURCE_TYPES.keys()) == expected

    def test_code_types_are_clean(self) -> None:
        for key in ("CODE_LOGIC", "CODE_DEPLOY", "CODE_CONFIG"):
            assert SOURCE_TYPES[key].sensitivity == SensitivityTier.CLEAN

    def test_doc_readme_is_clean(self) -> None:
        assert SOURCE_TYPES["DOC_README"].sensitivity == SensitivityTier.CLEAN

    def test_doc_google_is_sensitive(self) -> None:
        assert SOURCE_TYPES["DOC_GOOGLE"].sensitivity == SensitivityTier.SENSITIVE

    def test_convo_transcript_is_sensitive(self) -> None:
        assert SOURCE_TYPES["CONVO_TRANSCRIPT"].sensitivity == SensitivityTier.SENSITIVE

    def test_maybe_sensitive_types(self) -> None:
        for key in ("DOC_RUNBOOK", "DOC_ADR", "CONVO_SLACK", "CONVO_OTHER"):
            assert SOURCE_TYPES[key].sensitivity == SensitivityTier.MAYBE_SENSITIVE

    def test_code_types_use_code_tokenizer(self) -> None:
        for key in ("CODE_LOGIC", "CODE_DEPLOY", "CODE_CONFIG"):
            assert SOURCE_TYPES[key].bm25_tokenizer == "code"

    def test_doc_and_convo_types_use_nlp_tokenizer(self) -> None:
        for key in ("DOC_README", "DOC_RUNBOOK", "DOC_ADR", "DOC_GOOGLE",
                     "CONVO_SLACK", "CONVO_TRANSCRIPT", "CONVO_OTHER"):
            assert SOURCE_TYPES[key].bm25_tokenizer == "nlp"

    def test_corpus_type_matches_key(self) -> None:
        for key, std in SOURCE_TYPES.items():
            assert std.corpus_type == key


class TestCrawlSource:
    def test_defaults(self) -> None:
        cs = CrawlSource(
            source_kind=SourceKind.REPO,
            path=Path("/tmp/repo"),
        )
        assert cs.repo_name is None

    def test_with_repo_name(self) -> None:
        cs = CrawlSource(
            source_kind=SourceKind.REPO,
            path=Path("/tmp/repo"),
            repo_name="auth-service",
        )
        assert cs.repo_name == "auth-service"
