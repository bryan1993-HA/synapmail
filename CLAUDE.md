# Synapmail — AI Context Reference

**Synapmail** is a self-hosted, open-source, AI-powered email client.
Three-column layout (Sidebar / MessageList / ReadingPane). Multi-user, multi-account (any IMAP/SMTP), rich editor (Tiptap), fully responsive, multilingual (next-intl).

**Live URL**: `https://synapmail.bthoury.fr` (container port `3500→3000`)
**GitHub**: `https://github.com/bryan1993-HA/synapmail`
**License**: MIT

---

## Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 14 (App Router, TypeScript) |
| UI | Tailwind CSS + shadcn/ui |
| Auth | Auth.js v5 (credentials, multi-user) |
| Database | PostgreSQL |
| IMAP | imapflow |
| SMTP | nodemailer |
| Rich Editor | Tiptap |
| i18n | next-intl |
| Realtime | Server-Sent Events |

---

## File Structure

```
app/
  layout.tsx                    # Root layout (ThemeProvider + i18n)
  globals.css                   # Global styles + CSS variables
  (auth)/
    login/page.tsx              # Login page
    register/page.tsx           # Registration (admin-only)
  (app)/
    layout.tsx                  # App layout (requires auth) — three-column shell
    mail/
      page.tsx                  # Main mail view (server component)
      [folder]/page.tsx         # Dynamic folder view
    compose/page.tsx            # Compose standalone page
    settings/
      page.tsx                  # Settings index
      accounts/page.tsx         # Email accounts CRUD
      profile/page.tsx          # User profile (name, password change)
      signatures/page.tsx       # Email signatures
    admin/
      users/page.tsx            # Admin: user management
  api/
    auth/[...nextauth]/route.ts # Auth.js handlers
    accounts/route.ts           # GET list / POST create email account
    accounts/[id]/route.ts      # PATCH update / DELETE remove account
    messages/route.ts           # GET list messages (IMAP) — hasAttachments via detectAttachments()
    messages/[id]/route.ts      # GET single / DELETE
    messages/[id]/read/route.ts # PATCH mark as read
    messages/[id]/attachment/[partId]/route.ts  # GET download or inline preview (?inline=true)
    folders/route.ts            # GET list folders
    send/route.ts               # POST send email (SMTP)
    search/route.ts             # GET full-text search
    profile/route.ts            # GET current user / PATCH name + password
    stream/route.ts             # GET Server-Sent Events (new mail notify)

components/
  layout/
    AppShell.tsx                # Three-column shell container
    Sidebar.tsx                 # Left: accounts + folders nav
    MessageList.tsx             # Center: email list
    ReadingPane.tsx             # Right: email content viewer
    Header.tsx                  # Top bar (search, compose, user menu)
  compose/
    ComposeModal.tsx            # Compose overlay modal
    RichEditor.tsx              # Tiptap editor wrapper
    AttachmentList.tsx          # Attachment chips
  mail/
    MessageRow.tsx              # Single email row in list
    MessageViewer.tsx           # Email body renderer (HTML/plain)
    ThreadView.tsx              # Threaded conversation view
    FolderTree.tsx              # Folder hierarchy
  ui/                           # shadcn/ui components
  providers.tsx                 # SessionProvider + ThemeProvider + ToastProvider

lib/
  auth.ts                       # Auth.js config — credentials provider, multi-user
  db.ts                         # PostgreSQL pool — query<T>(sql, values?)
  imap.ts                       # imapflow wrapper — connect, list, fetch, delete, move
  smtp.ts                       # nodemailer wrapper — send, verify
  accounts.ts                   # Email account CRUD helpers
  i18n.ts                       # next-intl request config
  utils.ts                      # cn() + helpers

locales/
  en.json                       # English translations
  fr.json                       # French translations

middleware.ts                   # Auth protection + i18n routing
next.config.mjs                 # Next.js config (withNextIntl)
```

---

## Commands

```bash
# Development
npm run dev

# Production build
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml up -d --build
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml logs -f synapmail
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml down
```

Docker Compose: `/mnt/stockage/docker/synapmail/docker-compose.yml`
Env file: `/mnt/stockage/docker/synapmail/.env`

---

## Database Schema

```sql
-- Users (multi-user support)
users (id, email, name, password_hash, role, avatar_url, created_at)
  role: 'admin' | 'user'

-- Email accounts per user
email_accounts (id, user_id, name, email, imap_host, imap_port, imap_secure,
                smtp_host, smtp_port, smtp_secure, username, password_encrypted,
                oauth_provider, oauth_access_token, oauth_refresh_token, oauth_expires_at,
                is_default, color, created_at)

-- Email signatures
signatures (id, user_id, account_id, name, content_html, is_default, created_at)

-- Cached message metadata (for fast list/search)
messages_cache (id, account_id, folder, uid, message_id, from_address, from_name,
                subject, date, is_read, is_starred, is_flagged, has_attachments,
                preview, thread_id, cached_at)

-- App settings per user
user_settings (user_id, theme, language, messages_per_page, thread_view,
               reading_pane, notifications, updated_at)
```

---

## Critical Technical Points

### Auth.js v5
- Credentials provider: email + password (bcrypt)
- `trustHost: true` mandatory behind reverse proxy
- Role stored in JWT token (`token.role`)
- Admin role required for `/admin/*` routes and user creation

### IMAP (imapflow)
- Connection pool per account — reuse where possible
- Always `client.logout()` after each operation
- UID-based operations (not sequence numbers) for reliability
- Folder names with spaces need quoting: `"[Gmail]/All Mail"`

### SMTP (nodemailer)
- Create transporter from account settings
- Verify connection before saving account
- HTML emails via Tiptap output — sanitize before sending

### i18n (next-intl)
- Locale detection from browser header
- Supported: `en`, `fr`
- Locale prefix: none (default locale = no prefix)
- All user-facing strings in `locales/*.json`

### Server-Sent Events (new mail)
- `GET /api/stream` — keeps connection open
- Polls IMAP every 30s per connected account
- Sends `data: { type: 'new_mail', account, count }` events

### Encryption
- Email passwords stored encrypted (AES-256-GCM) using `ENCRYPTION_KEY` env var
- Never store plain passwords

### Responsive Design
- Mobile: single column (drawer for sidebar)
- Tablet: two columns (sidebar hidden by default)
- Desktop: three columns full

---

## Environment Variables

```env
# Auth
NEXTAUTH_URL=https://synapmail.bthoury.fr
NEXTAUTH_SECRET=

# Database
DATABASE_URL=postgresql://synapmail_user:password@postgres:5432/synapmail

# Encryption (for email passwords)
ENCRYPTION_KEY=   # 32-byte hex string

# App
NEXT_PUBLIC_APP_URL=https://synapmail.bthoury.fr
REGISTRATION_ENABLED=true   # set to false after setup
```

---

## Conventions

- **API responses**: always `{ data, error }` shape
- **Error handling**: API routes return `{ error: string }` with appropriate HTTP status
- **IMAP calls**: always in try/finally to ensure logout
- **Translations**: never hardcode user-facing strings — always use `useTranslations()`
- **Types**: define interfaces in `types/` directory, import from there
- **Components**: Client components use `'use client'`, server by default
