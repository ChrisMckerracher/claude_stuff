"""Entity and relationship schema for the knowledge graph.

Defines the types of nodes and edges in the knowledge graph,
representing domain concepts like services, people, and their relationships.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


@dataclass(frozen=True)
class EntityID:
    """Unique identifier for an entity in the knowledge graph.

    Frozen to be usable as dict key and in sets.
    """

    value: str


@dataclass(frozen=True)
class RelationshipID:
    """Unique identifier for a relationship in the knowledge graph.

    Frozen to be usable as dict key and in sets.
    """

    value: str


class EntityType(Enum):
    """Types of entities in the knowledge graph."""

    SERVICE = "Service"  # Microservice
    PERSON = "Person"  # Team member
    INCIDENT = "Incident"  # Production incident
    DECISION = "Decision"  # Architecture decision
    ENDPOINT = "Endpoint"  # API endpoint
    QUEUE = "Queue"  # Message queue
    DATABASE = "Database"  # Data store
    FILE = "File"  # Source file
    FUNCTION = "Function"  # Code function/method


class RelationType(Enum):
    """Types of relationships between entities."""

    CALLS = "CALLS"  # Service -> Service
    PUBLISHES_TO = "PUBLISHES_TO"  # Service -> Queue
    SUBSCRIBES_TO = "SUBSCRIBES_TO"  # Service -> Queue
    READS_FROM = "READS_FROM"  # Service -> Database
    WRITES_TO = "WRITES_TO"  # Service -> Database
    OWNS = "OWNS"  # Person -> Service
    MENTIONS = "MENTIONS"  # Conversation -> Entity
    CAUSED = "CAUSED"  # Change -> Incident
    RESOLVED = "RESOLVED"  # Person -> Incident
    IMPORTS = "IMPORTS"  # File -> Module
    CONTAINS = "CONTAINS"  # File -> Function


@dataclass
class Entity:
    """A node in the knowledge graph.

    Represents a domain concept like a service, person, or file.
    """

    id: EntityID
    type: EntityType
    name: str
    properties: dict[str, Any] = field(default_factory=dict)
    source_refs: list[str] = field(default_factory=list)  # Where entity was found


@dataclass
class Relationship:
    """An edge in the knowledge graph.

    Represents a directed relationship between two entities.
    """

    id: RelationshipID
    type: RelationType
    source_id: EntityID
    target_id: EntityID
    properties: dict[str, Any] = field(default_factory=dict)
    timestamp: datetime | None = None
