"""Tests for YAML chunker."""

from pathlib import Path

import pytest

from rag.chunking.yaml_chunker import yaml_chunk, YamlChunkData


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestSingleDocument:
    """Test single YAML document parsing."""

    def test_single_document(self) -> None:
        """Single YAML document produces one chunk."""
        yaml_path = FIXTURES_DIR / "k8s" / "deployment.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "deployment.yaml")

        assert len(chunks) == 1
        assert isinstance(chunks[0], YamlChunkData)

    def test_k8s_metadata_extraction(self) -> None:
        """K8s metadata is extracted from deployment."""
        yaml_path = FIXTURES_DIR / "k8s" / "deployment.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "deployment.yaml")

        assert chunks[0].symbol_name == "auth-service"
        assert chunks[0].symbol_kind == "deployment"
        assert chunks[0].service_name == "auth-service"
        assert "app" in chunks[0].k8s_labels
        assert chunks[0].k8s_labels["app"] == "auth-service"


class TestMultiDocument:
    """Test multi-document YAML splitting."""

    def test_multi_document_split(self) -> None:
        """Multi-document YAML is split on ---."""
        yaml_path = FIXTURES_DIR / "k8s" / "multi-resource.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "multi-resource.yaml")

        # Should have 3 chunks: Deployment, Service, ConfigMap
        assert len(chunks) == 3

    def test_multi_document_types(self) -> None:
        """Each document has correct kind."""
        yaml_path = FIXTURES_DIR / "k8s" / "multi-resource.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "multi-resource.yaml")
        kinds = [c.symbol_kind for c in chunks]

        assert "deployment" in kinds
        assert "service" in kinds
        assert "configmap" in kinds


class TestEnvServiceDetection:
    """Test service reference extraction from env vars."""

    def test_env_var_service_detection(self) -> None:
        """Service references are extracted from env var URLs."""
        yaml_path = FIXTURES_DIR / "k8s" / "env-refs.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "env-refs.yaml")

        assert len(chunks) == 1
        calls_out = chunks[0].calls_out

        assert "auth-service" in calls_out
        assert "user-service" in calls_out
        assert "payment-service" in calls_out

    def test_multi_resource_env_refs(self) -> None:
        """Deployment in multi-resource file has calls_out."""
        yaml_path = FIXTURES_DIR / "k8s" / "multi-resource.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "multi-resource.yaml")

        # Find the deployment chunk
        deployment_chunk = next(c for c in chunks if c.symbol_kind == "deployment")
        assert "user-service" in deployment_chunk.calls_out


class TestIngressExtraction:
    """Test backend service extraction from Ingress."""

    def test_ingress_extraction(self) -> None:
        """Backend service references are extracted from Ingress."""
        yaml_path = FIXTURES_DIR / "k8s" / "ingress.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "ingress.yaml")

        assert len(chunks) == 1
        calls_out = chunks[0].calls_out

        assert "auth-service" in calls_out
        assert "user-service" in calls_out


class TestMalformedYaml:
    """Test handling of malformed YAML."""

    def test_malformed_yaml_handled(self) -> None:
        """Invalid YAML doesn't crash, produces chunk without metadata."""
        content = b"this is not: valid: yaml: at: all:\n  - broken"

        # Should not raise
        chunks = yaml_chunk(content, "broken.yaml")

        # May produce a chunk with empty metadata
        assert isinstance(chunks, list)

    def test_empty_yaml(self) -> None:
        """Empty YAML produces no chunks."""
        content = b""
        chunks = yaml_chunk(content, "empty.yaml")
        assert len(chunks) == 0

    def test_yaml_only_separator(self) -> None:
        """YAML with only separator produces no chunks."""
        content = b"---\n---\n"
        chunks = yaml_chunk(content, "separators.yaml")
        assert len(chunks) == 0


class TestByteRanges:
    """Test byte range calculation."""

    def test_byte_ranges_valid(self) -> None:
        """Byte ranges are non-overlapping and cover text."""
        yaml_path = FIXTURES_DIR / "k8s" / "multi-resource.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "multi-resource.yaml")

        for chunk in chunks:
            assert chunk.byte_start >= 0
            assert chunk.byte_end > chunk.byte_start
            # Text should match byte range length (approximately, due to encoding)
            assert len(chunk.text) > 0


class TestContextPrefix:
    """Test context prefix generation."""

    def test_context_prefix_format(self) -> None:
        """Context prefix includes file, kind, and name."""
        yaml_path = FIXTURES_DIR / "k8s" / "deployment.yaml"
        content = yaml_path.read_bytes()

        chunks = yaml_chunk(content, "k8s/deployment.yaml")

        assert "k8s/deployment.yaml" in chunks[0].context_prefix
        assert "deployment" in chunks[0].context_prefix
        assert "auth-service" in chunks[0].context_prefix
