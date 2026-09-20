# Suivi post-merge — PR #29 (fork Yumi-Lab)

PR #29 (`xtrack33`, fork `Yumi-Lab/synapmail`) a été mergée sur `main` (squash `c935b4e`, release v1.8.0)
sans corriger les points ci-dessous, sur décision du mainteneur : merger vite, corriger ensuite.
Revue faite par 8 agents de code-review (un par thématique du PR) le 2026-09-20.

Classé par sévérité. Cocher au fur et à mesure.

## 🔴 Sécurité — à traiter en priorité

- [ ] **`lib/folderActions.ts` — `sanitizeFolderName()`** n'exclut pas les segments `.` / `..`.
  Un nom de dossier `..` part tel quel vers `client.mailboxCreate()`/`mailboxRename()` — sur un serveur
  IMAP Maildir (Dovecot/Courier) qui mappe les noms de boîtes sur de vrais chemins fichiers, c'est un nom
  de mailbox en forme de traversée de répertoire. Fix : rejeter tout segment de path égal à `.` ou `..`
  (et par prudence tout chemin résolu qui sortirait de la racine du compte).

- [ ] **`app/api/ai/action/route.ts`** accepte désormais l'auth Bearer (`authenticate()` au lieu de
  `auth()`) alors que cette route n'est pas dans la liste documentée des routes Bearer de `CLAUDE.md`
  ("Everything else... stays session-only"), et il n'y a aucune limite de taille sur `content`. Une clé
  API émise pour du simple accès mail peut driver l'assistant IA (payant) avec un contenu arbitrairement
  gros et répété — épuisement de quota / coût, sans rate-limiting existant. Fix : soit repasser la route
  en session-only, soit l'ajouter explicitement à la liste documentée + plafonner la taille de `content`.

- [ ] **`lib/subscriptions.ts` — `mailtoSubject()`** ne fait qu'un `.trim()` sur le `subject=` d'un lien
  `mailto:` extrait d'un header `List-Unsubscribe` **contrôlé par l'expéditeur du mail**, avant de le
  passer à `sendMail()` avec les identifiants SMTP **du compte de la victime**. `mailtoAddress()` valide
  strictement l'adresse par regex mais pas le subject. Risque d'injection d'en-tête SMTP si une séquence
  CRLF encodée survit à l'encodage nodemailer. Fix : filtrer les caractères de contrôle (CR/LF) sur
  `mailtoSubject()` comme c'est fait pour `mailtoAddress()`.

## 🟠 Bugs qui contredisent des corrections annoncées par le PR

- [ ] **`components/layout/ThreadPane.tsx`** — `expandedUids` et certains lookups de message de fil
  indexent encore par `uid` seul, pas par dossier+uid, alors que le PR corrige explicitement ce problème
  ailleurs dans le même fichier (`messageHref`/`originKey`). Un fil mêlant un message Inbox et sa copie
  Sent avec le même numéro d'uid peut développer/replier le mauvais message. Même souci dans
  `app/(app)/mail/MailClient.tsx` `handleThreadDelete(uid)` (filtre/`find` par uid nu) — peut supprimer ou
  cibler le mauvais message du fil.

- [ ] **`lib/folderActions.ts` — `isDescendant()`** ne fait pas la normalisation Unicode NFC que
  `samePath()` a justement été écrite pour ajouter (commentaire de `samePath()` : un serveur IMAP peut
  renvoyer un nom en NFD). Utilisée pour `hasChildren` (règle "un parent ne peut pas être supprimé") et
  pour la réécriture de chemin au renommage — un dossier enfant dont le chemin diffère du parent
  uniquement par la forme de normalisation Unicode n'est pas détecté comme enfant : le parent peut être
  supprimé et orpheline l'enfant, et le renommage saute la réécriture de cet enfant.

- [ ] **`components/theme/ThemeProvider.tsx`** — flash encore présent (dark→light→dark) au montage pour
  `theme='system'` avec OS en mode sombre : `systemDark` démarre à `useState(false)` au lieu de lire
  `prefers-color-scheme` immédiatement, donc le premier rendu recalcule `resolvedTheme='light'` et retire
  la classe `dark` déjà posée par le script bloquant avant peinture. Contredit l'objectif explicite "no
  flash" de la réécriture.

## 🟡 Bugs réels, sévérité moyenne

- [ ] **`lib/subscriptions.ts` — `withDeadline()`** ne détruit jamais la socket sous-jacente quand le
  deadline gagne la course contre la promesse (`req.destroy()` jamais appelé). Un serveur malveillant
  cité dans un `List-Unsubscribe` peut faire fuir des connexions ouvertes en envoyant un octet toutes les
  ~2s (empêche le timeout d'inactivité de se déclencher) pendant que le deadline applicatif de 3s expire
  côté serveur.

- [ ] **`components/layout/AccountAvatar.tsx`** — le switch de compte actif écrit `/api/settings` sans
  `mutate()` du cache SWR partagé (contrairement au pattern documenté dans `CLAUDE.md` "UI state
  persistence"). Un changement de compte suivi d'un alt-tab avant la réponse du PATCH peut être annulé
  silencieusement par la revalidation au focus.

- [ ] **`app/api/messages/search/route.ts`** — la branche de streaming NDJSON (`scope=all&stream=1`) n'a
  aucune garde contre les appels Bearer/machine, alors que le commentaire du fichier et `docs/API.md`
  promettent un contrat JSON unique inchangé pour les appels machine. Un client Bearer qui suit la doc
  reçoit du NDJSON brut au lieu d'un objet JSON (`res.json()` plante), et le préfixe `aiSafety` se répète
  par ligne.

- [ ] **`lib/idle.ts`** — le watcher IMAP IDLE retente une connexion en échec indéfiniment (délai plafonné
  à 60s mais pas de plafond de tentatives). Un mot de passe expiré/changé fait retenter un login IMAP
  toutes les 60s par onglet ouvert, indéfiniment — exactement le pattern qui a déjà fait bannir l'IP du
  reverse-proxy par fail2ban sur cette infra (cf. mémoire projet "Infra Stalwart + NPM"). Ajouter un
  plafond de tentatives / circuit-breaker.

- [ ] **`app/api/stream/route.ts`** — le lookup du `?account=` optionnel (pour le watch IMAP IDLE) n'a pas
  de try/catch. Une erreur DB transitoire plante toute la connexion SSE (500) au lieu de juste sauter le
  watch IMAP comme le commentaire le documente — tue aussi la livraison de `scheduled_sent`/`rule_applied`.

- [ ] **`components/layout/Sidebar.tsx`** — le listener de fermeture du sélecteur de compte est bindé sur
  `click` au lieu de `mousedown` (contrairement à tous les autres nouveaux menus du PR). Un clic droit sur
  un dossier pour ouvrir `FolderContextMenu` ne ferme pas le sélecteur de compte — les deux menus peuvent
  se superposer.

- [ ] **`lib/forward.ts`** — le plafond de 25 Mio sur le transfert multi-messages est vérifié sur la
  taille brute IMAP (`RFC822.SIZE`), mais les pièces jointes sont envoyées en base64 (+37% environ) par
  nodemailer. Un transfert d'environ 24 Mio brut passe le contrôle puis peut dépasser la vraie limite SMTP
  une fois encodé.

- [ ] **`components/layout/MailToolbar.tsx`** — le menu "…" de débordement affiche tous les groupes de la
  barre d'outils au lieu de seulement ceux qui débordent réellement. Sur une largeur où un seul groupe
  déborde, le menu duplique les groupes déjà visibles en ligne.

## Mineur / dette documentaire (non bloquant)

- `docs/API.md` non mis à jour pour les nouveaux paramètres de recherche (`scope`/`stream`/`total`/`fields`)
  ni pour les 2 routes de partage de compte de v1.7.0 (déjà signalé par l'auteur du PR).
- `app/api/accounts/[id]/shares/[shareId]/route.ts` : DELETE permet maintenant à l'invité de révoquer
  son propre partage (self-leave) — contredit la phrase de `CLAUDE.md` "the shares routes themselves stay
  strictly owner-only", à mettre à jour (ce n'est pas une faille, la requête filtre bien sur
  `invitee_user_id`).
- Strings encore en dur en français dans `ThreadPane.tsx` (nouvel état d'erreur) et restes dans
  `AICompose.tsx`/`AISettingsClient.tsx` malgré la convention i18n du projet.
- `lib/db.ts` : `withTransaction()` ajouté mais jamais utilisé (code mort).
- `PERMISSION_KEYS`/`EMPTY_PERMISSIONS` dupliqués entre panneaux de partage de compte (pas propre à ce
  PR mais aggravé par lui).
- Recherche : logique de tri/plafond dupliquée entre branche streaming et branche single-shot ; la
  branche `scope=all` non-streamée utilise `listFolders()` au lieu de `listFoldersRanked()` (ne filtre
  pas les dossiers `\Noselect`/vides — gaspille des allers-retours IMAP).
- `components/settings/AccountColorPicker.tsx` : double commit (blur puis clic "Automatique") — deux
  PATCH pour un seul geste utilisateur, sans conséquence visible autre qu'un flash de couleur.
- `components/layout/Omnibar.tsx` : les comptes dans la palette de commandes (Cmd/Ctrl+K) affichent
  toujours `unread={0}` au lieu du vrai compteur.
- `lib/imap.ts` : `search()` appelé sans `{uid:true}` dans la branche filtrée (cohérent avec le `fetch`
  qui suit, mais fragile — un futur correctif qui ajoute `{uid:true}` à un seul des deux appels casserait
  silencieusement la pagination filtrée).
- `lib/forward.ts` : `UID_PATTERN = /^\d+$/` accepte les uid avec zéros en tête (`"007"`), jamais générés
  par l'app aujourd'hui mais pas garanti pour un futur appelant de `parseForwardedMessages`.
- `app/layout.tsx` : `readBranding()` appelé deux fois par requête (une fois par `generateMetadata()`,
  une fois par `RootLayout()`) — un aller-retour DB évitable, pas un bug.
- `lib/subscriptions.ts` — `isPrivateAddress()` ne décode pas les encodages 6to4/NAT64 d'IPv4 dans une
  adresse IPv6 (ex. `2002:a9fe:a9fe::` pour `169.254.169.254`), malgré le commentaire de la fonction qui
  prétend couvrir ce cas ; exploitabilité réelle faible (6to4/NAT64 généralement désactivés en conteneur).
