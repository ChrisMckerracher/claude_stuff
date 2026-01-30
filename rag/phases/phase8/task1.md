# Task 8.1: Neo4j Setup

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Set up Neo4j for production Graphiti usage.

## Options

### Option A: Docker (Local Development)

```bash
# Start Neo4j container
docker run -d \
  --name neo4j-rag \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/your-password \
  -e NEO4J_PLUGINS='["apoc"]' \
  -v neo4j-data:/data \
  neo4j:5.15.0

# Verify it's running
docker logs neo4j-rag

# Access browser UI at http://localhost:7474
```

### Option B: Neo4j Aura (Cloud)

1. Go to https://neo4j.com/cloud/aura/
2. Create a free AuraDB instance
3. Copy connection details:
   - URI: `neo4j+s://xxxxxxxx.databases.neo4j.io`
   - Username: `neo4j`
   - Password: (generated)

### Environment Variables

```bash
# Add to ~/.bashrc or ~/.zshrc
export NEO4J_URI=bolt://localhost:7687  # or neo4j+s://... for Aura
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=your-password

# LLM API for entity extraction
export ANTHROPIC_API_KEY=sk-ant-...
# OR
export OPENAI_API_KEY=sk-...
```

## Connection Validation

```python
# rag/graphiti/validate.py

from neo4j import GraphDatabase

def validate_neo4j_connection() -> bool:
    """Validate Neo4j connection works."""
    import os

    uri = os.environ.get("NEO4J_URI")
    user = os.environ.get("NEO4J_USER")
    password = os.environ.get("NEO4J_PASSWORD")

    if not all([uri, user, password]):
        print("ERROR: Missing Neo4j environment variables")
        print("Required: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD")
        return False

    try:
        driver = GraphDatabase.driver(uri, auth=(user, password))
        with driver.session() as session:
            result = session.run("RETURN 1 AS test")
            record = result.single()
            assert record["test"] == 1

        driver.close()
        print(f"SUCCESS: Connected to Neo4j at {uri}")
        return True

    except Exception as e:
        print(f"ERROR: Failed to connect to Neo4j: {e}")
        return False


if __name__ == "__main__":
    validate_neo4j_connection()
```

## Docker Compose (Full Stack)

```yaml
# docker-compose.yml
version: '3.8'

services:
  neo4j:
    image: neo4j:5.15.0
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      - NEO4J_AUTH=neo4j/password
      - NEO4J_PLUGINS=["apoc"]
    volumes:
      - neo4j-data:/data
    healthcheck:
      test: ["CMD", "neo4j", "status"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  neo4j-data:
```

## Acceptance Criteria

- [ ] Neo4j is running (Docker or Aura)
- [ ] Environment variables are set
- [ ] `validate_neo4j_connection()` returns True
- [ ] Browser UI accessible (http://localhost:7474 for Docker)
- [ ] LLM API key is set (Anthropic or OpenAI)

## Estimated Time

30 minutes
