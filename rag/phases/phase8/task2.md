# Task 8.2: Graphiti Client Implementation

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement GraphitiStore that adapts Graphiti to our GraphStore protocol.

## File

`rag/graphiti/client.py`

## Implementation

```python
import os
from datetime import datetime
from typing import Any, Literal
from contextlib import asynccontextmanager
from graphiti_core import Graphiti
from graphiti_core.nodes import EntityNode
from rag.core.protocols import GraphStore
from rag.core.schema import Entity, EntityType, Relationship, RelationType, EntityID, RelationshipID
from rag.core.errors import StorageError, EntityNotFoundError, LLMError

class GraphitiStore:
    """Graphiti implementation of GraphStore protocol.

    Requires Neo4j and LLM API to function.
    """

    def __init__(
        self,
        neo4j_uri: str,
        neo4j_user: str,
        neo4j_password: str,
        llm_client: Any = None,
    ):
        """Initialize Graphiti connection.

        Args:
            neo4j_uri: Neo4j connection URI
            neo4j_user: Neo4j username
            neo4j_password: Neo4j password
            llm_client: Optional LLM client (defaults to Anthropic)
        """
        self._graphiti = Graphiti(
            neo4j_uri=neo4j_uri,
            neo4j_user=neo4j_user,
            neo4j_password=neo4j_password,
        )

        if llm_client:
            self._graphiti.llm_client = llm_client
        else:
            # Default to Anthropic if available
            self._setup_default_llm()

    @classmethod
    def from_env(cls) -> "GraphitiStore":
        """Create from environment variables.

        Requires: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
        """
        uri = os.environ.get("NEO4J_URI")
        user = os.environ.get("NEO4J_USER")
        password = os.environ.get("NEO4J_PASSWORD")

        if not all([uri, user, password]):
            raise ValueError(
                "Missing environment variables. "
                "Required: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD"
            )

        return cls(uri, user, password)

    @asynccontextmanager
    async def connect(self):
        """Context manager for connection lifecycle."""
        try:
            yield self
        finally:
            await self.close()

    async def close(self):
        """Close Graphiti connection."""
        await self._graphiti.close()

    def _setup_default_llm(self):
        """Set up default LLM client."""
        try:
            import anthropic
            self._graphiti.llm_client = anthropic.Anthropic()
        except ImportError:
            try:
                import openai
                self._graphiti.llm_client = openai.OpenAI()
            except ImportError:
                raise ImportError(
                    "No LLM client available. "
                    "Install anthropic or openai package."
                )

    async def add_entity(self, entity: Entity) -> EntityID:
        """Add or update entity in Graphiti."""
        try:
            # Graphiti uses add_node internally
            node = EntityNode(
                name=entity.name,
                labels=[entity.type.value],
                properties=entity.properties,
            )
            result = await self._graphiti.add_node(node)
            return EntityID(result.uuid)
        except Exception as e:
            raise StorageError("add_entity", str(e), retryable=True)

    async def add_relationship(
        self,
        source: EntityID,
        target: EntityID,
        rel_type: RelationType,
        properties: dict[str, Any],
    ) -> RelationshipID:
        """Add relationship between entities."""
        try:
            result = await self._graphiti.add_edge(
                source_uuid=source.value,
                target_uuid=target.value,
                relation_type=rel_type.value,
                properties=properties,
            )
            return RelationshipID(result.uuid)
        except Exception as e:
            if "not found" in str(e).lower():
                raise EntityNotFoundError(source if "source" in str(e) else target)
            raise StorageError("add_relationship", str(e), retryable=True)

    async def search_entities(
        self,
        query: str,
        *,
        entity_types: list[EntityType] | None = None,
        limit: int = 10,
    ) -> list[Entity]:
        """Semantic entity search using Graphiti."""
        try:
            results = await self._graphiti.search(
                query=query,
                num_results=limit,
            )

            entities = []
            for node in results.nodes:
                # Filter by entity type if specified
                if entity_types:
                    node_type = self._parse_entity_type(node.labels)
                    if node_type not in entity_types:
                        continue

                entities.append(self._convert_node(node))

            return entities[:limit]
        except Exception as e:
            raise StorageError("search_entities", str(e), retryable=True)

    async def get_neighbors(
        self,
        entity_id: EntityID,
        *,
        rel_types: list[RelationType] | None = None,
        direction: Literal["in", "out", "both"] = "both",
        max_hops: int = 1,
    ) -> list[tuple[Entity, Relationship]]:
        """Graph traversal using Graphiti."""
        try:
            # Use Graphiti's traversal
            results = await self._graphiti.get_neighbors(
                uuid=entity_id.value,
                depth=max_hops,
                direction=direction,
            )

            neighbors = []
            for edge in results.edges:
                # Filter by relationship type
                if rel_types:
                    edge_type = RelationType(edge.relation_type)
                    if edge_type not in rel_types:
                        continue

                entity = self._convert_node(edge.target_node)
                relationship = self._convert_edge(edge)
                neighbors.append((entity, relationship))

            return neighbors
        except Exception as e:
            if "not found" in str(e).lower():
                raise EntityNotFoundError(entity_id)
            raise StorageError("get_neighbors", str(e), retryable=True)

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Ingest text and extract entities via LLM."""
        try:
            result = await self._graphiti.add_episode(
                name=f"episode:{hash(text)}",
                episode_body=text,
                source_description=source,
                reference_time=timestamp or datetime.now(),
            )

            return [self._convert_node(n) for n in result.nodes]
        except Exception as e:
            if "rate" in str(e).lower() or "limit" in str(e).lower():
                raise LLMError(str(e), retryable=True, retry_after_seconds=60)
            raise LLMError(str(e), retryable=False)

    def _convert_node(self, node) -> Entity:
        """Convert Graphiti node to our Entity."""
        entity_type = self._parse_entity_type(node.labels)
        return Entity(
            id=EntityID(node.uuid),
            type=entity_type,
            name=node.name,
            properties=node.properties or {},
            source_refs=[],
        )

    def _convert_edge(self, edge) -> Relationship:
        """Convert Graphiti edge to our Relationship."""
        return Relationship(
            id=RelationshipID(edge.uuid),
            type=RelationType(edge.relation_type),
            source_id=EntityID(edge.source_uuid),
            target_id=EntityID(edge.target_uuid),
            properties=edge.properties or {},
            timestamp=edge.created_at,
        )

    def _parse_entity_type(self, labels: list[str]) -> EntityType:
        """Parse EntityType from node labels."""
        for label in labels:
            try:
                return EntityType(label)
            except ValueError:
                continue
        return EntityType.SERVICE  # Default
```

## Tests

```python
@pytest.mark.integration
async def test_graphiti_add_entity():
    """Integration test with real Neo4j."""
    store = GraphitiStore.from_env()

    entity = Entity(
        id=EntityID("test-1"),
        type=EntityType.SERVICE,
        name="test-service",
        properties={"version": "1.0"},
        source_refs=[],
    )

    result_id = await store.add_entity(entity)
    assert result_id is not None

    await store.close()

@pytest.mark.integration
async def test_graphiti_episode_extraction():
    """Test LLM entity extraction."""
    store = GraphitiStore.from_env()

    entities = await store.add_episode(
        "The auth-service calls user-service for authentication.",
        source="test",
    )

    # Should extract at least auth-service and user-service
    names = [e.name.lower() for e in entities]
    assert any("auth" in n for n in names)

    await store.close()
```

## Acceptance Criteria

- [ ] Implements GraphStore protocol
- [ ] Connects to Neo4j using environment variables
- [ ] Entity extraction works with LLM
- [ ] Graph traversal works
- [ ] Error handling distinguishes retryable vs permanent
- [ ] Context manager properly closes connection

## Estimated Time

45 minutes
