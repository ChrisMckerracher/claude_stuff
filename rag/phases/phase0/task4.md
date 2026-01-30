# Task 0.4: Define Entity Schema

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Define the knowledge graph entity and relationship types that capture the domain model.

## File

`rag/core/schema.py`

## Types to Implement

### EntityType Enum

```python
class EntityType(Enum):
    """Types of entities in the knowledge graph."""
    SERVICE = "Service"       # Microservice
    PERSON = "Person"         # Team member
    INCIDENT = "Incident"     # Production incident
    DECISION = "Decision"     # Architecture decision
    ENDPOINT = "Endpoint"     # API endpoint
    QUEUE = "Queue"           # Message queue
    DATABASE = "Database"     # Data store
    FILE = "File"             # Source file
    FUNCTION = "Function"     # Code function/method
```

### RelationType Enum

```python
class RelationType(Enum):
    """Types of relationships between entities."""
    CALLS = "CALLS"                   # Service -> Service
    PUBLISHES_TO = "PUBLISHES_TO"     # Service -> Queue
    SUBSCRIBES_TO = "SUBSCRIBES_TO"   # Service -> Queue
    READS_FROM = "READS_FROM"         # Service -> Database
    WRITES_TO = "WRITES_TO"           # Service -> Database
    OWNS = "OWNS"                     # Person -> Service
    MENTIONS = "MENTIONS"             # Conversation -> Entity
    CAUSED = "CAUSED"                 # Change -> Incident
    RESOLVED = "RESOLVED"             # Person -> Incident
    IMPORTS = "IMPORTS"               # File -> Module
    CONTAINS = "CONTAINS"             # File -> Function
```

### EntityID and RelationshipID

```python
@dataclass(frozen=True)
class EntityID:
    """Unique identifier for an entity."""
    value: str

@dataclass(frozen=True)
class RelationshipID:
    """Unique identifier for a relationship."""
    value: str
```

### Entity

```python
@dataclass
class Entity:
    """A node in the knowledge graph."""
    id: EntityID
    type: EntityType
    name: str
    properties: dict[str, Any]
    source_refs: list[str]  # Where this entity was found
```

### Relationship

```python
@dataclass
class Relationship:
    """An edge in the knowledge graph."""
    id: RelationshipID
    type: RelationType
    source_id: EntityID
    target_id: EntityID
    properties: dict[str, Any]
    timestamp: datetime | None
```

## Domain Model Coverage

Ensure these domain concepts can be represented:

| Concept | Entity Type | Example |
|---------|-------------|---------|
| auth-service | SERVICE | Service(name="auth-service") |
| John Smith | PERSON | Person(name="John Smith") |
| user-events queue | QUEUE | Queue(name="user-events") |
| /api/users endpoint | ENDPOINT | Endpoint(name="/api/users") |
| PostgreSQL | DATABASE | Database(name="postgres") |
| login.py | FILE | File(name="auth-service/src/auth/login.py") |
| authenticate_user | FUNCTION | Function(name="authenticate_user") |

| Relationship | From | To | Example |
|--------------|------|-----|---------|
| CALLS | SERVICE | SERVICE | auth-service CALLS user-service |
| PUBLISHES_TO | SERVICE | QUEUE | auth-service PUBLISHES_TO user-events |
| OWNS | PERSON | SERVICE | John OWNS auth-service |
| CONTAINS | FILE | FUNCTION | login.py CONTAINS authenticate_user |

## Acceptance Criteria

- [ ] EntityType enum has all 9 types
- [ ] RelationType enum has all 11 types
- [ ] EntityID and RelationshipID are frozen (hashable)
- [ ] Entity dataclass captures all necessary fields
- [ ] Relationship dataclass captures all necessary fields
- [ ] Can represent all examples from domain model table

## Dependencies

None - schema is independent.

## Estimated Time

20 minutes
