# Auth Service

A microservice for user authentication and authorization.

## Features

- JWT-based authentication
- OAuth2 support
- Role-based access control
- Session management

## Getting Started

### Prerequisites

- Go 1.21+
- PostgreSQL 14+
- Redis 7+

### Installation

```bash
go mod download
go build -o auth-service ./cmd/server
```

### Configuration

Set the following environment variables:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection URL
- `JWT_SECRET`: Secret key for JWT signing

## API Reference

### POST /auth/login

Authenticates a user and returns a JWT token.

### POST /auth/refresh

Refreshes an expired JWT token.

### GET /auth/verify

Verifies a JWT token is valid.
