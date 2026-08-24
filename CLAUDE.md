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
      page.tsx                  # Server component (auth guard + Suspense)
      MailClient.tsx            # Client: orchestrates all mail UI, keyboard shortcuts, message routing
    settings/
      page.tsx                  # Settings index (server component — getTranslations)
      accounts/
        page.tsx                # Server component — passes searchParams as props (no useSearchParams)
        AccountsClient.tsx      # Client component — list / add (wizard) / edit modes
        AccountWizard.tsx       # Multi-step wizard: provider grid → credentials → advanced config
        ErrorBoundary.tsx       # React class error boundary for diagnostic output
      profile/page.tsx          # User profile (name, password change)
      signatures/page.tsx       # Email signatures
    admin/
      users/page.tsx            # Admin: user management
  api/
    auth/[...nextauth]/route.ts # Auth.js handlers
    accounts/route.ts           # GET list / POST create email account
    accounts/[id]/route.ts      # PATCH update / DELETE remove account
    accounts/test/route.ts      # POST test IMAP+SMTP connection (used by wizard)
    messages/route.ts           # GET list messages (IMAP) — hasAttachments via detectAttachments()
    messages/[id]/route.ts      # GET single / PATCH (read, star) / DELETE
    messages/[id]/read/route.ts # PATCH mark as read
    messages/[id]/attachment/[partId]/route.ts  # GET download or inline preview (?inline=true)
    messages/bulk/route.ts      # PATCH bulk mark read/unread or move / DELETE bulk delete
    folders/route.ts            # GET list folders
    send/route.ts               # POST send email (SMTP + forwarded attachments re-fetched from IMAP)
    search/route.ts             # GET full-text search
    profile/route.ts            # GET current user / PATCH name + password
    stream/route.ts             # GET Server-Sent Events (new mail notify)

components/
  layout/
    AppShell.tsx                # Three-column shell container
    Sidebar.tsx                 # Left: accounts + folders nav (drag-drop targets)
    MessageList.tsx             # Center: email list (bulk select, drag source, context menu)
    ReadingPane.tsx             # Right: email viewer (To/Cc header, reply/replyAll/forward)
    Header.tsx                  # Top bar (search, compose, user menu)
  mail/
    ComposeModal.tsx            # Compose / reply / replyAll / forward + BCC + draft auto-save
  ui/
    MessageContextMenu.tsx      # Right-click context menu (mark, star, move submenu, delete)
    [shadcn components]

hooks/
  useEmailNotifications.ts      # Desktop notifications with click-to-open (synapmail:open-message)
  useKeyboardShortcuts.ts       # Global keyboard shortcuts (c/r/a/f/Delete/#/u/Escape//)

lib/
  auth.ts                       # Auth.js config — credentials provider, multi-user
  db.ts                         # PostgreSQL pool — query<T>(sql, values?)
  imap.ts                       # imapflow wrapper — connect, list, fetch, bulk ops, attachments
  smtp.ts                       # nodemailer wrapper — send, verify
  encrypt.ts                    # AES-256-GCM encrypt/decrypt
  msOAuth.ts                    # Microsoft OAuth2 token refresh
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

### useSearchParams — Suspense requirement (critical)
- Any client component using `useSearchParams()` must be wrapped in `<Suspense>` or Next.js throws a hydration error
- **Pattern for pages**: make `page.tsx` a server component and pass `searchParams` as props to the client component — avoids `useSearchParams` entirely
- **Pattern for layout-level components** (e.g. Sidebar): replace `useSearchParams` with `useEffect + window.location.search`
- Never add `useSearchParams` to a client component without a Suspense boundary

### SWR cache key deduplication
- Multiple components using the same SWR key (e.g. `/api/accounts`) share the cached value from the **first** fetcher registered
- Always use identical fetcher signatures for the same key — if Sidebar returns `{ data: [...] }`, AccountsClient must too (then extract `.data` locally)

### Sidebar — account-scoped SWR keys
- `activeAccountId` is a React state (initialized from `localStorage`, updated via the `synapmail:account-change` custom event)
- Folder list SWR key: `/api/folders?account=<id>` — changing accounts triggers an automatic re-fetch with the correct account's folders
- Never use a static `/api/folders` key in the Sidebar: it would return the default account's folders regardless of which account is active
- Pattern: `useEffect` listens to `synapmail:account-change` → updates `activeAccountId` state → SWR key changes → re-fetch

### i18n (next-intl)
- Locale detection from browser header
- Supported: `en`, `fr`
- Locale prefix: none (default locale = no prefix)
- All user-facing strings in `locales/*.json`
- Server components use `getTranslations()` from `next-intl/server`
- Client components use `useTranslations()` from `next-intl`

### Server-Sent Events (new mail)
- `GET /api/stream` — keeps connection open
- Polls IMAP every 30s per connected account
- Sends `data: { type: 'new_mail', account, count }` events

### Encryption
- Email passwords stored encrypted (AES-256-GCM) using `ENCRYPTION_KEY` env var
- Never store plain passwords

### SWR response shape — CRITICAL
- All API routes return `{ data: T }` or `{ error: string }` — never a bare array or object
- SWR types must match: `useSWR<{ data: Folder[] }>('/api/folders?account=...')`
- Extract locally: `const folders = response?.data ?? []`
- **Never** type SWR as `useSWR<Folder[]>` when the route returns `{ data: [...] }` — the array methods (`.filter`, `.map`) will throw at runtime because you get the wrapper object, not the array

### Bulk IMAP operations
- `lib/imap.ts` exports: `markReadBulk`, `deleteMessagesBulk`, `moveMessagesBulk`, `getAttachmentContent`
- UID sets passed as comma-joined string: `uids.join(',')` with `{ uid: true }` option
- `markReadBulk(account, folder, uids, read)` → `messageFlagsAdd/Remove(['\\Seen'])`
- `deleteMessagesBulk(account, folder, uids)` → `messageDelete(uidSet)`
- `moveMessagesBulk(account, folder, uids, destination)` → `messageMove(uidSet, destination)`
- Bulk API: `PATCH /api/messages/bulk` (mark read/move) + `DELETE /api/messages/bulk`
- Body: `{ uids: string[], action: 'read'|'unread'|'move', accountId, folder, destination? }`

### Drag & drop — email rows to sidebar folders
- `MessageList` rows: `draggable` attribute + `onDragStart` stores `{ uids, accountId, folder }` via `dataTransfer.setData('application/synapmail', JSON.stringify(...))`
- If rows are bulk-selected, dragging any of them drags the entire checked set
- `Sidebar` folders: `onDragOver` checks `e.dataTransfer.types.includes('application/synapmail')`, calls `e.preventDefault()` to allow drop
- `onDrop` parses the JSON, calls `PATCH /api/messages/bulk` with `action: 'move'`
- Highlight drop target: `dragOverPath` state → `bg-blue-500/30 ring-1 ring-blue-400` CSS classes
- No shared state/context needed — all via HTML5 dataTransfer

### Right-click context menu
- `MessageContextMenu` component in `components/ui/MessageContextMenu.tsx`
- `ContextMenuState`: `{ x, y, uid, accountId, isRead, isStarred, folderPath }`
- Position clamped to viewport: `Math.min(menu.x, window.innerWidth - 210)`
- Auto-close: `mousedown` outside ref → `onClose()`, `Escape` key → `onClose()`
- "Move to" submenu: pure CSS `group-hover:block` — no JS state; appears on hover of parent row
- `item()` helper: calls `onClick()` then `onClose()` so menu always dismisses after action

### Keyboard shortcuts
- `hooks/useKeyboardShortcuts.ts` — single `keydown` listener registered in `MailClient`
- Disabled when `isTyping(e)`: checks `INPUT`, `TEXTAREA`, `contentEditable`, Radix select triggers
- Keys: `c`→compose, `r`→reply, `a`→replyAll, `f`→forward, `Delete`/`#`→delete, `u`→markUnread, `/`→focusSearch, `Escape`→closeCompose
- Requires `currentMessage` (set by `ReadingPane.onMessageLoaded`) for message-specific actions
- `searchInputRef` passed from `MailClient` → `MessageList` (via prop) for `/` shortcut

### Draft auto-save
- Only active in `compose` mode (not reply/replyAll/forward)
- Key: `synapmail:draft:${accountId}` in `localStorage`
- Auto-saves To/Cc/Bcc/Subject/body 3 seconds after last change (debounced `setTimeout`)
- On next open: draft restored → "Brouillon restauré ×" badge in title bar
- Draft cleared on: Send, Cancel button, close (×), or manual badge dismiss
- Signature logic: draft content applied to editor after signature is inserted (via `pendingDraftContent` state)

### Desktop notifications — click to open
- `hooks/useEmailNotifications.ts` creates notifications with `tag: \`synapmail-\${uid}\`` for deduplication
- `notification.onclick` dispatches `window.dispatchEvent(new CustomEvent('synapmail:open-message', { detail: { uid, accountId, folder } }))`
- `MailClient` listens for `synapmail:open-message` → calls `handleSelect(uid, accountId)` + `setShowReadingPane(true)`

### Forwarded attachments
- Client sends only descriptors: `{ uid, accountId, folder, partIdx, filename, contentType }[]`
- Server (`/api/send`) re-fetches each attachment from IMAP via `getAttachmentContent(account, folder, uid, partIdx)`
- Returns `{ content: Buffer, filename, contentType }` → passed as nodemailer `attachments` array
- Avoids encoding large files in the client request body

### Custom events (cross-component communication)
- `synapmail:account-change` — emitted by account switcher; Sidebar and MailClient listen to update active account
- `synapmail:compose` — triggers ComposeModal open
- `synapmail:open-message` — emitted by notification click; MailClient opens the message in ReadingPane

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
