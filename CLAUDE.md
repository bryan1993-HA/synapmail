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
    register/page.tsx           # Registration (admin-only after setup)
    invite/[token]/page.tsx     # Accept-invite page for an account-sharing invitation (public route)
    invite/[token]/InviteAcceptClient.tsx  # Preview (GET /api/invites/[token]) + set-password form (POST)
  (app)/
    layout.tsx                  # App layout (requires auth) — three-column shell + `modal` parallel slot
    @modal/
      default.tsx               # null (no modal by default)
      (.)settings/page.tsx              # intercepts /settings → <SettingsModal>
      (.)settings/[...segments]/page.tsx  # intercepts /settings/<sub> → <SettingsModal>
    dashboard/
      page.tsx                  # Server component (auth guard + Suspense)
      DashboardClient.tsx       # Client: bento command center (KPIs, activity chart, focus, receipts, scheduled, rules, follow-ups)
    mail/
      page.tsx                  # Server component (auth guard + Suspense)
      MailClient.tsx            # Client: orchestrates all mail UI, keyboard shortcuts, undo send countdown
    settings/
      layout.tsx                # Settings shell — SettingsSidebar + children
      page.tsx                  # Settings index (server component)
      accounts/
        page.tsx                # Server component — passes searchParams as props (no useSearchParams)
        AccountsClient.tsx      # Client component — list / add (wizard) / edit modes; list is filtered to owned accounts only
        AccountWizard.tsx       # Multi-step wizard: provider grid → credentials → advanced config
        AccountSharesPanel.tsx  # Expandable per-account panel (Share2 icon) — invite form + share list + revoke
        ErrorBoundary.tsx       # React class error boundary for diagnostic output
      appearance/page.tsx       # Theme + language settings
      composition/page.tsx      # Undo send delay
      contacts/page.tsx         # Contact list (search, edit, delete)
      notifications/page.tsx    # Desktop notification toggle
      profile/page.tsx          # Name + password change
      reading/page.tsx          # Reading pane default on/off
      rules/page.tsx            # Email rules (uses RulesClient)
      signatures/page.tsx       # Email signatures
      templates/page.tsx        # Compose templates (Tiptap editor + {{variables}})
      pgp/page.tsx              # PGP end-to-end encryption — generate/backup/import key, import contact keys
      api-keys/page.tsx         # Bearer API keys for machine/agent access — create (shown once) / revoke
    admin/
      users/page.tsx            # Admin: user management
  api/
    auth/[...nextauth]/route.ts
    dashboard/route.ts          # GET aggregated command-center overview (KPIs, unread, activity, focus, receipts, scheduled, rules, follow-ups)
    accounts/route.ts           # GET list — owned UNION ALL active shares, accepts Bearer / POST create email account (session-only)
    accounts/[id]/route.ts      # PATCH update / DELETE remove
    accounts/test/route.ts      # POST test IMAP+SMTP connection
    accounts/[id]/shares/route.ts        # GET list shares / POST invite (owner-only, session-only)
    accounts/[id]/shares/[shareId]/route.ts  # DELETE revoke a share (owner-only, soft — sets revoked_at)
    admin/users/route.ts        # GET list / POST create (admin only)
    admin/users/[id]/route.ts   # PATCH role / DELETE (admin only)
    api-keys/route.ts           # GET list (session-only) / POST create — returns the raw key once
    api-keys/[id]/route.ts      # DELETE revoke (soft — sets revoked_at)
    api-keys/[id]/logs/route.ts # GET recent Bearer requests logged for this key (method, path, IP, timestamp)
    contacts/route.ts           # GET list+search contacts (GET accepts Bearer via lib/apiAuth.ts)
    contacts/[id]/route.ts      # PATCH name / DELETE
    drafts/route.ts             # GET / PUT (upsert) / DELETE — one compose draft per (user, account)
    folders/route.ts            # GET IMAP folder list (accepts Bearer via lib/apiAuth.ts)
    messages/route.ts           # GET list messages (paginated, cached; accepts Bearer)
    messages/send/route.ts      # POST send (immediate or scheduled + forwarded attachments; accepts Bearer)
    messages/search/route.ts    # GET full-text IMAP search (accepts Bearer)
    messages/thread/route.ts    # GET thread by normalized subject (accepts Bearer)
    messages/bulk/route.ts      # PATCH mark read/move + DELETE bulk (accepts Bearer)
    messages/[id]/route.ts      # GET full / PATCH (read, star) / DELETE (accepts Bearer)
    messages/[id]/mdn/route.ts  # POST register received MDN read receipt
    messages/[id]/snooze/route.ts  # POST snooze until date / DELETE un-snooze
    messages/[id]/attachment/[partId]/route.ts  # GET download or inline (?inline=true)
    focus/route.ts              # GET light "à traiter" list (reading-pane empty state; shares lib/focus.ts with dashboard)
    invites/[token]/route.ts    # GET invite preview / POST accept (set name+password, activates the pending user) — public, no auth
    oauth/microsoft/route.ts    # GET initiate OAuth2 flow
    oauth/microsoft/callback/route.ts           # GET OAuth2 callback + token exchange
    pgp/contacts/route.ts       # GET list (+?emails= filter) / POST import a contact's PGP public key
    pgp/contacts/[id]/route.ts  # DELETE remove a contact key
    pgp/me/route.ts             # GET / PUT the user's own PGP public key (server copy — never the private key)
    profile/route.ts            # GET current user / PATCH name + password
    register/route.ts           # POST create user (when REGISTRATION_ENABLED)
    rules/route.ts              # GET list / POST create
    rules/run/route.ts          # POST run all rules now
    rules/import/route.ts       # POST import JSON
    rules/export/route.ts       # GET export JSON
    rules/sieve/route.ts        # GET export Sieve script
    rules/[id]/route.ts         # PATCH update / DELETE
    rules/[id]/test/route.ts    # POST test rule on folder
    scheduled/route.ts          # GET pending scheduled emails
    scheduled/[id]/route.ts     # DELETE cancel
    snoozed/route.ts            # GET pending snoozed messages
    search/route.ts             # GET legacy search endpoint
    settings/route.ts           # GET + PATCH user settings (UPSERT)
    signatures/route.ts         # GET list / POST create
    signatures/[id]/route.ts    # PATCH / DELETE
    stream/route.ts             # GET Server-Sent Events (new mail + scheduler events)
    templates/route.ts          # GET list / POST create
    templates/[id]/route.ts     # PATCH / DELETE
    track/[token]/route.ts      # GET pixel tracker (1×1 GIF + DB log)
    track/status/route.ts       # GET tracking status for a message
    unsubscribe/route.ts        # POST List-Unsubscribe handler

components/
  layout/
    AppShell.tsx                # Three-column shell + mobile drawer
    Sidebar.tsx                 # Accounts + folders + drag-drop + collapsible + unread badges
    MessageList.tsx             # Email list: date groups, density toggle, threads, bulk, drag, context menu, corner quick actions (archive/done/delete/snooze), infinite scroll (IntersectionObserver sentinel)
    ReadingPane.tsx             # Email viewer: body, attachments, SecurityBanner, reply/replyAll/forward; empty state = "à traiter" focus list
    ThreadPane.tsx              # Multi-message thread view
  mail/
    ComposeModal.tsx            # Compose / reply / replyAll / forward + BCC + templates + scheduled + undo send
    EmailTokenInput.tsx         # To/Cc/Bcc token input with contact autocomplete
    MdnToast.tsx                # 30-second toast for received MDN read receipts
    ScheduledPopover.tsx        # Popover listing pending scheduled emails with cancel
    SnoozePopover.tsx           # Toolbar popover listing snoozed messages + "move back to inbox"
    PgpDecryptPrompt.tsx        # Reading-pane "this message is encrypted" passphrase prompt
  pgp/
    PgpSessionProvider.tsx      # In-memory unlocked-private-key session (useRef, never persisted); wraps AppShell
  settings/
    primitives.tsx              # Settings design system — SettingsPage/Header/Section/Row, Toggle, ChoiceCards, Chips, SaveBar (dashboard visual language, violet accent)
    SettingsModal.tsx           # base-ui Dialog shell for the intercepted /settings route (nav rail + panel + close→router.back)
    SettingsModalPanel.tsx      # path segment → settings leaf component (reuses the full-page components)
    RulesClient.tsx             # Rules page: form, drag-drop priority, test, stats
    SettingsSidebar.tsx         # Settings navigation sidebar (full-page fallback; violet active state, i18n via settings.nav)
  providers.tsx                 # React context providers
  ui/
    MessageContextMenu.tsx      # Right-click context menu (mark, star, move, delete)
    ThemeToggle.tsx
    [shadcn components]

hooks/
  useEmailNotifications.ts      # Desktop notifications with click-to-open; settings-aware
  useKeyboardShortcuts.ts       # Global keyboard shortcuts (c/r/a/f/Delete/#/u/Escape//)

lib/
  accounts.ts                   # Account helpers (get by ID, default account) — owner-only, unaffected by sharing
  accountAccess.ts              # getAccessibleAccount(id, userId, required[]) — owner OR active non-expired share, with permissions
  apiAuth.ts                    # authenticate(req) — drop-in for auth() that also accepts Authorization: Bearer <api key>
  auth.ts                       # Auth.js config — credentials provider, multi-user
  contacts.ts                   # Contact extraction from emails + upsert logic
  db.ts                         # PostgreSQL pool — query<T>(sql, values?)
  encrypt.ts                    # AES-256-GCM encrypt/decrypt
  focus.ts                      # "À traiter" heuristic — scoreFocus() + getFocusItems() (shared by /api/dashboard + /api/focus)
  i18n.ts                       # next-intl server config
  imap.ts                       # imapflow wrapper — connect, list, fetch, bulk ops, attachments
  msOAuth.ts                    # Microsoft OAuth2 token refresh
  pgp/
    crypto.ts                   # openpgp.js wrapper — dynamic `import('openpgp')` inside each fn (no top-level import, no server-side import)
    keystore.ts                 # Browser IndexedDB — the private key is generated here and never leaves it
    index.ts                    # Barrel export
  routing.ts                    # next-intl routing config
  rules.ts                      # Rules engine: evaluate conditions + apply actions
  scheduler.ts                  # Scheduled email worker + snooze wake sweep (60s intervals)
  snooze-presets.ts             # Client-side snooze preset times (later/tonight/tomorrow/weekend/next week)
  schedulerEvents.ts            # SSE event emitter for scheduler (scheduled_sent)
  smtp.ts                       # nodemailer wrapper — send, verify
  utils.ts                      # cn() + helpers

instrumentation.ts              # Next.js boot hook — starts scheduler + initDb()

locales/
  en.json                       # English translations
  fr.json                       # French translations

types/
  dashboard.ts                  # DashboardData + widget shapes for /api/dashboard
  contact.ts                    # Contact interface
  email.ts                      # Message, Folder, Attachment, EmailAddress, Thread
  account.ts                    # EmailAccount, Signature, User, ApiKey (never carries the raw key or its hash)
  api.ts                        # API response types
  rule.ts                       # Rule, RuleCondition, RuleAction interfaces
  template.ts                   # ComposeTemplate interface
  pgp.ts                        # PgpContactKey, PgpIdentity interfaces

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
users (id, email, name, password_hash, role, avatar_url, status, created_at)
  role: 'admin' | 'user'
  status: 'active' | 'pending'  -- 'pending' = auto-created by an account-share invite, not yet
    -- accepted; login is blocked (lib/auth.ts authorize()) until POST /api/invites/[token] sets
    -- a real password_hash and flips this to 'active'

-- Email accounts per user
email_accounts (id, user_id, name, email, imap_host, imap_port, imap_secure,
                smtp_host, smtp_port, smtp_secure, username, password_encrypted,
                oauth_provider, oauth_access_token, oauth_refresh_token, oauth_expires_at,
                is_default, color, created_at)

-- Email signatures
signatures (id, user_id, account_id, name, content_html, is_default, created_at)

-- Cached message metadata (fast list + unread badges + rule matching)
messages_cache (id, account_id, folder, uid, message_id, from_address, from_name,
                subject, date, is_read, is_starred, is_flagged, has_attachments,
                preview, thread_id, cached_at)

-- App settings per user
user_settings (user_id, theme, language, messages_per_page, thread_view,
               reading_pane, notifications, undo_send_delay, start_view,
               active_account_id, sidebar_collapsed, mail_density, list_width,
               dashboard_account_id, updated_at)
  start_view: 'inbox' | 'dashboard'   -- landing view; '/' redirects accordingly
  -- active_account_id / sidebar_collapsed / mail_density / list_width / dashboard_account_id
  -- replace what used to live in localStorage — see "UI state persistence" below

-- Compose drafts — one per (user, account), replaces the old localStorage draft
drafts (id, user_id, account_id, to_addresses, cc_addresses, bcc_addresses,
        subject, body_html, updated_at)
  UNIQUE(user_id, account_id) — compose mode only (reply/forward never persist a draft)

-- API keys for machine/agent access (Bearer auth) — server stores only the SHA-256 hash
api_keys (id, user_id, name, key_prefix, key_hash, last_used_at, revoked_at, created_at)
  key_prefix: first 12 chars of the raw key, shown in the UI to identify a key
  key_hash: SHA-256 of the raw key (not bcrypt — needs an indexed WHERE key_hash = $1 lookup)
  -- the raw key itself is shown to the user exactly once, at creation (POST /api/api-keys)

-- Per-key request log for Bearer auth — method + path + IP, not response status/body
api_key_requests (id, api_key_id, method, path, ip_address, created_at)
  -- written fire-and-forget by lib/apiAuth.ts authenticate() on every successful Bearer auth
  -- (session-cookie requests are never logged here). Purged past 30 days by the scheduler
  -- (lib/scheduler.ts processApiKeyLogCleanup, every 6h). Index on (api_key_id, created_at DESC).

-- Account sharing — an owner grants another user fine-grained per-action access to one
-- of their email_accounts, by email invitation (auto-creates a pending user if unknown)
account_shares (id, account_id, invited_by, invitee_user_id, status, invite_token_hash,
                can_send, can_delete, can_organize, can_manage_rules, can_manage_signatures,
                expires_at, accepted_at, revoked_at, created_at)
  status: 'pending' | 'active' | 'revoked' | 'expired'
  -- no can_read column: an active, non-expired row IS read access — see lib/accountAccess.ts
  -- invite_token_hash: SHA-256 of a syn_-less random token (api_keys pattern), NULL once accepted
  -- unique partial index on (account_id, invitee_user_id) WHERE status IN ('pending','active') —
  -- re-inviting the same person upserts permissions in place; re-inviting after a revoke inserts a new row
  UNIQUE(account_id, invitee_user_id) WHERE status IN ('pending', 'active')

-- Scheduled emails
scheduled_emails (id, account_id, user_id, from_address, to_addresses, cc, bcc,
                  subject, body_html, attachments_json, scheduled_at,
                  status, sent_at, error, created_at)
  status: 'pending' | 'sent' | 'failed'

-- Read receipt tracking
sent_tracking (id, account_id, message_id, token, recipient_email,
               opened_at, mdn_received_at, created_at)

-- Email filter rules
email_rules (id, account_id, user_id, name, enabled, logic, conditions_json,
             actions_json, priority, run_count, last_run_at, created_at)
  logic: 'AND' | 'OR'
  conditions: [{ field, operator, value }]
  actions: [{ type, value }]

-- Rule execution log
rule_execution_log (id, rule_id, account_id, folder, uid, action, executed_at)

-- Compose templates
compose_templates (id, account_id, user_id, name, subject, body_html, created_at, updated_at)

-- Contacts (auto-extracted from emails)
contacts (id, account_id, user_id, email, name, frequency, last_seen, created_at)

-- Snoozed messages (Direction B) — message hidden from the list until snooze_until
snoozed_messages (id, user_id, account_id, folder, uid, subject, from_address, from_name,
                  snooze_until, created_at)
  UNIQUE(account_id, folder, uid) — scheduler DELETEs expired rows every 60s

-- Authoritative per-folder unread counts (server-side IMAP SEARCH UNSEEN)
mailbox_stats (account_id, folder, unread_count, synced_at)
  PRIMARY KEY(account_id, folder)
  -- written by lib/imap.ts listMessages on page 1; NOT capped by page size
  -- (unlike counting messages_cache rows). Read by GET /api/accounts + /api/folders.

-- PGP end-to-end encryption — server stores PUBLIC keys only, never private keys
pgp_public_keys (id, user_id, email, name, fingerprint, armored_key, created_at)
  UNIQUE(user_id, email) — a contact's manually-imported public key

user_pgp_identity (user_id, fingerprint, armored_public_key, created_at, updated_at)
  PRIMARY KEY(user_id) — server copy of the user's OWN public key (upserted, like user_settings)
  -- the private key is generated client-side and lives ONLY in browser IndexedDB (lib/pgp/keystore.ts);
  -- it is never sent to or stored on the server, under any column, in any table.
```

---

## Critical Technical Points

### Auth.js v5
- Credentials provider: email + password (bcrypt)
- `trustHost: true` mandatory behind reverse proxy
- Role stored in JWT token (`token.role`)
- Admin role required for `/admin/*` routes and user creation

### API key auth (Bearer) — machine/agent access
- `lib/apiAuth.ts` → `authenticate(req)` is a drop-in replacement for `auth()` in API routes: tries the NextAuth session cookie first, then falls back to `Authorization: Bearer <key>` looked up against `api_keys`. Returns the same `{ id, role }` shape either way, so route bodies (`WHERE ... AND user_id = $N`) don't change — that SQL predicate is what actually enforces per-account isolation, for both auth methods.
- Keys are generated as `syn_` + 32 random hex bytes, shown to the user **once** at creation (`POST /api/api-keys`), never stored or logged in cleartext. The server stores only `key_hash` (SHA-256 — not bcrypt, since a Bearer request needs an indexed `WHERE key_hash = $1` lookup by an *unknown* key; bcrypt's random salt makes that impossible) and `key_prefix` (first 12 chars, shown in the UI to identify a key).
- `middleware.ts` (Edge runtime) cannot query Postgres, so it only checks that *either* the session cookie *or* an `Authorization: Bearer` header is present before letting `/api/*` requests through — the actual hash lookup happens in the Node.js route handler via `authenticate()`.
- **Which routes accept a key**: the single source is `ROUTE_SCOPES` in `lib/apiScopes.ts` (one scope per `METHOD /path`), mirrored route by route in `docs/API.md` (🔑 Bearer headings) and `docs/openapi.json` — `scripts/check-api-docs.mjs` fails when the three drift. Beyond the original read/write mail lot (accounts, folders, messages, search, thread, send, bulk, contacts) it covers subscriptions and `POST /api/ai/action` (`ai:use`, `content` + `context` capped at `AI_CONTENT_MAX_CHARS` since every call is billed to the user's own provider). Admin, PGP, settings/rules/templates/signatures CRUD, OAuth, SSE, track/unsubscribe stay session-only.
- Manage keys in Settings → Clés API (`app/(app)/settings/api-keys/page.tsx`): create (name only, raw key shown once in a copyable box), list (name, prefix, last used, 24h request count), revoke (soft — sets `revoked_at`, key stops working immediately), and per-key activity (expandable panel → `GET /api/api-keys/[id]/logs`, last 50 requests: method, path, IP, timestamp).
- **Per-key request logging**: every successful Bearer auth (not session-cookie requests) writes a fire-and-forget row to `api_key_requests` (method, path, IP — `lib/apiLog.ts` `clientIp()`: the **last** hop of `X-Forwarded-For`, the one the trusted proxy appended, then `X-Real-IP`; the single reader of those headers in the app, timestamp) from inside `authenticate()` — same fire-and-forget pattern as the existing `last_used_at` update, right next to it. `GET /api/api-keys` joins a 24h `COUNT` per key (`requestCount24h`); `GET /api/api-keys/[id]/logs?limit=` (session-only, ownership-checked) returns the raw rows for one key, newest first, capped at 200. `lib/scheduler.ts` → `processApiKeyLogCleanup()` purges rows older than 30 days every 6h (plus one pass 30s after boot) so the table can't grow unbounded on a busy key. Logs the request line only — not the response status or body.
- No rate-limiting yet — a follow-up if a single key starts driving heavy traffic across many accounts.

### Account sharing — fine-grained access delegation
- **Access model**: `lib/accountAccess.ts` → `getAccessibleAccount(accountId, userId, required[])` is the single choke point — owner OR an `account_shares` row with `status='active'` and `(expires_at IS NULL OR expires_at > NOW())`. It replaced the ~16 previously-inline `SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2` call sites across `messages/*`, `folders`, `rules/*` (see each route for its required permission). The owner gets all permissions implicitly; a delegate gets exactly their row's `can_*` columns. Missing a required permission returns `null` — same 404 shape as "account not found", never leaking existence. `PATCH`/`DELETE /api/accounts/[id]` and the shares routes themselves stay strictly owner-only (never via `getAccessibleAccount`) — a delegate can never edit credentials or manage sharing, regardless of granted permissions.
- **Permissions**: `canSend`, `canDelete`, `canOrganize` (mark read/star/move/snooze), `canManageRules`, `canManageSignatures` — five independent booleans per share, no bundled "read/write" toggle. There is no `canRead`: an active non-expired share IS read access. Contacts and `compose_templates` are **never** shared — neither table has an `account_id` column, both stay scoped to the acting user.
- **Invitation flow** (`POST /api/accounts/[id]/shares`, owner-only): looks up the invited email in `users`. If found, the share activates immediately (`status='active'`, no token) and a notification email goes out. If not found, a `users` row is created on the spot (`status='pending'`, unguessable bcrypt placeholder password) together with a `pending` share carrying a `syn_`-style random token (`crypto.randomBytes(24)`, only its SHA-256 stored in `invite_token_hash` — same pattern as `api_keys`), and an invite email with an accept link goes out. Both emails are relayed through **the shared account's own SMTP credentials** (`lib/smtp.ts` `sendMail()`, decrypted exactly like `lib/scheduler.ts` does) — there is no system-level SMTP config. `POST` upserts on `(account_id, invitee_user_id)` when a pending/active share already exists (so re-inviting the same person just updates permissions); a revoked/expired prior share doesn't block a fresh invite (partial unique index only covers `pending`/`active`).
- **Acceptance** (`GET`/`POST /api/invites/[token]`, public — `/invite` and `/api/invites` are in `middleware.ts` `PUBLIC_PATHS`): `GET` previews the invite (account email, owner name) for `app/(auth)/invite/[token]/page.tsx`. `POST` sets the invitee's real name/password (`bcrypt.hash(password, 12)`, same cost as self-registration), flips `users.status` and the share's `status` to `active`, and clears `invite_token_hash` (single-use). `lib/auth.ts` `authorize()` refuses login while `users.status !== 'active'`.
- **Expiration**: the live `expires_at` check inside `getAccessibleAccount` is the actual enforcement — always correct even if the cleanup job hasn't run yet. `lib/scheduler.ts` → `processExpiredShares()` (every 5 min, alongside `processRules`) just flips stale rows to `status='expired'` so the owner's share list stops showing a dead "active" badge.
- **Delegate visibility**: `GET /api/accounts` is now a `UNION ALL` of owned accounts and active-share accounts, both branches emitting the same `permissions` object (owned = all `true`) plus `isShared`/`ownerName`/`expiresAt` (`null` for owned rows). A shared account is **never** an implicit default (`isDefault` forced `false`) and never comes back from the plain "no accountId given → pick my default account" queries used across the message/folder routes — a delegate must always pass an explicit `accountId`. Settings → Comptes (`AccountsClient.tsx`) filters shared accounts *out* of its list (credentials aren't theirs to edit); the Sidebar account switcher shows them with a violet "Partagé par {owner}" line instead.
- **Mail UI gating** (`MessageList.tsx`, `ReadingPane.tsx`, `ComposeModal.tsx`): each accepts an optional `permissions`/`canSend` prop, defaulting fully-permissive so owned-account behavior is unchanged. This is UX-only — hides/disables buttons that would otherwise 403 (send, delete, mark/move/snooze, drag-to-move). The real boundary is always `getAccessibleAccount` server-side.
- **SSE**: `account_share_accepted` event (`lib/schedulerEvents.ts` + `app/api/stream/route.ts`) fires when an invite is accepted, filtered by owner id — wired end-to-end but no toast consumes it yet (follow-up).
- **Not yet built**: a delegate has no UI path to reach a shared account's rules/signatures pages (the mutation routes are permission-gated, but `getRulesForUser`/signatures GET are still scoped by owner, and neither settings page has an account switcher for a non-owner) — a delegate can act on rules/signatures only through the API directly, not the Rules/Signatures settings pages yet.

### IMAP (imapflow)
- Connection pool per account — reuse where possible
- Always `client.logout()` after each operation
- UID-based operations (not sequence numbers) for reliability
- Folder names with spaces need quoting: `"[Gmail]/All Mail"`
- **Cache reconcile**: `listMessages` only INSERT/UPDATEs `messages_cache`; on page 1 it also runs `SEARCH ALL` (uid) and DELETEs cache rows whose UID is no longer live (fire-and-forget). Without this, messages moved/deleted elsewhere leave ghost `is_read=false` rows that pollute the focus list and unread counts.
- **Authoritative unread count**: on page 1 `listMessages` also runs `SEARCH UNSEEN` and UPSERTs the count into `mailbox_stats(account_id, folder)`. This is the number the sidebar account badges / folder list use (via `GET /api/accounts` + `/api/folders`, `COALESCE(mailbox_stats, cached-row count, 0)`) — it is **not** capped by `perPage` the way counting `messages_cache` rows is, so a folder with 300 unread reports 300. Both searches are cheap (UID lists, no body fetch) and run on the already-open mailbox.

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
- `activeAccountId` is a React state (initialized from `user_settings.active_account_id` via `/api/settings`, updated via the `synapmail:account-change` custom event)
- Folder list SWR key: `/api/folders?account=<id>` — changing accounts triggers an automatic re-fetch with the correct account's folders
- Never use a static `/api/folders` key in the Sidebar: it would return the default account's folders regardless of which account is active
- Pattern: `useEffect` listens to `synapmail:account-change` → updates `activeAccountId` state → SWR key changes → re-fetch
- **Account dropdown (expanded mode)**: rendered as an `absolute z-50` overlay inside the `relative` account-switcher wrapper — never in the flex flow (an in-flow list of N accounts would crush the `flex-1` folder nav and get clipped by the shell's `overflow-hidden`). Height capped `max-h-[min(60vh,22rem)]` + `overflow-y-auto overscroll-contain`; a filter `<input>` (`mail.searchAccounts`) appears when `accounts.length > 8`; closes on outside `mousedown` / `Escape` (effect gated on `accountOpen`). Colour index must stay `accounts.indexOf(acc)` (not the filtered map index) so a filtered row keeps its real colour. Style mirrors the ComposeModal signature picker: `rounded-xl` + `shadow-xl` + violet `Check` on the active row + `hover:bg-violet-500/10` (kept on the dark `zinc-900` surface — the sidebar is always dark, so it does **not** use the light-theme `bg-popover` tokens).
- **Account rows show name + email + unread**: line 1 = `acc.name` (falls back to `acc.email` when blank), line 2 = `acc.email` in `text-[11px] text-zinc-500`, plus a violet unread pill from `acc.unreadCount`. `unreadCount` = top-level `INBOX` unread, served by `GET /api/accounts` as `COALESCE(mailbox_stats.unread_count, cached-row count, 0)` (authoritative `SEARCH UNSEEN`, see IMAP section; partial index `messages_cache_unread_idx` backs the fallback). Same shape on the trigger button; the trigger's pill shows `otherUnread` (= total − active account) so it doesn't duplicate the active account's INBOX folder badge. Collapsed mode: the account dot gets a small `otherUnread` badge.
- **Freshness**: the `/api/accounts` SWR uses `refreshInterval: 60000` + `revalidateOnFocus: true` so the per-account unread badges update while the switcher is closed. `mailbox_stats` for every account's INBOX is refreshed by the scheduler's `processInboxSync()` (every 3 min, see Scheduled send section) — not just the account currently open. The count is exact regardless of mailbox size (`SEARCH UNSEEN`), unlike the dashboard/focus counts which still read `messages_cache` rows.

### i18n (next-intl)
- Locale detection from browser header
- Supported: `en`, `fr`
- Locale prefix: none (default locale = no prefix)
- All user-facing strings in `locales/*.json`
- Server components use `getTranslations()` from `next-intl/server`
- Client components use `useTranslations()` from `next-intl`
- Language change: write locale cookie → page reload → next-intl middleware picks it up

### Server-Sent Events (scheduler push)
- `GET /api/stream` — keeps the connection open, 25s `ping` keep-alive
- Forwards `lib/schedulerEvents` emitter events to the client, filtered by `userId`: `scheduled_sent` (a scheduled mail went out) and `rule_applied` (a background rule matched)
- Does **not** poll IMAP itself. New-mail freshness comes from (a) the client's own 60s SWR `refreshInterval` on `/api/messages` and `/api/accounts`, and (b) the scheduler's background inbox sync (see below)

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
- Persisted server-side in the `drafts` table, one row per (user, account) — `GET/PUT/DELETE /api/drafts?accountId=`
- Auto-saves To/Cc/Bcc/Subject/body 3 seconds after last change (debounced `setTimeout` → `PUT`)
- On next open (any device/browser): draft restored → "Brouillon restauré ×" badge in title bar
- Draft cleared on: Send, Cancel button, close (×), or manual badge dismiss — all via `clearDraft()` (`DELETE /api/drafts?accountId=`)
- Signature logic: draft content applied to editor after signature is inserted (via `pendingDraftContent` state)

### Desktop notifications — click to open
- `hooks/useEmailNotifications.ts` creates notifications with `tag: \`synapmail-\${uid}\`` for deduplication
- `notification.onclick` dispatches `window.dispatchEvent(new CustomEvent('synapmail:open-message', { detail: { uid, accountId, folder } }))`
- `MailClient` listens for `synapmail:open-message` → calls `handleSelect(uid, accountId)` + `setShowReadingPane(true)`
- Settings-aware: `notificationsEnabled` read from SWR `/api/settings`; gates both permission request and notification creation

### Forwarded attachments
- Client sends only descriptors: `{ uid, accountId, folder, partIdx, filename, contentType }[]`
- Server (`/api/messages/send`) re-fetches each attachment from IMAP via `getAttachmentContent(account, folder, uid, partIdx)`
- Returns `{ content: Buffer, filename, contentType }` → passed as nodemailer `attachments` array
- Avoids encoding large files in the client request body

### Scheduled send
- ComposeModal passes `scheduledAt: ISO string` to `POST /api/messages/send`
- Route saves to `scheduled_emails` (status: 'pending') instead of calling SMTP immediately
- `lib/scheduler.ts` runs every 60s: `SELECT ... FOR UPDATE SKIP LOCKED` fetches due rows, sends via SMTP, marks sent, emits `scheduled_sent` SSE event
- Same file also runs `processSnoozes()` every 60s (DELETE expired `snoozed_messages`) and `processRules()` every 5 min (all accounts with enabled rules)
- **`processInboxSync()` every 3 min** (`SYNC_FOLDERS` / `SYNC_PAGE_SIZE` / `SYNC_INTERVAL_MS` consts) — loops **every** `email_accounts` row and calls `listMessages(cfg, 'INBOX', 1, 50, 'all', userId)`, which upserts + reconciles `messages_cache` **and** UPSERTs the authoritative `SEARCH UNSEEN` count into `mailbox_stats` (page 1). This keeps the per-account unread badges fresh for accounts the user never opens. `filter: 'all'` (not `'unread'`) so recently-read messages also get flipped in cache. Errors are caught per account. One extra pass fires 15s after boot. The 50-message window only bounds `messages_cache` (list/focus content) — the unread *count* in `mailbox_stats` is exact.
- `instrumentation.ts` starts the scheduler at process boot (Next.js 14 `experimentalInstrumentationHook`) — independent of any user session

### Mail list — Direction B (date groups, density, corner actions, snooze)
- **Date groups**: `MessageList` buckets threads by the last message's date (`grpToday`/`grpYesterday`/`grpThisWeek` <7d/`grpThisMonth` <30d/`MMMM yyyy`). Sticky headers (`sticky top-0` inside the scroll container). Disabled in search mode.
- **Density**: `user_settings.mail_density` = `'comfortable' | 'compact'`, read/written via the shared `/api/settings` SWR key (see "UI state persistence"). Compact = tighter rows, `w-7` avatars, preview line hidden. Segmented toggle in the toolbar.
- **Row layout**: grid `[avatar] [content]`, `position: relative`. Corner action strip is `absolute top-1.5 right-2` (out of the subject flow — objet/aperçu keep full width); line 1 gets `pr-[104px]`/`pr-[80px]` to clear it. Actions: Archiver (only if an archive folder is name-matched via `/archives?/i`), Marquer traité / non lu, Supprimer, Reporter. Always visible (no hover-only).
- **Avatars**: hashed color for unread, neutral `bg-muted` for read.
- **Snooze**: per-row preset menu (`lib/snooze-presets.ts`). `POST /api/messages/[id]/snooze` UPSERTs `snoozed_messages`; the row is optimistically removed. `GET /api/messages` filters out non-expired snoozed UIDs (and adjusts `total`). `lib/scheduler.ts` → `processSnoozes()` DELETEs expired rows every 60s; the message reappears on the next list poll (60s `refreshInterval`). Toolbar `SnoozePopover` lists pending snoozes + "move back to inbox" (`DELETE …/snooze`). Custom event `synapmail:snooze-changed` refreshes the popover.
- **Reading-pane empty state**: `ReadingPane` (`!uid` branch) fetches `GET /api/focus?account=` and renders the top-5 "à traiter" list with reason chips; clicking dispatches `synapmail:open-message` **with `folder`** — `MailClient` navigates to that folder (`router.push`) before opening, so a focus item outside the current folder still loads. Scoring is shared with the dashboard via `lib/focus.ts` (`scoreFocus`). `ReadingPane`'s `fetcher` throws on `!res.ok` / `{ error }` bodies and shows a recoverable state (never renders a half message).
- **Infinite scroll**: no "load more" button. A sentinel `<div>` at the list bottom is watched by an `IntersectionObserver` (`root` = the `overflow-y-auto` container via `scrollRef`, `rootMargin: '600px 0px'`) that runs `setPage(p => p + 1)` before the user reaches the end. `loadingLockRef` (a ref holding the last page auto-requested) + the `!isValidating` guard keep exactly one page in flight; the chain self-stops when the viewport is full or `messages.length >= total`. The sentinel is still a real `<button>` (keyboard / observer-failure fallback) showing `mail.messagesRemaining` or a `mail.loadingMore` spinner; a page > 1 fetch error swaps it for a `retry` button (`morePageError`); once fully loaded it shows `mail.endOfList`. Disabled in search mode (`canLoadMore` gates on `!isSearchMode && !error`). `loadingLockRef` is reset to 0 on folder/account change, filter change and manual refresh — same places that reset `page`/`accumulated`. Pre-existing limitation unchanged: SWR's 60s `refreshInterval` only revalidates the highest page key, so earlier pages don't auto-refresh (migrate to `useSWRInfinite` if that matters).

### Compose modal — visual identity ("Aurora")
- `ComposeModal` follows the **"Aurora — verre dépoli sur aurore"** direction (chosen from 4 mockups): opaque `bg-card` panel, `rounded-[24px]`, inset light ring for the glass edge, big soft shadow. **Never put `backdrop-blur` on the panel** — it smears the bright app content behind it into the body (unreadable). The blur lives only on the scrim (`bg-background/80 backdrop-blur-lg`).
- Ambient **aurora** = 3 drifting radial blobs (violet/fuchsia/cyan, alpha ≤ 0.14) in the fixed backdrop, only visible in the margin around the panel. Drift keyframe `synap-aurora-drift` in `app/globals.css`, frozen by `prefers-reduced-motion`.
- Field rows use the module const `FIELD_ROW` (inset pill; `focus-within` → solid violet border + `ring-2 ring-violet-500/40`). Bands (`bg-muted/40`), hovers (`hover:bg-muted`), active toggles (`bg-violet-500/20`) all go through theme tokens — must stay legible in light **and** dark.
- The **"De" account picker** is a custom dropdown (`showFromDropdown` / `fromDropdownRef`, opens `top-full`), mirroring the signature picker — not a native `<select>`.
- Width `max-w-[820px]`; toolbar + footer buttons are 28px so both rows stay single-line.

### Undo send
- `MailClient` holds `undoSendDelay` read from `/api/settings`; passes to `ComposeModal`
- On "Send" click: modal closes, countdown toast renders for `undoSendDelay` seconds; actual `fetch('/api/messages/send')` fires after the delay via `setTimeout`
- "Cancel" calls `clearTimeout`, reopens ComposeModal with original content intact
- Only applies to immediate sends (not scheduled)

### Email rules engine
- `lib/rules.ts` — `evaluateRule(rule, message)` checks all conditions (AND/OR logic); `applyAction(action, message, account)` executes via IMAP or SMTP
- Conditions: `from`, `to`, `subject`, `body`, `has_attachment`, `size_gt`, `size_lt`, `is_unsubscribe`, `is_priority`
- Actions: `move`, `mark_read`, `star`, `delete`, `forward`
- `runAllRules(userId)` called by scheduler every 5 min + available on demand via `POST /api/rules/run`
- Execution logged to `rule_execution_log`; per-rule stats shown in RulesClient

### Compose templates
- `compose_templates` DB table; CRUD via `/api/templates`
- Templates support `{{variable}}` placeholders — resolved via inline modal form before inserting into Tiptap
- ComposeModal footer dropdown (bottom-full) avoids `overflow-hidden` toolbar clipping
- "Save as template" (`BookmarkPlus`) button saves current compose content

### Read receipts (sent tracking)
- On send: if tracking enabled, a unique `token` is generated; 1×1 GIF `<img>` injected into email HTML; `Disposition-Notification-To` header added
- `GET /api/track/[token]` — returns the GIF + logs `opened_at` in `sent_tracking`; no redirect, no JS
- `POST /api/messages/[id]/mdn` — called when MDN reply is received; matched by subject+account_id (handles Outlook message-ID rewriting)
- `MdnToast` shows a 30-second toast on MDN receipt
- Eye icon shown in Sent list when `opened_at` is set

### Security / Phishing detection
- ReadingPane parses `Authentication-Results` header for SPF/DKIM/DMARC
- Display-name spoofing: 30+ brands matched via keyword multi-alias map; Reply-To mismatch also flagged
- Lookalike domains: pure-JS Levenshtein distance against brand canonical domains
- Deceptive links: DOM parser checks `<a>` visible text vs `href` domain before iframe render
- `SecurityBanner` component: green (all pass) / orange (missing) / red (fail or spoofing); sender highlighted in red when spoofing detected
- Dangerous attachments: `.exe .scr .vbs .bat .js .jar .ps1` → red warning badge
- Urgency keywords in subject → badge in ReadingPane header

### Contact autocomplete
- `lib/contacts.ts` — `extractAndSaveContact()` uses `ON CONFLICT DO UPDATE` with `xmax` check to track frequency; noreply blocklist applied
- `EmailTokenInput` component: token chips with ×, typeahead from `/api/contacts?q=`, keyboard navigation (↑↓ Enter Backspace)
- Used in ComposeModal for To/Cc/Bcc fields

### PGP end-to-end encryption
- **Trust model**: 100% client-side. The private key is generated in the browser (`lib/pgp/crypto.ts` → `generateKeypair()`, openpgp.js) and stored only in browser IndexedDB (`lib/pgp/keystore.ts`), passphrase-protected by openpgp.js itself at generation time. It is never sent to or stored on the server, and never appears in any Postgres table. The server stores only PUBLIC keys (`pgp_public_keys` for contacts, `user_pgp_identity` for the user's own key) — public keys are not secret.
- **Bundle size**: `openpgp` (~1MB min) is never imported at the top level of any file — `lib/pgp/crypto.ts` does `await import('openpgp')` inside each function body, so it code-splits into its own chunk and only loads when a PGP action actually runs (verified: it does not appear in the `/mail` or `/settings/pgp` page bundles' static size, only as a separate lazy chunk). `isInlinePgpMessage()`/`extractInlinePgpMessage()` are plain regexes with no openpgp import, so ReadingPane can call them on every render for free.
- **Scope (MVP)**: manual key exchange only — no WKD/keyserver auto-discovery, no PGP/MIME (inline ASCII-armored block only), no attachment encryption, no multi-device private-key sync (export/import the encrypted private-key backup `.asc` file manually via Settings → PGP Encryption).
- **Settings page** (`app/(app)/settings/pgp/page.tsx`): "My key" card generates a keypair (name/email prefilled from `/api/profile`, passphrase + confirm), publishes the public half to `PUT /api/pgp/me`, and offers download of the public key / the still-passphrase-protected private key backup, plus import of a backup on a new browser. "Contact keys" card imports a contact's public key (paste or `.asc` upload, parsed client-side via `readPublicKeyInfo()` before `POST /api/pgp/contacts`).
- **Compose** (`ComposeModal.tsx`): an "Encrypt" toggle (`encrypted` state, `Lock` icon next to the read-receipt toggle) appears only when every current To/Cc/Bcc recipient has a known key (`GET /api/pgp/contacts?emails=`, SWR). Turning it on forces `requestReadReceipt=false` (disabled while encrypted — the tracking-pixel injection in `/api/messages/send` only ever touches the `html` field, which stays empty for an encrypted send). `handleSend`'s encrypted branch uses `editor.getText()` (plain text only — no rich formatting survives inline PGP) + a flattened plain-text quote, encrypts to all recipients **plus the sender's own public key** (`GET /api/pgp/me` — "encrypt to self", so the Sent-folder copy stays readable), and puts the armored block in `payload.text` (never `payload.html`) via `encryptText()`. Forwarding with attachments is blocked client-side while encrypted (no attachment encryption in this MVP).
- **Reading** (`ReadingPane.tsx` → `EmailBody`): before the existing iframe/`<pre>` branching, checks `isInlinePgpMessage()` against `message.bodyPlain` (falling back to tag-stripped `bodyHtml`). A match renders `PgpDecryptPrompt` instead — passphrase entry unlocks the local private key via `PgpSessionProvider` (`unlockPrivateKey()`, session-scoped `useRef`, never persisted, cleared on tab close/reload) and decrypts with `decryptText()`; a second encrypted message in the same tab reuses the already-unlocked session key without re-prompting. Decrypted plaintext renders in a `<pre>`, never fed back into the HTML iframe or sent to the server.
- **`PgpSessionProvider`** wraps `<AppShell>` in `app/(app)/layout.tsx`, so both `/mail` and `/settings/pgp` (full page and intercepted modal) share one unlock session per tab.

### Settings persistence
- `user_settings` table UPSERT via `PATCH /api/settings`
- `initDb()` in `instrumentation.ts` ensures all tables exist at boot (idempotent)
- Theme: next-themes cookie; Language: locale cookie → picked up by next-intl middleware on next request
- `MailClient` reads settings via SWR `/api/settings`; `settingsPaneInitialized` ref prevents overwriting user's in-session toggle

### UI state persistence — no localStorage
- Every piece of app UI state that used to live in `localStorage` (sidebar collapsed, mail density, list column width, active account, dashboard account filter) is now a column on `user_settings`, read/written through the same shared `/api/settings` SWR key.
- Pattern for a write: `mutate('/api/settings', curr => ({ data: { ...curr.data, <field>: <value> } }), false)` (optimistic, no revalidation) immediately followed by `fetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ <field>: <value> }) }).then(() => mutate('/api/settings'))` (revalidate once the write lands) — `mutate` imported as `import { mutate as globalMutate } from 'swr'` wherever a component already has its own local `mutate` from a different `useSWR()` call, to avoid shadowing.
- Because every consumer shares the same `/api/settings` SWR cache, a change in one component (e.g. Sidebar switching accounts) is reflected instantly in every other subscriber in the same tab — no custom event needed for that. `synapmail:account-change` is kept anyway for `MailClient`'s side effects (resetting selection state), not for propagating the value itself.
- This also fixes a pre-existing multi-tab desync bug: with `localStorage`, two tabs never saw each other's changes (`CustomEvent` doesn't cross tabs); with SWR + `revalidateOnFocus`, focusing a stale tab now picks up the latest value.
- Compose drafts are data, not a preference, so they live in their own `drafts` table instead — see "Draft auto-save" below.

### Settings — modal (intercepting route) + full-page fallback
- Soft-navigation to `/settings` or `/settings/<sub>` from inside the app opens the settings area as a **modal over the current page** (Gmail/Linear style). Hard load / direct visit / refresh renders the normal full page.
- Mechanism: parallel slot `app/(app)/@modal` (declared in `app/(app)/layout.tsx` as the `modal` prop, `@modal/default.tsx` → `null`) + intercepting routes `@modal/(.)settings/page.tsx` and `@modal/(.)settings/[...segments]/page.tsx`, both rendering `<SettingsModal>`.
- `components/settings/SettingsModal.tsx` = base-ui `Dialog` shell (centered ~1000px window, left nav rail / mobile top strip, ESC + backdrop close → `router.back()`). `SettingsModalPanel.tsx` maps the path segment to the **same leaf component** the full-page route uses (`AccountsClient`, `RulesClient`, `AISettingsClient`, and the `'use client'` `page.tsx` defaults) — server wrappers that only read searchParams / guard auth are bypassed (auth is enforced by the `(app)` layout; searchParams read via `useSearchParams`).
- `app/(app)/settings/page.tsx` renders `<ProfilePage/>` directly (no `redirect()` — a redirect would promote the URL and double-render the full page under the modal). Known cost of the pattern: while the modal is open the matching full-page route still renders behind it (hidden); SWR dedupes the network.

### Settings UI — design system (`components/settings/primitives.tsx`)
- All config pages share the dashboard visual language: `rounded-2xl border bg-card/80 shadow-sm backdrop-blur-sm` cards, violet accent, icon-tile page headers, `motion-safe:animate-in` entrance.
- Primitives are **i18n-free** — pages pass translated label props. Keys live under `settings.nav`, `settings.common`, `settings.{page}` in both locales.
- `SaveBar` is the standard footer (sticky, dirty/saving/saved states). Pages compute `dirty` by diffing local state vs the SWR-loaded settings; `submit` variant drives a `<form>` (profile).
- **Phase 1** (config pages on primitives + i18n): profile, appearance, reading, notifications, composition + SettingsSidebar. The `notifications` and `reading_pane` toggles were previously "Bientôt disponible" placeholders but were already wired (`useEmailNotifications`, `MailClient`) — now live.
- **Phase 2** (CRUD pages on the shared frame): accounts, signatures, templates, contacts, rules (`RulesClient`), ai (`AISettingsClient`), api-keys now use `SettingsPage` + `SettingsHeader` (icon tile, violet accent) and the `rounded-2xl bg-card/80 shadow-sm` card / `bg-card shadow-sm` list-row style. Internal logic (Tiptap editors, drag-drop, wizard, rule editor) untouched. i18n of the CRUD page bodies is still partial (strings hardcoded FR pre-refonte) — separate follow-up, `api-keys` included (its nav label is translated, its body is not, matching the rest of Phase 2).
- Reference mockup: `claude.ai/code/artifact/b87828af-6602-445e-a0a2-40e786da638c`

### Dashboard / command center (`/dashboard`)
- Renders inside `AppShell` (Sidebar + full-width content) — NOT the 3-column mail shell
- `GET /api/dashboard` = one aggregation route: `Promise.all` of ~15 SQL queries, returns `{ data: DashboardData }` (see `types/dashboard.ts`). No new tables — reads `messages_cache`, `sent_tracking`, `scheduled_emails`, `email_rules` + `rule_execution_log`, `contacts`, `email_accounts`
- **Account scope**: `?account=<id>` (validated against `user_id`) narrows every widget except the account list and the two contact widgets (`contacts` has no `account_id` in this schema). Response always echoes `accountFilter` (the id it actually applied, or `null`) so the client can drop a stale filter. Client persists the choice server-side in `user_settings.dashboard_account_id` (via `/api/settings`, `null` = all accounts), uses SWR `keepPreviousData` + an `isValidating` dim. Selector in the header + click-to-filter on the "Comptes" widget rows
- Focus / receipts / scheduled items carry `accountName` + `accountColor`; the client shows a per-account chip on each unless already scoped to one account
- **Focus list** is heuristic-only (no LLM / `ai_settings`): scores unread inbox messages by starred, VIP/frequent contact (`contacts`), and subject regex (invoice / deadline / reply / attachment). Top 5 by score
- **Unread / activity** counts exclude folders matching `trash|sent|junk|spam|draft|archive` (ILIKE). Accuracy is bounded by what `messages_cache` holds — folders never opened in-app may be under-counted
- **Activity chart** = inline SVG built from a zero-filled 14-day array (server-side), `vector-effect="non-scaling-stroke"`, gradient area fills. No chart lib
- `start_view` in `user_settings` (`'inbox'` default | `'dashboard'`) — set via Settings → Lecture toggle; `app/page.tsx` (`/`) reads it and redirects. `/mail` stays the direct link
- Client animations (`useCountUp`, `motion-safe:animate-in` card stagger) all gate on `prefers-reduced-motion`
- Quick-compose / "Write" buttons `router.push('/mail')` then dispatch `synapmail:compose` after 350ms (ComposeModal only mounts on `/mail`)

### Custom events (cross-component communication)
- `synapmail:account-change` — emitted by account switcher; Sidebar and MailClient listen to reset selection/reading-pane state. The `activeAccountId` *value* itself now propagates via the shared `/api/settings` SWR cache (see "UI state persistence"), not via this event — the event is same-tab-only and was the source of the old multi-tab desync
- `synapmail:compose` — triggers ComposeModal open
- `synapmail:open-message` — emitted by notification click AND by the reading-pane "à traiter" list; MailClient opens the message in ReadingPane
- `synapmail:scheduled-sent` — emitted on `scheduled_sent` SSE; refreshes `ScheduledPopover`
- `synapmail:snooze-changed` — emitted after a snooze/un-snooze; refreshes `SnoozePopover`

### Responsive Design
- Mobile: single column (drawer for sidebar)
- Tablet: two columns (sidebar hidden by default)
- Desktop: three columns full; sidebar collapsible (icon-only ↔ full); columns resizable via drag handle
- Mail list column width: `w-full` below `lg`, fixed `listWidth` (resizable, 240–600px) only at `lg+` — matches the `hidden lg:block` resize handle. Never apply the pixel width at all breakpoints: a narrow viewport can't shrink a `shrink-0` fixed-width column, so its right edge (corner action strip) gets clipped by `<main>`'s `overflow-hidden`. `listWidth` is passed as the `--synap-list-w` CSS var and consumed via `lg:w-[var(--synap-list-w)]`.
- `MessageList` toolbars (filter/density row + bulk-selection row) are `flex flex-wrap`; the right-hand icon group uses `ml-auto` (not a `flex-1` spacer) so it wraps to a second line on a narrow column instead of the segmented controls being clipped.

### Typography
- System font stack only (`tailwind.config.ts` → `fontFamily.sans`) — `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif`. No `next/font/google`, no bundled font files: zero external font dependency, even at build time.

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
- **Skills**: `/deploy` rebuilds and tails Docker logs; `/i18n` adds keys to both locale files atomically; `/new-api-route` scaffolds a route; `/check-types` runs tsc; `/review` checks conventions before deploy
- **Personal data sent to a third party**: any feature that sends personal data (an IP, an email address, a name…) to an external service outside this instance (e.g. `ip-api.com` in `lib/ipLocation.ts`) must (a) say so in plain language at the top of the module — what leaves, where, why, and what the answer is actually worth — and (b) ship an env var kill switch, default enabled, same convention as `REGISTRATION_ENABLED` (e.g. `IP_GEOLOCATION_ENABLED`), documented in `.env.example` and `README.md`, that a self-hosted operator can flip without touching code.
