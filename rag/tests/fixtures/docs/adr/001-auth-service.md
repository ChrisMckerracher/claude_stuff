# ADR-001: Authentication Service Architecture

## Status

Accepted

## Context

We need a centralized authentication service to handle user authentication
across all microservices. Currently, each service implements its own
authentication logic, leading to inconsistencies and security gaps.

## Decision

We will implement a dedicated auth-service that:

1. Issues JWT tokens for authenticated users
2. Validates tokens for other services
3. Manages user sessions
4. Integrates with external OAuth providers

### Dependencies

The auth-service will depend on:
- user-service: For user data retrieval
- notification-service: For sending verification emails

### Security Considerations

- Tokens expire after 1 hour
- Refresh tokens valid for 7 days
- All communications over HTTPS
- Passwords hashed with bcrypt

## Consequences

### Positive

- Centralized authentication logic
- Consistent security policies
- Easier to audit and update

### Negative

- Single point of failure
- Additional network hop for auth checks
- Migration effort from existing systems
