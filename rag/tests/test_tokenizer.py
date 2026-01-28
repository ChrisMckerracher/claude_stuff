"""Tests for BM25 tokenizers."""

from __future__ import annotations

from rag.indexing.tokenizer import (
    CODE_TOKENIZER,
    NLP_TOKENIZER,
    get_tokenizer,
    tokenize,
)


class TestCodeTokenizer:
    def test_camel_case(self) -> None:
        result = tokenize("getUserProfile", CODE_TOKENIZER)
        assert result == ["get", "user", "profile"]

    def test_snake_case(self) -> None:
        result = tokenize("get_user_profile", CODE_TOKENIZER)
        assert result == ["get", "user", "profile"]

    def test_mixed(self) -> None:
        result = tokenize("getUser_profileData", CODE_TOKENIZER)
        assert result == ["get", "user", "profile", "data"]

    def test_stop_words_removed(self) -> None:
        result = tokenize("func getUserProfile return string", CODE_TOKENIZER)
        # "func", "return", "string" are stop words
        assert result == ["get", "user", "profile"]

    def test_punctuation(self) -> None:
        result = tokenize("http.Get(url)", CODE_TOKENIZER)
        assert result == ["http", "get", "url"]

    def test_all_caps(self) -> None:
        # HTTPClient: "HTTP" has no lowercase-to-uppercase transition within it,
        # but "Client" follows. The camelCase regex splits on lowercase->uppercase.
        # "HTTPClient" -> split at "P" to "C" boundary -> ["HTTP", "Client"]
        result = tokenize("HTTPClient", CODE_TOKENIZER)
        assert "client" in result
        # "HTTP" stays as one token since there's no lc->uc boundary inside it
        assert "http" in result

    def test_empty_string(self) -> None:
        result = tokenize("", CODE_TOKENIZER)
        assert result == []

    def test_only_stop_words(self) -> None:
        result = tokenize("func return void", CODE_TOKENIZER)
        assert result == []


class TestNlpTokenizer:
    def test_no_identifier_splitting(self) -> None:
        result = tokenize("getUserProfile", NLP_TOKENIZER)
        assert result == ["getuserprofile"]

    def test_lowercase(self) -> None:
        result = tokenize("The Quick Fox", NLP_TOKENIZER)
        assert result == ["the", "quick", "fox"]

    def test_whitespace_split(self) -> None:
        result = tokenize("deploy the service now", NLP_TOKENIZER)
        assert result == ["deploy", "the", "service", "now"]


class TestGetTokenizer:
    def test_code_logic_routes_to_code(self) -> None:
        assert get_tokenizer("CODE_LOGIC") is CODE_TOKENIZER

    def test_code_deploy_routes_to_code(self) -> None:
        assert get_tokenizer("CODE_DEPLOY") is CODE_TOKENIZER

    def test_code_config_routes_to_code(self) -> None:
        assert get_tokenizer("CODE_CONFIG") is CODE_TOKENIZER

    def test_convo_slack_routes_to_nlp(self) -> None:
        assert get_tokenizer("CONVO_SLACK") is NLP_TOKENIZER

    def test_doc_readme_routes_to_nlp(self) -> None:
        assert get_tokenizer("DOC_README") is NLP_TOKENIZER

    def test_doc_google_routes_to_nlp(self) -> None:
        assert get_tokenizer("DOC_GOOGLE") is NLP_TOKENIZER
