# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (HEAD) | ✅ |
| Older commits | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability in Attesting, **do not open a public issue.**

Instead, please email **security@attesting.dev** (or contact the maintainer directly via GitHub) with:

1. A description of the vulnerability
2. Steps to reproduce
3. Affected files or components
4. Potential impact assessment

You will receive an acknowledgment within 48 hours. We aim to provide a fix or mitigation within 7 days for critical issues.

## Scope

The following are in scope for security reports:

- SQL injection in API routes or CLI commands
- Path traversal in file upload/import features
- Authentication or authorization bypass (once auth is implemented)
- Sensitive data exposure (credentials, PII in logs or exports)
- Cross-site scripting (XSS) in the Web UI
- Dependency vulnerabilities with a known exploit
- Insecure default configurations

## Out of Scope

- Denial of service against the local SQLite database (local-first tool)
- Security of the deployment environment (Docker host, network config)
- Social engineering

## Security Measures

Attesting includes:

- Parameterized SQL queries throughout (no string concatenation)
- File upload scanning with magic byte validation, extension whitelist, and script detection
- Content Security Policy headers on all responses
- Rate limiting on API endpoints
- CI pipeline with secret scanning, SQL injection scanning, and npm audit
- Input validation on all write endpoints
