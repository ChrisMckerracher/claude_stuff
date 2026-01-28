# Deploy and Rollback Runbook

Procedures for deploying and rolling back the auth-service.

## Deploy

### Pre-deployment Checklist

1. Verify all tests pass in CI
2. Check that the user-service is healthy
3. Notify #platform-alerts channel

### Deployment Steps

1. Pull the latest image:
   ```bash
   docker pull registry.example.com/auth-service:$VERSION
   ```

2. Apply Kubernetes manifests:
   ```bash
   kubectl apply -f k8s/deployment.yaml
   ```

3. Verify deployment:
   ```bash
   kubectl rollout status deployment/auth-service
   ```

## Rollback

### When to Rollback

- Error rate exceeds 5%
- P99 latency exceeds 500ms
- Critical bug discovered

### Rollback Steps

1. Identify the previous version:
   ```bash
   kubectl rollout history deployment/auth-service
   ```

2. Rollback to previous version:
   ```bash
   kubectl rollout undo deployment/auth-service
   ```

3. Verify rollback:
   ```bash
   kubectl rollout status deployment/auth-service
   ```

### Post-rollback Actions

1. Update #incident-response with rollback details
2. Create incident ticket
3. Schedule post-mortem
