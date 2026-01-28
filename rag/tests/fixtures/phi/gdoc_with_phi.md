# Customer Onboarding Checklist

**Author:** Alexandra Kim (alex.kim@company.com)
**Last Updated:** January 22, 2024
**Reviewer:** James Wilson

## Client Information

- **Primary Contact:** Maria Garcia
- **Phone:** +1 (650) 555-7890
- **Email:** maria.garcia@newclient.com
- **Address:** 1234 Oak Street, San Francisco, CA 94102

## Technical Setup

The client's infrastructure team lead, Carlos Rodriguez (carlos.r@newclient.com),
will be our main technical contact.

### Database Migration

Connect to the legacy system at `mysql://admin:password123@oldserver.newclient.local/production`
to begin data extraction.

**Important:** The migration involves sensitive data including:
- Customer SSNs (e.g., 456-78-9012 in test records)
- Credit card numbers
- Medical records for insurance claims

### API Integration

Use the following credentials for staging:
```
API_KEY="sk-test-abcdefghijklmnop1234567890"
API_SECRET="secret_XyZ123AbCdEfGhIjKlMnOp"
```

Contact Kevin Thompson at kevin.t@company.internal.com if you need production keys.

## Compliance Sign-off

- [ ] HIPAA compliance verified by Dr. Patricia Brown
- [ ] Security audit completed by the InfoSec team
- [ ] Legal review by attorney Michelle Lee (mlee@lawfirm.com)

## Emergency Contacts

| Role | Name | Phone |
|------|------|-------|
| Project Lead | David Park | (408) 555-1234 |
| Technical Lead | Carlos Rodriguez | (650) 555-4567 |
| Client Sponsor | Maria Garcia | (650) 555-7890 |
