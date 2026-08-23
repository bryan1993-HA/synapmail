# Changelog

All notable changes to Synapmail will be documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Initial project setup (Next.js 14, TypeScript, Tailwind CSS, shadcn/ui)
- Three-column layout (Sidebar / MessageList / ReadingPane)
- Auth.js v5 multi-user authentication (credentials provider)
- PostgreSQL database schema (users, email_accounts, signatures, messages_cache, user_settings)
- IMAP integration via imapflow
- SMTP integration via nodemailer
- Tiptap rich editor for email composition
- next-intl internationalization (English + French)
- Docker deployment configuration
- MIT License
- REST API (accounts, messages, folders, send, search, SSE stream)
- Dark/Light theme with system detection
- Fully responsive three-column layout (mobile drawer, tablet two-col, desktop three-col)
