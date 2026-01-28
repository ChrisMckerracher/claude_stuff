"""Service dependency graph construction and querying.

Builds a directed graph of service dependencies from chunk metadata,
supporting neighborhood queries and blast radius analysis.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import networkx as nx

from rag.boundary.resolver import ServiceNameResolver


@dataclass
class ServiceNode:
    """A service node in the dependency graph."""

    name: str
    repo_name: str | None = None
    language: str | None = None
    k8s_namespace: str | None = None
    ports: list[int] = field(default_factory=list)
    deploy_chunk_ids: list[str] = field(default_factory=list)


@dataclass
class ServiceEdge:
    """An edge representing a dependency between services."""

    source: str  # calling service
    target: str  # called service
    edge_type: str  # "http", "queue", "db", "unknown"
    evidence_chunk_ids: list[str] = field(default_factory=list)
    url_pattern: str | None = None


class ServiceGraph:
    """Service dependency graph with neighborhood and blast radius queries.

    Built from deployment and code chunks, using the ServiceNameResolver
    to map raw hostnames to known services.
    """

    def __init__(self) -> None:
        """Initialize an empty service graph."""
        self._graph: nx.DiGraph = nx.DiGraph()
        self._nodes: dict[str, ServiceNode] = {}
        self._edges: list[ServiceEdge] = []

    def build_from_chunks(
        self,
        chunks: list[dict[str, Any]],
        resolver: ServiceNameResolver,
    ) -> None:
        """Build graph from accumulated chunk metadata.

        1. Identify services from deploy chunks (corpus_type=CODE_DEPLOY)
        2. Add edges from code chunks' calls_out
        3. Resolve raw hostnames to known service names

        Args:
            chunks: List of chunk dictionaries with metadata.
            resolver: ServiceNameResolver for mapping raw targets.
        """
        # Clear existing graph
        self._graph.clear()
        self._nodes.clear()
        self._edges.clear()

        # Phase 1: Discover services from deploy chunks
        for chunk in chunks:
            if chunk.get("corpus_type") == "CODE_DEPLOY" and chunk.get("service_name"):
                self._add_or_update_node(chunk)

        # Phase 2: Add edges from code chunks' calls_out
        for chunk in chunks:
            calls_out = chunk.get("calls_out")
            service_name = chunk.get("service_name")

            # Handle both lists and numpy arrays (from LanceDB)
            if calls_out is not None and len(calls_out) > 0 and service_name:
                for raw_target in list(calls_out):
                    resolved = resolver.resolve(raw_target, self._nodes)
                    if resolved and resolved != service_name:
                        self._add_edge(service_name, resolved, raw_target, chunk)

    def _add_or_update_node(self, chunk: dict[str, Any]) -> None:
        """Add or update a service node from a deploy chunk.

        Args:
            chunk: Deploy chunk dictionary with service metadata.
        """
        name = chunk["service_name"]

        if name in self._nodes:
            # Update existing node
            node = self._nodes[name]
            if chunk.get("id") not in node.deploy_chunk_ids:
                node.deploy_chunk_ids.append(chunk["id"])
        else:
            # Create new node
            k8s_labels = chunk.get("k8s_labels") or {}
            node = ServiceNode(
                name=name,
                repo_name=chunk.get("repo_name"),
                language=chunk.get("language"),
                k8s_namespace=k8s_labels.get("namespace"),
                ports=[],  # Could extract from k8s Service specs
                deploy_chunk_ids=[chunk.get("id", "")],
            )
            self._nodes[name] = node
            self._graph.add_node(name)

    def _add_edge(
        self,
        source: str,
        target: str,
        raw_target: str,
        chunk: dict[str, Any],
    ) -> None:
        """Add an edge between two services.

        Args:
            source: Source service name (caller).
            target: Target service name (callee).
            raw_target: Raw target string for URL pattern.
            chunk: Evidence chunk.
        """
        # Determine edge type from the raw target
        edge_type = self._infer_edge_type(raw_target)

        # Check if edge already exists
        existing_edge: ServiceEdge | None = None
        for edge in self._edges:
            if edge.source == source and edge.target == target:
                existing_edge = edge
                break

        if existing_edge:
            # Update existing edge with additional evidence
            chunk_id = chunk.get("id", "")
            if chunk_id and chunk_id not in existing_edge.evidence_chunk_ids:
                existing_edge.evidence_chunk_ids.append(chunk_id)
        else:
            # Create new edge
            edge = ServiceEdge(
                source=source,
                target=target,
                edge_type=edge_type,
                evidence_chunk_ids=[chunk.get("id", "")] if chunk.get("id") else [],
                url_pattern=raw_target,
            )
            self._edges.append(edge)
            self._graph.add_edge(source, target, edge_type=edge_type)

    def _infer_edge_type(self, raw_target: str) -> str:
        """Infer the type of dependency from the raw target.

        Args:
            raw_target: Raw hostname/URL string.

        Returns:
            Edge type: "http", "queue", "db", or "unknown".
        """
        lower = raw_target.lower()

        # HTTP patterns
        if "http://" in lower or "https://" in lower or "/api/" in lower:
            return "http"

        # Message queue patterns
        queue_patterns = ["kafka", "rabbitmq", "amqp", "sqs", "pubsub", "nats"]
        if any(p in lower for p in queue_patterns):
            return "queue"

        # Database patterns
        db_patterns = ["postgres", "mysql", "mongo", "redis", "elasticsearch", "db"]
        if any(p in lower for p in db_patterns):
            return "db"

        # gRPC patterns
        if ":50" in lower or "grpc" in lower:
            return "grpc"

        return "http"  # Default to HTTP for service-to-service calls

    def get_neighborhood(
        self,
        service_names: list[str],
        depth: int = 1,
    ) -> dict[str, dict[str, Any]]:
        """Return upstream + downstream neighbors within N hops.

        Args:
            service_names: List of service names to get neighborhoods for.
            depth: Number of hops to traverse (default 1).

        Returns:
            Dictionary mapping service names to their neighborhoods.
        """
        result: dict[str, dict[str, Any]] = {}

        for name in service_names:
            if name not in self._graph:
                continue

            # Get direct neighbors
            upstream = list(self._graph.predecessors(name))
            downstream = list(self._graph.successors(name))

            # Get edges for this service
            edges = self._get_edges_for(name)

            result[name] = {
                "calls": downstream,
                "called_by": upstream,
                "edges": edges,
            }

            # Expand to deeper neighbors if depth > 1
            if depth > 1:
                all_neighbors = set(upstream + downstream)
                for _ in range(depth - 1):
                    new_neighbors: set[str] = set()
                    for neighbor in all_neighbors:
                        if neighbor in self._graph:
                            new_neighbors.update(self._graph.predecessors(neighbor))
                            new_neighbors.update(self._graph.successors(neighbor))
                    all_neighbors.update(new_neighbors)

                result[name]["extended_neighbors"] = list(
                    all_neighbors - {name} - set(upstream) - set(downstream)
                )

        return result

    def _get_edges_for(self, service_name: str) -> list[dict[str, Any]]:
        """Get all edges involving a service.

        Args:
            service_name: The service to get edges for.

        Returns:
            List of edge dictionaries.
        """
        edges: list[dict[str, Any]] = []
        for edge in self._edges:
            if edge.source == service_name or edge.target == service_name:
                edges.append(asdict(edge))
        return edges

    def blast_radius(self, service_name: str) -> set[str]:
        """Calculate the blast radius of a service failure.

        Returns all services that depend on this service (transitively).
        If this service goes down, these services are affected.

        Args:
            service_name: The service to analyze.

        Returns:
            Set of service names that would be affected.
        """
        if service_name not in self._graph:
            return set()

        # Ancestors are services that call this service (directly or transitively)
        ancestors: set[str] = nx.ancestors(self._graph, service_name)
        return ancestors

    def downstream_dependencies(self, service_name: str) -> set[str]:
        """Get all services this service depends on (transitively).

        Args:
            service_name: The service to analyze.

        Returns:
            Set of service names this service depends on.
        """
        if service_name not in self._graph:
            return set()

        # Descendants are services this service calls (directly or transitively)
        descendants: set[str] = nx.descendants(self._graph, service_name)
        return descendants

    def save(self, path: str) -> None:
        """Save the graph to a JSON file.

        Args:
            path: Path to the output JSON file.
        """
        data = {
            "nodes": {k: asdict(v) for k, v in self._nodes.items()},
            "edges": [asdict(e) for e in self._edges],
        }
        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(data, f, indent=2)

    def load(self, path: str) -> None:
        """Load the graph from a JSON file.

        Args:
            path: Path to the input JSON file.
        """
        with open(path) as f:
            data = json.load(f)

        # Clear existing state
        self._graph.clear()
        self._nodes.clear()
        self._edges.clear()

        # Rebuild nodes
        for name, node_data in data.get("nodes", {}).items():
            node = ServiceNode(
                name=node_data["name"],
                repo_name=node_data.get("repo_name"),
                language=node_data.get("language"),
                k8s_namespace=node_data.get("k8s_namespace"),
                ports=node_data.get("ports", []),
                deploy_chunk_ids=node_data.get("deploy_chunk_ids", []),
            )
            self._nodes[name] = node
            self._graph.add_node(name)

        # Rebuild edges
        for edge_data in data.get("edges", []):
            edge = ServiceEdge(
                source=edge_data["source"],
                target=edge_data["target"],
                edge_type=edge_data["edge_type"],
                evidence_chunk_ids=edge_data.get("evidence_chunk_ids", []),
                url_pattern=edge_data.get("url_pattern"),
            )
            self._edges.append(edge)
            self._graph.add_edge(
                edge.source,
                edge.target,
                edge_type=edge.edge_type,
            )

    @property
    def node_count(self) -> int:
        """Return the number of service nodes."""
        return len(self._nodes)

    @property
    def edge_count(self) -> int:
        """Return the number of edges."""
        return len(self._edges)

    @property
    def nodes(self) -> dict[str, ServiceNode]:
        """Return all service nodes."""
        return self._nodes.copy()
