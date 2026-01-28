"""Tests for ServiceGraph."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rag.boundary.graph import ServiceGraph
from rag.boundary.resolver import ServiceNameResolver


@pytest.fixture
def resolver() -> ServiceNameResolver:
    """Default resolver for graph building."""
    return ServiceNameResolver()


def make_deploy_chunk_dict(
    chunk_id: str,
    service_name: str,
    repo_name: str = "test-repo",
) -> dict:
    """Create a deploy chunk dictionary for testing."""
    return {
        "id": chunk_id,
        "corpus_type": "CODE_DEPLOY",
        "service_name": service_name,
        "repo_name": repo_name,
        "text": f"kind: Deployment\nname: {service_name}",
        "k8s_labels": {"app": service_name, "namespace": "default"},
    }


def make_code_chunk_dict(
    chunk_id: str,
    service_name: str,
    calls_out: list[str] | None = None,
) -> dict:
    """Create a code chunk dictionary for testing."""
    return {
        "id": chunk_id,
        "corpus_type": "CODE_LOGIC",
        "service_name": service_name,
        "calls_out": calls_out or [],
        "text": f"func Handler() {{ /* calls {calls_out} */ }}",
    }


class TestGraphBuilding:
    """Tests for graph construction from chunks."""

    def test_build_discovers_services(self, resolver: ServiceNameResolver) -> None:
        """Deploy chunks with service_name -> nodes in graph."""
        graph = ServiceGraph()

        chunks = [
            make_deploy_chunk_dict("d1", "auth-service"),
            make_deploy_chunk_dict("d2", "user-service"),
            make_deploy_chunk_dict("d3", "payment-service"),
        ]

        graph.build_from_chunks(chunks, resolver)

        assert graph.node_count == 3
        assert "auth-service" in graph.nodes
        assert "user-service" in graph.nodes
        assert "payment-service" in graph.nodes

    def test_build_creates_edges(self, resolver: ServiceNameResolver) -> None:
        """Code chunks with calls_out -> edges between services."""
        graph = ServiceGraph()

        chunks = [
            # Services
            make_deploy_chunk_dict("d1", "auth-service"),
            make_deploy_chunk_dict("d2", "user-service"),
            # Code that calls out
            make_code_chunk_dict(
                "c1",
                "auth-service",
                calls_out=["http://user-service:8080/api/users"],
            ),
        ]

        graph.build_from_chunks(chunks, resolver)

        assert graph.edge_count == 1

    def test_multiple_calls_create_single_edge(self, resolver: ServiceNameResolver) -> None:
        """Multiple calls to same service create one edge with multiple evidence."""
        graph = ServiceGraph()

        chunks = [
            make_deploy_chunk_dict("d1", "auth-service"),
            make_deploy_chunk_dict("d2", "user-service"),
            make_code_chunk_dict("c1", "auth-service", calls_out=["user-service"]),
            make_code_chunk_dict("c2", "auth-service", calls_out=["user-service"]),
        ]

        graph.build_from_chunks(chunks, resolver)

        assert graph.edge_count == 1

    def test_self_loops_ignored(self, resolver: ServiceNameResolver) -> None:
        """Service calling itself doesn't create an edge."""
        graph = ServiceGraph()

        chunks = [
            make_deploy_chunk_dict("d1", "auth-service"),
            make_code_chunk_dict("c1", "auth-service", calls_out=["auth-service"]),
        ]

        graph.build_from_chunks(chunks, resolver)

        assert graph.edge_count == 0


class TestNeighborhood:
    """Tests for neighborhood queries."""

    @pytest.fixture
    def chain_graph(self, resolver: ServiceNameResolver) -> ServiceGraph:
        """Graph with A -> B -> C chain."""
        graph = ServiceGraph()
        chunks = [
            make_deploy_chunk_dict("d1", "service-a"),
            make_deploy_chunk_dict("d2", "service-b"),
            make_deploy_chunk_dict("d3", "service-c"),
            make_code_chunk_dict("c1", "service-a", calls_out=["service-b"]),
            make_code_chunk_dict("c2", "service-b", calls_out=["service-c"]),
        ]
        graph.build_from_chunks(chunks, resolver)
        return graph

    def test_get_neighborhood(self, chain_graph: ServiceGraph) -> None:
        """Neighbors of a service include upstream + downstream."""
        result = chain_graph.get_neighborhood(["service-b"])

        assert "service-b" in result
        assert "service-a" in result["service-b"]["called_by"]
        assert "service-c" in result["service-b"]["calls"]

    def test_neighborhood_edges(self, chain_graph: ServiceGraph) -> None:
        """Neighborhood includes edge information."""
        result = chain_graph.get_neighborhood(["service-b"])

        edges = result["service-b"]["edges"]
        assert len(edges) == 2  # One incoming, one outgoing

    def test_unknown_service_neighborhood(self, chain_graph: ServiceGraph) -> None:
        """Querying unknown service -> empty result."""
        result = chain_graph.get_neighborhood(["unknown-service"])

        assert result == {}

    def test_multiple_services_neighborhood(self, chain_graph: ServiceGraph) -> None:
        """Can query multiple services at once."""
        result = chain_graph.get_neighborhood(["service-a", "service-c"])

        assert "service-a" in result
        assert "service-c" in result


class TestBlastRadius:
    """Tests for blast radius analysis."""

    @pytest.fixture
    def diamond_graph(self, resolver: ServiceNameResolver) -> ServiceGraph:
        """Graph with diamond pattern: A,B -> C -> D."""
        graph = ServiceGraph()
        chunks = [
            make_deploy_chunk_dict("d1", "service-a"),
            make_deploy_chunk_dict("d2", "service-b"),
            make_deploy_chunk_dict("d3", "service-c"),
            make_deploy_chunk_dict("d4", "service-d"),
            make_code_chunk_dict("c1", "service-a", calls_out=["service-c"]),
            make_code_chunk_dict("c2", "service-b", calls_out=["service-c"]),
            make_code_chunk_dict("c3", "service-c", calls_out=["service-d"]),
        ]
        graph.build_from_chunks(chunks, resolver)
        return graph

    def test_blast_radius(self, diamond_graph: ServiceGraph) -> None:
        """Blast radius identifies all dependents transitively."""
        # If service-c goes down, who is affected?
        affected = diamond_graph.blast_radius("service-c")

        # service-a and service-b depend on service-c
        assert "service-a" in affected
        assert "service-b" in affected
        # service-d is downstream, not affected by c going down
        assert "service-d" not in affected

    def test_blast_radius_leaf_service(self, diamond_graph: ServiceGraph) -> None:
        """Leaf service (no dependents) has empty blast radius."""
        affected = diamond_graph.blast_radius("service-d")

        # Everyone depends on service-d transitively
        assert "service-a" in affected
        assert "service-b" in affected
        assert "service-c" in affected

    def test_blast_radius_unknown_service(self, diamond_graph: ServiceGraph) -> None:
        """Unknown service returns empty set."""
        affected = diamond_graph.blast_radius("unknown")
        assert affected == set()


class TestPersistence:
    """Tests for save/load functionality."""

    def test_save_load_roundtrip(
        self,
        tmp_path: Path,
        resolver: ServiceNameResolver,
    ) -> None:
        """Save JSON -> load -> same graph structure."""
        # Build graph
        graph1 = ServiceGraph()
        chunks = [
            make_deploy_chunk_dict("d1", "auth-service"),
            make_deploy_chunk_dict("d2", "user-service"),
            make_code_chunk_dict("c1", "auth-service", calls_out=["user-service"]),
        ]
        graph1.build_from_chunks(chunks, resolver)

        # Save
        save_path = tmp_path / "graph.json"
        graph1.save(str(save_path))

        # Load
        graph2 = ServiceGraph()
        graph2.load(str(save_path))

        assert graph2.node_count == graph1.node_count
        assert graph2.edge_count == graph1.edge_count
        assert "auth-service" in graph2.nodes
        assert "user-service" in graph2.nodes

    def test_save_creates_valid_json(
        self,
        tmp_path: Path,
        resolver: ServiceNameResolver,
    ) -> None:
        """Saved file is valid JSON with expected structure."""
        graph = ServiceGraph()
        chunks = [make_deploy_chunk_dict("d1", "test-service")]
        graph.build_from_chunks(chunks, resolver)

        save_path = tmp_path / "graph.json"
        graph.save(str(save_path))

        with open(save_path) as f:
            data = json.load(f)

        assert "nodes" in data
        assert "edges" in data
        assert "test-service" in data["nodes"]

    def test_save_creates_parent_directories(
        self,
        tmp_path: Path,
        resolver: ServiceNameResolver,
    ) -> None:
        """Save creates nested directories if needed."""
        graph = ServiceGraph()
        chunks = [make_deploy_chunk_dict("d1", "test-service")]
        graph.build_from_chunks(chunks, resolver)

        save_path = tmp_path / "nested" / "deep" / "graph.json"
        graph.save(str(save_path))

        assert save_path.exists()


class TestEmptyGraph:
    """Tests for empty graph behavior."""

    def test_empty_graph_operations(self) -> None:
        """Operations on empty graph don't crash."""
        graph = ServiceGraph()

        assert graph.node_count == 0
        assert graph.edge_count == 0
        assert graph.get_neighborhood(["any"]) == {}
        assert graph.blast_radius("any") == set()

    def test_build_with_no_deploy_chunks(self, resolver: ServiceNameResolver) -> None:
        """Building with only code chunks (no services) works."""
        graph = ServiceGraph()
        chunks = [
            make_code_chunk_dict("c1", "orphan-service", calls_out=["unknown"]),
        ]
        graph.build_from_chunks(chunks, resolver)

        # No services discovered from deploy chunks
        assert graph.node_count == 0


class TestEdgeTypes:
    """Tests for edge type inference."""

    def test_http_edge_type(self, resolver: ServiceNameResolver) -> None:
        """HTTP URLs produce 'http' edge type."""
        graph = ServiceGraph()
        chunks = [
            make_deploy_chunk_dict("d1", "service-a"),
            make_deploy_chunk_dict("d2", "service-b"),
            make_code_chunk_dict(
                "c1",
                "service-a",
                calls_out=["http://service-b:8080/api"],
            ),
        ]
        graph.build_from_chunks(chunks, resolver)

        # Check edge type
        edges = graph._get_edges_for("service-a")
        assert any(e["edge_type"] == "http" for e in edges)

    def test_queue_edge_type(self, resolver: ServiceNameResolver) -> None:
        """Queue-like targets produce 'queue' edge type."""
        graph = ServiceGraph()
        chunks = [
            make_deploy_chunk_dict("d1", "producer"),
            make_deploy_chunk_dict("d2", "kafka-service"),
            make_code_chunk_dict(
                "c1",
                "producer",
                calls_out=["kafka://kafka-service:9092"],
            ),
        ]
        graph.build_from_chunks(chunks, resolver)

        edges = graph._get_edges_for("producer")
        assert any(e["edge_type"] == "queue" for e in edges)
