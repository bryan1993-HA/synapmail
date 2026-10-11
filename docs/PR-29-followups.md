# Suivi post-merge — PR #29 (fork Yumi-Lab)

PR #29 (`xtrack33`, fork `Yumi-Lab/synapmail`) a été mergée sur `main` (squash `c935b4e`, release v1.8.0)
sans corriger les points ci-dessous, sur décision du mainteneur : merger vite, corriger ensuite.
Revue faite par 8 agents de code-review (un par thématique du PR) le 2026-09-20.

Classé par sévérité. Cocher au fur et à mesure.

## 🔴 Sécurité — à traiter en priorité

- [x] **`lib/folderActions.ts` — `sanitizeFolderName()`** n'exclut pas les segments `.` / `..`.
  Un nom de dossier `..` part tel quel vers `client.mailboxCreate()`/`mailboxRename()` — sur un serveur
  IMAP Maildir (Dovecot/Courier) qui mappe les noms de boîtes sur de vrais chemins fichiers, c'est un nom
  de mailbox en forme de traversée de répertoire. Fix : rejeter tout segment de path égal à `.` ou `..`
  (et par prudence tout chemin résolu qui sortirait de la racine du compte). — Fixed: a bare `.` or `..`
  (trimmed) is refused as a name; since the account delimiter is already refused inside a name, a name is
  exactly one path segment, so no resolved path can leave the root. Bench: `scripts/check-folder-actions.mjs`
  (`--negative` replays the old rule and must go red).

- [x] **`app/api/ai/action/route.ts`** accepte désormais l'auth Bearer (`authenticate()` au lieu de
  `auth()`) alors que cette route n'est pas dans la liste documentée des routes Bearer de `CLAUDE.md`
  ("Everything else... stays session-only"), et il n'y a aucune limite de taille sur `content`. Une clé
  API émise pour du simple accès mail peut driver l'assistant IA (payant) avec un contenu arbitrairement
  gros et répété — épuisement de quota / coût, sans rate-limiting existant. Fix : soit repasser la route
  en session-only, soit l'ajouter explicitement à la liste documentée + plafonner la taille de `content`.
  — Fixed: the route stays Bearer (scope `ai:use`, already listed in `docs/API.md` and `docs/openapi.json`;
  `CLAUDE.md`'s stale "first lot" list now points at `ROUTE_SCOPES` as the single source) and refuses
  `content` + `context` above `AI_CONTENT_MAX_CHARS` (200 000 chars, `lib/ai.ts`) with `413 { error, limit }`
  before any database or provider work. Bench: `scripts/check-ai-content-limit.mjs` (`--negative` replays the
  unbounded route and must go red). No rate limit yet — that is the separate follow-up already noted in `CLAUDE.md`.

- [x] **`lib/subscriptions.ts` — `mailtoSubject()`** ne fait qu'un `.trim()` sur le `subject=` d'un lien
  `mailto:` extrait d'un header `List-Unsubscribe` **contrôlé par l'expéditeur du mail**, avant de le
  passer à `sendMail()` avec les identifiants SMTP **du compte de la victime**. `mailtoAddress()` valide
  strictement l'adresse par regex mais pas le subject. Risque d'injection d'en-tête SMTP si une séquence
  CRLF encodée survit à l'encodage nodemailer. Fix : filtrer les caractères de contrôle (CR/LF) sur
  `mailtoSubject()` comme c'est fait pour `mailtoAddress()`. — Fixed: every control character
  (`\u0000-\u001f`, `\u007f`, CR/LF included) is folded to one space after URL decoding, so the subject can
  never end the `Subject:` line. Bench: `scripts/check-subscriptions.mjs` (`--negative` replays the trim-only
  rule and must go red).

## 🟠 Bugs qui contredisent des corrections annoncées par le PR

- [x] **`components/layout/ThreadPane.tsx`** — `expandedUids` et certains lookups de message de fil
  indexent encore par `uid` seul, pas par dossier+uid, alors que le PR corrige explicitement ce problème
  ailleurs dans le même fichier (`messageHref`/`originKey`). Un fil mêlant un message Inbox et sa copie
  Sent avec le même numéro d'uid peut développer/replier le mauvais message. Même souci dans
  `app/(app)/mail/MailClient.tsx` `handleThreadDelete(uid)` (filtre/`find` par uid nu) — peut supprimer ou
  cibler le mauvais message du fil. — Fixed: expanded cards are keyed by `originKey()` (account, folder,
  uid); the card's delete callback carries the full `MessageOrigin`, and `handleThreadDelete` filters by
  `sameOrigin()` and addresses the request through `messageHref()`. Bench: `scripts/check-thread-origin.mjs`
  (`--negative` re-injects the uid-keyed lines and must go red).

- [x] **`lib/folderActions.ts` — `isDescendant()`** ne fait pas la normalisation Unicode NFC que
  `samePath()` a justement été écrite pour ajouter (commentaire de `samePath()` : un serveur IMAP peut
  renvoyer un nom en NFD). Utilisée pour `hasChildren` (règle "un parent ne peut pas être supprimé") et
  pour la réécriture de chemin au renommage — un dossier enfant dont le chemin diffère du parent
  uniquement par la forme de normalisation Unicode n'est pas détecté comme enfant : le parent peut être
  supprimé et orpheline l'enfant, et le renommage saute la réécriture de cet enfant. — Fixed: `isDescendant()`
  compares NFC forms like `samePath()`, and `rewritePath()` slices on the normalised prefix (the two forms can
  differ in length). Bench: `scripts/check-folder-actions.mjs` (`--negative` replays the raw-string rule and must go red).

- [x] **`components/theme/ThemeProvider.tsx`** — flash encore présent (dark→light→dark) au montage pour
  `theme='system'` avec OS en mode sombre : `systemDark` démarre à `useState(false)` au lieu de lire
  `prefers-color-scheme` immédiatement, donc le premier rendu recalcule `resolvedTheme='light'` et retire
  la classe `dark` déjà posée par le script bloquant avant peinture. Contredit l'objectif explicite "no
  flash" de la réécriture. — Fixed: `systemDark` is initialised lazily from `prefersDark()` on the first
  client render, so the apply effect confirms the class the blocking script set instead of removing it;
  `resolvedTheme` is rendered by no component, so the SSR/client difference cannot break hydration.
  Bench: `scripts/check-theme-mount.mjs` (`--negative` replays `useState(false)` and must go red).

## 🟡 Bugs réels, sévérité moyenne

- [x] **`lib/subscriptions.ts` — `withDeadline()`** ne détruit jamais la socket sous-jacente quand le
  deadline gagne la course contre la promesse (`req.destroy()` jamais appelé). Un serveur malveillant
  cité dans un `List-Unsubscribe` peut faire fuir des connexions ouvertes en envoyant un octet toutes les
  ~2s (empêche le timeout d'inactivité de se déclencher) pendant que le deadline applicatif de 3s expire
  côté serveur. — Fixed: `defaultRequester` carries `AbortSignal.timeout(timeoutMs)` instead of the
  inactivity `timeout`, so the socket is destroyed at the wall-clock deadline whatever the server drips;
  the abort is reported as `ETIMEDOUT` like before. `withDeadline()` stays as the caller's guard against a
  requester that never settles. Bench: `scripts/check-subscriptions.mjs` (real TLS drip server on the
  loopback; `--negative` replays the inactivity-timeout requester and must see the socket still open).

- [x] **`components/layout/AccountAvatar.tsx`** — le switch de compte actif écrit `/api/settings` sans
  `mutate()` du cache SWR partagé (contrairement au pattern documenté dans `CLAUDE.md` "UI state
  persistence"). Un changement de compte suivi d'un alt-tab avant la réponse du PATCH peut être annulé
  silencieusement par la revalidation au focus. — Fixed: every settings write now goes through
  `lib/settings.ts` `saveSettings()`, where the PATCH *is* the SWR mutation (optimistic value shown at
  once, stale revalidations discarded while it is in flight, the answered row becomes the cache,
  rollback on refusal). The documented two-step pattern (`mutate(..., false)` then a detached `fetch`)
  had the same window open, only shorter, so the ten other writers were moved onto the same helper.
  Bench: `scripts/check-settings-write.mjs` (pure, real `swr` bookkeeping; `--negative` replays the
  two-step write and must go red) and `scripts/check-settings-race-browser.mjs` (real click, PATCH held
  on the wire, forced focus revalidation; `--negative` replays the bare-fetch switch).

- [x] **`app/api/messages/search/route.ts`** — la branche de streaming NDJSON (`scope=all&stream=1`) n'a
  aucune garde contre les appels Bearer/machine, alors que le commentaire du fichier et `docs/API.md`
  promettent un contrat JSON unique inchangé pour les appels machine. Un client Bearer qui suit la doc
  reçoit du NDJSON brut au lieu d'un objet JSON (`res.json()` plante), et le préfixe `aiSafety` se répète
  par ligne. — Fixed by making the promise true rather than by gating: the stream was never forced on a
  key (a machine caller only meets NDJSON after sending `stream=1` itself, measured: five Bearer calls,
  the three without the parameter answer one `application/json` object), so the stale "unchanged contract"
  comments in the route and `lib/search.ts` now say the stream is the caller's opt-in, `docs/API.md` says
  it in the `stream=1` paragraph, and `docs/openapi.json` finally names `scope`, `stream` and the
  `application/x-ndjson` answer — a generated client no longer discovers the stream by crashing on
  `json()`. The per-line `aiSafety` is by design (each line is its own mailbox's guard, defect #10).
  The media type lives once, `STREAM_CONTENT_TYPE`. Bench: `scripts/check-api-docs.mjs` (5 new checks;
  `--break=stream` hides the parameter and the NDJSON answer from a copy of the contract and must go red).

- [x] **`lib/idle.ts`** — le watcher IMAP IDLE retente une connexion en échec indéfiniment (délai plafonné
  à 60s mais pas de plafond de tentatives). Un mot de passe expiré/changé fait retenter un login IMAP
  toutes les 60s par onglet ouvert, indéfiniment — exactement le pattern qui a déjà fait bannir l'IP du
  reverse-proxy par fail2ban sur cette infra (cf. mémoire projet "Infra Stalwart + NPM"). Ajouter un
  plafond de tentatives / circuit-breaker. — Fixed without a counter: the watcher gives up for good on
  the one failure that never heals, a rejected login (`authenticationFailed` set by imapflow), and keeps
  its capped backoff for everything else (refused connection, transport drop). Fail2ban counts logins,
  and one wrong login per stream is what a mail client sends. Found on the way: a rejected login left
  the TCP socket open in `createClient()` (imapflow only tears it down on transport errors) — closed
  there, for all 26 callers. Bench: `scripts/check-idle-auth-stop.mjs` (fake IMAP server on loopback;
  `--negative` loads a copy of the module without the guard and must go red).

- [x] **`app/api/stream/route.ts`** — le lookup du `?account=` optionnel (pour le watch IMAP IDLE) n'a pas
  de try/catch. Une erreur DB transitoire plante toute la connexion SSE (500) au lieu de juste sauter le
  watch IMAP comme le commentaire le documente — tue aussi la livraison de `scheduled_sent`/`rule_applied`.
  — Fixed: a rejected lookup is logged and treated as "no account" (`.catch(() => null)` on the one
  call), so the stream opens with its scheduler events and no IMAP watch, exactly as the comment
  promised. Bench: `scripts/check-stream-lookup.mjs` (the real route imported with a rejecting lookup;
  `--negative` loads a copy without the guard and must go red).

- [x] **`components/layout/Sidebar.tsx`** — le listener de fermeture du sélecteur de compte est bindé sur
  `click` au lieu de `mousedown` (contrairement à tous les autres nouveaux menus du PR). Un clic droit sur
  un dossier pour ouvrir `FolderContextMenu` ne ferme pas le sélecteur de compte — les deux menus peuvent
  se superposer. — Fixed: the dismiss stays on `click` on purpose (the list is in the bar's flow, so
  folding it on `mousedown` slides the row out from under the cursor before `mouseup` — the click lands
  on whatever moved into its place); the same outside-target handler is now also bound to `contextmenu`,
  which a right-click fires without ever reaching the click phase. Bench:
  `scripts/check-account-picker-dismiss.mjs` (real mouse on the running app; `--negative` removes the
  `contextmenu` dismiss and must see both menus open at once).

- [x] **`lib/forward.ts`** — le plafond de 25 Mio sur le transfert multi-messages est vérifié sur la
  taille brute IMAP (`RFC822.SIZE`), mais les pièces jointes sont envoyées en base64 (+37% environ) par
  nodemailer. Un transfert d'environ 24 Mio brut passe le contrôle puis peut dépasser la vraie limite SMTP
  une fois encodé. — Fixed together with review defect #8: the fixed 25 MiB constant is gone; the IMAP
  fetch is bounded by the server ceiling from `lib/smtpSize.ts` (decoded bytes, base64 cost and envelope
  reserve already deducted), resolved once before the fetch. Bench: `scripts/check-forward-decision.mjs`.

- [x] **`components/layout/MailToolbar.tsx`** — le menu "…" de débordement affiche tous les groupes de la
  barre d'outils au lieu de seulement ceux qui débordent réellement. Sur une largeur où un seul groupe
  déborde, le menu duplique les groupes déjà visibles en ligne. — Fixed: the menu renders the `overflowed`
  subset the bar already computes (the same list that decides what stays inline), so a group is either
  inline or in the menu, never both. Bench: `scripts/check-toolbar-overflow.mjs` (Chrome, read-only, walks
  the viewport down and asserts inline + menu = the declared groups at every fold; `--negative` re-injects
  the "every group" menu and must go red).

## Mineur / dette documentaire (non bloquant)

- `docs/API.md` non mis à jour pour les nouveaux paramètres de recherche (`scope`/`stream`/`total`/`fields`)
  ni pour les 2 routes de partage de compte de v1.7.0 (déjà signalé par l'auteur du PR). — Done: search
  section (`scope`/`stream`/`total`/`fields`, coverage) in `a59f315`, the three share routes in `cfe3210`;
  `scripts/check-api-docs.mjs` keeps the doc and `lib/search.ts` from drifting.
- `app/api/accounts/[id]/shares/[shareId]/route.ts` : DELETE permet maintenant à l'invité de révoquer
  son propre partage (self-leave) — contredit la phrase de `CLAUDE.md` "the shares routes themselves stay
  strictly owner-only", à mettre à jour (ce n'est pas une faille, la requête filtre bien sur
  `invitee_user_id`). — Done: the sentence now names the recipient's self-leave on `DELETE`.
- Strings encore en dur en français dans `ThreadPane.tsx` (nouvel état d'erreur) et restes dans
  `AICompose.tsx`/`AISettingsClient.tsx` malgré la convention i18n du projet.
- `lib/db.ts` : `withTransaction()` ajouté mais jamais utilisé (code mort). — Not present: no
  `withTransaction` in `lib/db.ts` on this branch nor in `c935b4e` (`git log -S withTransaction` finds
  only this note); nothing to remove.
- `PERMISSION_KEYS`/`EMPTY_PERMISSIONS` dupliqués entre panneaux de partage de compte (pas propre à ce
  PR mais aggravé par lui). — Done: one panel left (`AccountSharesPanel.tsx`), `EMPTY_PERMISSIONS` no
  longer exists anywhere (`git grep`).
- Recherche : logique de tri/plafond dupliquée entre branche streaming et branche single-shot ; la
  branche `scope=all` non-streamée utilise `listFolders()` au lieu de `listFoldersRanked()` (ne filtre
  pas les dossiers `\Noselect`/vides — gaspille des allers-retours IMAP). — Fixed: the one-shot branch
  now sweeps `listFoldersRanked()` and renders through the same `streamedMessages()` helper as the stream
  (one sort, one cap); `scripts/check-search-single-shot.mjs` (`--negative` replays the old source).
- `components/settings/AccountColorPicker.tsx` : double commit (blur puis clic "Automatique") — deux
  PATCH pour un seul geste utilisateur, sans conséquence visible autre qu'un flash de couleur.
- `components/layout/Omnibar.tsx` : les comptes dans la palette de commandes (Cmd/Ctrl+K) affichent
  toujours `unread={0}` au lieu du vrai compteur. — Done in `19bb4ec` (`unread={acc.unreadCount ?? 0}`).
- `lib/imap.ts` : `search()` appelé sans `{uid:true}` dans la branche filtrée (cohérent avec le `fetch`
  qui suit, mais fragile — un futur correctif qui ajoute `{uid:true}` à un seul des deux appels casserait
  silencieusement la pagination filtrée). — Settled: the range cannot become UIDs (the `all` branch derives
  sequence numbers from `mailbox.exists` without any SEARCH), so the misleading `pageUids` alias is gone and
  the fetch names the coupling in one comment. No behaviour change.
- `lib/forward.ts` : `UID_PATTERN = /^\d+$/` accepte les uid avec zéros en tête (`"007"`), jamais générés
  par l'app aujourd'hui mais pas garanti pour un futur appelant de `parseForwardedMessages`. — Fixed:
  `/^[1-9]\d*$/` (no `0`, no leading zero); `scripts/check-forward-decision.mjs` refuses `0` and `007`
  (goes red with the old pattern).
- `app/layout.tsx` : `readBranding()` appelé deux fois par requête (une fois par `generateMetadata()`,
  une fois par `RootLayout()`) — un aller-retour DB évitable, pas un bug.
- `lib/subscriptions.ts` — `isPrivateAddress()` ne décode pas les encodages 6to4/NAT64 d'IPv4 dans une
  adresse IPv6 (ex. `2002:a9fe:a9fe::` pour `169.254.169.254`), malgré le commentaire de la fonction qui
  prétend couvrir ce cas ; exploitabilité réelle faible (6to4/NAT64 généralement désactivés en conteneur). —
  Fixed: `2002:hhhh:hhhh::/48` (6to4) and `64:ff9b::hhhh:hhhh` (NAT64) are decoded to their IPv4 and judged
  as it; `scripts/check-subscriptions.mjs` refuses 4 such addresses and allows 2 public ones (red on the old code).
