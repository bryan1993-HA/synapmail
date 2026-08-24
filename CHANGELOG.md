# Changelog

All notable changes to Synapmail will be documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Initial project setup (Next.js 14, TypeScript, Tailwind CSS, shadcn/ui)
- Three-column layout (Sidebar / MessageList / ReadingPane)
- Auth.js v5 multi-user authentication (credentials provider + Microsoft OAuth2)
- PostgreSQL database schema (users, email_accounts, signatures, messages_cache, user_settings)
- IMAP integration via imapflow (basic auth + XOAUTH2 for Microsoft/Google)
- SMTP integration via nodemailer (basic auth + OAuth2)
- Tiptap rich editor for email composition (bold, italic, underline, strikethrough, alignment, lists, link, blockquote, code, headings, HR)
- next-intl internationalization (English + French)
- Docker deployment configuration
- MIT License
- REST API (accounts, messages, folders, send, search, thread, attachments, signatures, admin)
- Dark/Light/System theme with ThemeToggle
- Fully responsive layout (mobile overlay sidebar + hamburger, desktop three-column)
- **Search** — IMAP search by sender, subject, content with debounce
- **Attachments** — download endpoint + attachment UI in reading pane (mailparser)
- **Thread view** — client-side conversation grouping by normalized subject, expandable cards (Gmail-style)
- **Signatures** — per-user rich-text signatures, auto-insert on compose, dropdown selector
- **Browser notifications** — permission request + new mail alert via SWR polling
- **Admin panel** — `/admin/users` CRUD: list users, toggle role, delete, create
- **Multi-account** — account switcher in sidebar (localStorage persistence + custom events)
- **Microsoft OAuth2 IMAP/SMTP** — personal Live/Outlook accounts via XOAUTH2 (tenant: consumers)
