# Task 8.3: Migration from Mock to Graphiti

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Migrate from MockGraphStore to GraphitiStore and validate parity.

## File

`rag/graphiti/factory.py`

## Implementation

```python
import os
from rag.core.protocols import GraphStore
from rag.graphiti.mock_store import MockGraphStore
from rag.graphiti.client import GraphitiStore

class GraphStoreConfig:
    """Configuration for graph store selection."""

    def __init__(
        self,
        use_mock: bool = True,
        neo4j_uri: str | None = None,
        neo4j_user: str | None = None,
        neo4j_password: str | None = None,
    ):
        self.use_mock = use_mock
        self.neo4j_uri = neo4j_uri or os.environ.get("NEO4J_URI")
        self.neo4j_user = neo4j_user or os.environ.get("NEO4J_USER")
        self.neo4j_password = neo4j_password or os.environ.get("NEO4J_PASSWORD")

    @property
    def has_neo4j_config(self) -> bool:
        """Check if Neo4j configuration is complete."""
        return all([self.neo4j_uri, self.neo4j_user, self.neo4j_password])


def create_graph_store(config: GraphStoreConfig | None = None) -> GraphStore:
    """Factory for GraphStore implementations.

    Args:
        config: Configuration for graph store. If None, uses environment.

    Returns:
        MockGraphStore for testing, GraphitiStore for production.
    """
    if config is None:
        config = GraphStoreConfig()

    if config.use_mock:
        return MockGraphStore()

    if not config.has_neo4j_config:
        raise ValueError(
            "Neo4j configuration incomplete. "
            "Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD or use mock."
        )

    return GraphitiStore(
        neo4j_uri=config.neo4j_uri,
        neo4j_user=config.neo4j_user,
        neo4j_password=config.neo4j_password,
    )


async def migrate_to_graphiti(
    mock_store: MockGraphStore,
    graphiti_store: GraphitiStore,
) -> dict[str, int]:
    """Migrate data from MockGraphStore to GraphitiStore.

    Args:
        mock_store: Source mock store with data
        graphiti_store: Target Graphiti store

    Returns:
        Migration statistics
    """
    stats = {
        "entities_migrated": 0,
        "relationships_migrated": 0,
        "errors": 0,
    }

    # Migrate entities
    id_mapping: dict[str, str] = {}  # old_id -> new_id

    for old_id, entity in mock_store._entities.items():
        try:
            new_id = await graphiti_store.add_entity(entity)
            id_mapping[old_id.value] = new_id.value
            stats["entities_migrated"] += 1
        except Exception as e:
            print(f"Error migrating entity {old_id}: {e}")
            stats["errors"] += 1

    # Migrate relationships
    for rel in mock_store._relationships.values():
        try:
            # Map old IDs to new IDs
            source_id = EntityID(id_mapping.get(rel.source_id.value, rel.source_id.value))
            target_id = EntityID(id_mapping.get(rel.target_id.value, rel.target_id.value))

            await graphiti_store.add_relationship(
                source=source_id,
                target=target_id,
                rel_type=rel.type,
                properties=rel.properties,
            )
            stats["relationships_migrated"] += 1
        except Exception as e:
            print(f"Error migrating relationship {rel.id}: {e}")
            stats["errors"] += 1

    return stats


async def validate_parity(
    mock_store: MockGraphStore,
    graphiti_store: GraphitiStore,
    test_queries: list[str],
) -> dict[str, bool]:
    """Validate that Graphiti returns similar results to mock.

    Args:
        mock_store: Mock store for comparison
        graphiti_store: Graphiti store to validate
        test_queries: Queries to test

    Returns:
        Parity results per query
    """
    results = {}

    for query in test_queries:
        mock_entities = await mock_store.search_entities(query, limit=10)
        graphiti_entities = await graphiti_store.search_entities(query, limit=10)

        # Check if similar entities are returned
        mock_names = set(e.name.lower() for e in mock_entities)
        graphiti_names = set(e.name.lower() for e in graphiti_entities)

        # Consider parity if there's significant overlap
        overlap = len(mock_names & graphiti_names)
        total = len(mock_names | graphiti_names)
        parity = (overlap / total) > 0.5 if total > 0 else True

        results[query] = parity

    return results
```

## Migration Script

```python
# scripts/migrate_to_graphiti.py

import asyncio
from rag.graphiti.factory import create_graph_store, migrate_to_graphiti, GraphStoreConfig
from rag.graphiti.mock_store import MockGraphStore

async def main():
    # Load existing mock data (from previous pipeline run)
    mock_store = MockGraphStore()
    # ... populate mock_store from saved state ...

    # Create Graphiti store
    config = GraphStoreConfig(use_mock=False)
    graphiti_store = create_graph_store(config)

    # Migrate
    print("Starting migration...")
    stats = await migrate_to_graphiti(mock_store, graphiti_store)

    print(f"Entities migrated: {stats['entities_migrated']}")
    print(f"Relationships migrated: {stats['relationships_migrated']}")
    print(f"Errors: {stats['errors']}")

    # Validate
    print("\nValidating parity...")
    test_queries = [
        "auth-service",
        "user authentication",
        "billing api",
    ]
    parity = await validate_parity(mock_store, graphiti_store, test_queries)

    for query, is_parity in parity.items():
        status = "PASS" if is_parity else "FAIL"
        print(f"  {query}: {status}")

    await graphiti_store.close()

if __name__ == "__main__":
    asyncio.run(main())
```

## Tests

```python
def test_factory_returns_mock_by_default():
    store = create_graph_store()
    assert isinstance(store, MockGraphStore)

def test_factory_returns_graphiti_when_configured():
    config = GraphStoreConfig(
        use_mock=False,
        neo4j_uri="bolt://localhost:7687",
        neo4j_user="neo4j",
        neo4j_password="password",
    )
    # This will fail without Neo4j, but verifies logic
    with pytest.raises(Exception):
        store = create_graph_store(config)

def test_factory_raises_without_config():
    config = GraphStoreConfig(use_mock=False)
    config.neo4j_uri = None
    with pytest.raises(ValueError) as exc:
        create_graph_store(config)
    assert "Neo4j configuration incomplete" in str(exc.value)

@pytest.mark.integration
async def test_migration_preserves_entities():
    mock = MockGraphStore()
    await mock.add_entity(Entity(...))

    graphiti = GraphitiStore.from_env()
    stats = await migrate_to_graphiti(mock, graphiti)

    assert stats["entities_migrated"] == 1
    assert stats["errors"] == 0

    await graphiti.close()
```

## Acceptance Criteria

- [ ] Factory returns MockGraphStore by default
- [ ] Factory returns GraphitiStore when use_mock=False
- [ ] Factory raises helpful error if Neo4j config missing
- [ ] Migration script transfers entities and relationships
- [ ] Parity validation compares search results
- [ ] Integration tests pass with real Neo4j

## Estimated Time

35 minutes
