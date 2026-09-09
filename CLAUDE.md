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
        AccountsClient.tsx      # Client component — list / add (wizard) / edit modes
        AccountWizard.tsx       # Multi-step wizard: provider grid → credentials → advanced config
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
    admin/
      users/page.tsx            # Admin: user management
  api/
    auth/[...nextauth]/route.ts
    dashboard/route.ts          # GET aggregated command-center overview (KPIs, unread, activity, focus, receipts, scheduled, rules, follow-ups)
    accounts/route.ts           # GET list / POST create email account
    accounts/[id]/route.ts      # PATCH update / DELETE remove
    accounts/test/route.ts      # POST test IMAP+SMTP connection
    admin/users/route.ts        # GET list / POST create (admin only)
    admin/users/[id]/route.ts   # PATCH role / DELETE (admin only)
    contacts/route.ts           # GET list+search contacts
    contacts/[id]/route.ts      # PATCH name / DELETE
    folders/route.ts            # GET IMAP folder list
    messages/route.ts           # GET list messages (paginated, cached)
    messages/send/route.ts      # POST send (immediate or scheduled + forwarded attachments)
    messages/search/route.ts    # GET full-text IMAP search
    messages/thread/route.ts    # GET thread by normalized subject
    messages/bulk/route.ts      # PATCH mark read/move + DELETE bulk
    messages/[id]/route.ts      # GET full / PATCH (read, star) / DELETE
    messages/[id]/mdn/route.ts  # POST register received MDN read receipt
    messages/[id]/snooze/route.ts  # POST snooze until date / DELETE un-snooze
    messages/[id]/attachment/[partId]/route.ts  # GET download or inline (?inline=true)
    focus/route.ts              # GET light "à traiter" list (reading-pane empty state; shares lib/focus.ts with dashboard)
    oauth/microsoft/route.ts    # GET initiate OAuth2 flow
    oauth/microsoft/callback/route.ts           # GET OAuth2 callback + token exchange
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
  accounts.ts                   # Account helpers (get by ID, default account)
  auth.ts                       # Auth.js config — credentials provider, multi-user
  contacts.ts                   # Contact extraction from emails + upsert logic
  db.ts                         # PostgreSQL pool — query<T>(sql, values?)
  encrypt.ts                    # AES-256-GCM encrypt/decrypt
  focus.ts                      # "À traiter" heuristic — scoreFocus() + getFocusItems() (shared by /api/dashboard + /api/focus)
  i18n.ts                       # next-intl server config
  imap.ts                       # imapflow wrapper — connect, list, fetch, bulk ops, attachments
  msOAuth.ts                    # Microsoft OAuth2 token refresh
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
  account.ts                    # EmailAccount, Signature, User
  api.ts                        # API response types
  rule.ts                       # Rule, RuleCondition, RuleAction interfaces
  template.ts                   # ComposeTemplate interface

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

-- Cached message metadata (fast list + unread badges + rule matching)
messages_cache (id, account_id, folder, uid, message_id, from_address, from_name,
                subject, date, is_read, is_starred, is_flagged, has_attachments,
                preview, thread_id, cached_at)

-- App settings per user
user_settings (user_id, theme, language, messages_per_page, thread_view,
               reading_pane, notifications, undo_send_delay, start_view, updated_at)
  start_view: 'inbox' | 'dashboard'   -- landing view; '/' redirects accordingly

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
- **Cache reconcile**: `listMessages` only INSERT/UPDATEs `messages_cache`; on page 1 it also runs `SEARCH ALL` (uid) and DELETEs cache rows whose UID is no longer live (fire-and-forget). Without this, messages moved/deleted elsewhere leave ghost `is_read=false` rows that pollute the focus list and unread counts.

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
- Language change: write locale cookie → page reload → next-intl middleware picks it up

### Server-Sent Events (new mail + scheduler)
- `GET /api/stream` — keeps connection open
- Polls IMAP every 30s per connected account
- Sends `data: { type: 'new_mail', account, count }` events
- Sends `data: { type: 'scheduled_sent', id }` when scheduler delivers a message

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
- Same file also runs `processSnoozes()` every 60s (DELETE expired `snoozed_messages`)
- `instrumentation.ts` starts the scheduler at process boot (Next.js 14 `experimentalInstrumentationHook`) — independent of any user session

### Mail list — Direction B (date groups, density, corner actions, snooze)
- **Date groups**: `MessageList` buckets threads by the last message's date (`grpToday`/`grpYesterday`/`grpThisWeek` <7d/`grpThisMonth` <30d/`MMMM yyyy`). Sticky headers (`sticky top-0` inside the scroll container). Disabled in search mode.
- **Density**: `localStorage['synapmail:mailDensity']` = `'comfortable' | 'compact'`. Compact = tighter rows, `w-7` avatars, preview line hidden. Segmented toggle in the toolbar.
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

### Settings persistence
- `user_settings` table UPSERT via `PATCH /api/settings`
- `initDb()` in `instrumentation.ts` ensures all tables exist at boot (idempotent)
- Theme: next-themes cookie; Language: locale cookie → picked up by next-intl middleware on next request
- `MailClient` reads settings via SWR `/api/settings`; `settingsPaneInitialized` ref prevents overwriting user's in-session toggle

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
- **Phase 2** (CRUD pages on the shared frame): accounts, signatures, templates, contacts, rules (`RulesClient`), ai (`AISettingsClient`) now use `SettingsPage` + `SettingsHeader` (icon tile, violet accent) and the `rounded-2xl bg-card/80 shadow-sm` card / `bg-card shadow-sm` list-row style. Internal logic (Tiptap editors, drag-drop, wizard, rule editor) untouched. i18n of the CRUD page bodies is still partial (strings hardcoded FR pre-refonte) — separate follow-up.
- Reference mockup: `claude.ai/code/artifact/b87828af-6602-445e-a0a2-40e786da638c`

### Dashboard / command center (`/dashboard`)
- Renders inside `AppShell` (Sidebar + full-width content) — NOT the 3-column mail shell
- `GET /api/dashboard` = one aggregation route: `Promise.all` of ~15 SQL queries, returns `{ data: DashboardData }` (see `types/dashboard.ts`). No new tables — reads `messages_cache`, `sent_tracking`, `scheduled_emails`, `email_rules` + `rule_execution_log`, `contacts`, `email_accounts`
- **Account scope**: `?account=<id>` (validated against `user_id`) narrows every widget except the account list and the two contact widgets (`contacts` has no `account_id` in this schema). Response always echoes `accountFilter` (the id it actually applied, or `null`) so the client can drop a stale filter. Client persists the choice in `localStorage['synapmail:dashboardAccount']`, uses SWR `keepPreviousData` + an `isValidating` dim. Selector in the header + click-to-filter on the "Comptes" widget rows
- Focus / receipts / scheduled items carry `accountName` + `accountColor`; the client shows a per-account chip on each unless already scoped to one account
- **Focus list** is heuristic-only (no LLM / `ai_settings`): scores unread inbox messages by starred, VIP/frequent contact (`contacts`), and subject regex (invoice / deadline / reply / attachment). Top 5 by score
- **Unread / activity** counts exclude folders matching `trash|sent|junk|spam|draft|archive` (ILIKE). Accuracy is bounded by what `messages_cache` holds — folders never opened in-app may be under-counted
- **Activity chart** = inline SVG built from a zero-filled 14-day array (server-side), `vector-effect="non-scaling-stroke"`, gradient area fills. No chart lib
- `start_view` in `user_settings` (`'inbox'` default | `'dashboard'`) — set via Settings → Lecture toggle; `app/page.tsx` (`/`) reads it and redirects. `/mail` stays the direct link
- Client animations (`useCountUp`, `motion-safe:animate-in` card stagger) all gate on `prefers-reduced-motion`
- Quick-compose / "Write" buttons `router.push('/mail')` then dispatch `synapmail:compose` after 350ms (ComposeModal only mounts on `/mail`)

### Custom events (cross-component communication)
- `synapmail:account-change` — emitted by account switcher; Sidebar and MailClient listen to update active account
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
