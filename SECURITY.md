# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`main`) | Yes |
| Older releases | No — please upgrade |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues by email to **[security@synapmail.bthoury.fr](mailto:security@synapmail.bthoury.fr)**.

Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any proof-of-concept code or screenshots (if applicable)
- Your recommended fix (optional)

You will receive a response within **72 hours** acknowledging receipt. We aim to release a fix within **14 days** for critical issues.

## Scope

Issues in scope:

- Authentication / session management bypass
- SQL injection or database access
- Stored / reflected XSS in the email client UI
- IMAP/SMTP credential exposure
- Remote code execution
- Privilege escalation (user → admin)
- Sensitive data exposure (emails, passwords, tokens)

Out of scope:

- Vulnerabilities in third-party dependencies (report those to the dependency maintainer)
- Self-XSS requiring physical access to a logged-in session
- Denial of service against your own self-hosted instance
- Issues requiring already having admin access

## Disclosure Policy

Once a fix is released, we will:

1. Credit the reporter in the release notes (unless you prefer to remain anonymous)
2. Publish a security advisory on GitHub

## Security Best Practices for Self-Hosters

- Run behind a reverse proxy with HTTPS (nginx, Caddy, Traefik)
- Set `REGISTRATION_ENABLED=false` after initial setup
- Use a strong, randomly generated `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`
- Keep the Docker image up to date — pull the latest `ghcr.io/bryan1993-ha/synapmail` image regularly
- Restrict database access to the Docker network only
