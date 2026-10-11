#!/usr/bin/env node
/**
 * Self-check of lot N3: `docs/API.md` cannot drift away from the routes it describes.
 *
 * PURE: no database, no mailbox, no network, no dev server. It reads every
 * route file under `app` and the document from disk and compares them three ways:
 *
 *  1. Every HTTP method exported by a route file has its own heading.
 *  2. Every heading names a route and a method that really exist.
 *  3. The access mode announced by the heading is the one the code enforces,
 *     read INSIDE that method's own body — a sibling method calling
 *     `authenticate()` must never make its neighbour look Bearer-eligible.
 *
 * Then the same treatment for `docs/openapi.json`: every Bearer route of the
 * code is an operation of the contract, the contract holds NO operation for a
 * route a key cannot call, and the document is structurally sound (3.1, every
 * operation answered and secured, every `$ref` resolving).
 *
 *   node scripts/check-api-docs.mjs
 *   node scripts/check-api-docs.mjs --break=missing   (a route dropped from the doc)
 *   node scripts/check-api-docs.mjs --break=ghost     (a heading for a dead route)
 *   node scripts/check-api-docs.mjs --break=mode      (a mode the code contradicts)
 *   node scripts/check-api-docs.mjs --break=scope     (a scope the code does not require)
 *   node scripts/check-api-docs.mjs --break=origin    (links built from the request host)
 *   node scripts/check-api-docs.mjs --break=prefix    (a public entry matched by prefix)
 *   node scripts/check-api-docs.mjs --break=inline    (the address frozen at build time)
 *   node scripts/check-api-docs.mjs --break=contract  (a Bearer route absent from the contract)
 *   node scripts/check-api-docs.mjs --break=session   (a session-only route inside the contract)
 *   node scripts/check-api-docs.mjs --break=ref       (a $ref that resolves to nothing)
 *   node scripts/check-api-docs.mjs --break=servers  (the contract served with its disk servers)
 *   node scripts/check-api-docs.mjs --break=searchscope (a search scope the doc never names)
 *   node scripts/check-api-docs.mjs --break=stream    (the contract silent on the NDJSON stream)
 * The `--break` forms damage a COPY of one input and EXPECT the run to fail: a
 * battery that cannot fail proves nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, relative, sep } from 'node:path'
import { API_DOC_PATH, LLMS_TXT_PATH, OPENAPI_FILE, OPENAPI_PATH, withServedOrigin } from '../lib/apiDocs.ts'
import { isPublicPath, PUBLIC_PATHS } from '../lib/publicPaths.ts'
import { ROUTE_SCOPES } from '../lib/apiScopes.ts'
import { appOrigin } from '../lib/appOrigin.ts'
import { fileURLToPath } from 'node:url'

// `lib/search.ts` importe ses voisins SANS extension (comme tout le code de
// l'application, que le empaqueteur résout) : un import statique depuis un script
// échouerait avant d'arriver ici. Même crochet de résolution que
// `scripts/check-search-accounts.mjs`, donc un import dynamique après son pose.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) {
      const url = new URL(`${spec}.ts`, ctx.parentURL)
      if (existsSync(url)) return next(url.href, ctx)
    }
    return next(spec, ctx)
  },
})
const { SEARCH_SCOPES, STREAM_CONTENT_TYPE, STREAM_PARAM, SWEEP_STOP_REASONS } =
  await import(new URL('../lib/search.ts', import.meta.url).href)

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const APP_DIR = join(ROOT, 'app')
const DOC_PATH = join(ROOT, 'docs', 'API.md')

/** The methods Next.js routes may export. Anything else is not a route method. */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/**
 * The access modes, from the widest to the narrowest. Each carries the marker
 * the document writes and the evidence the code must show. ONE source: the
 * heading parser and the body reader both read this table.
 */
const MODES = {
  admin: { markers: ['👑 Admin'], detect: body => /\bisAdmin\s*\(|\brequireAdmin\b/.test(body) },
  // `authorize()` est `authenticate()` + le refus qui nomme la portée manquante :
  // les deux ouvrent la route aux clés, donc les deux valent preuve de mode Bearer.
  bearer: { markers: ['🔑 Bearer', 'Bearer or session'], detect: body => /\b(?:authenticate|authorize)\s*\(/.test(body) },
  session: { markers: ['session only'], detect: body => /\bauth\s*\(\s*\)/.test(body) },
  public: { markers: ['public, no auth', 'Auth.js v5 handler'], detect: () => true },
}
/** Narrowest first: a route calling both `isAdmin` and `auth()` is an admin route. */
const MODE_ORDER = ['admin', 'bearer', 'session', 'public']

const ok = label => console.log(`  ok  ${label}`)
const fail = []
const check = (condition, label, detail) => {
  if (condition) ok(label)
  else fail.push(detail ? `${label}\n      ${detail}` : label)
}

/**
 * `app/api/messages/[id]/route.ts` -> `/api/messages/[id]`. Posix separators only.
 * A route group — a segment in parentheses — shapes the source tree, not the URL,
 * so it drops out. Not every route lives under `/api`: `app/llms.txt` is one.
 */
const routePathOf = file =>
  '/' +
  relative(ROOT, file)
    .split(sep)
    .slice(1, -1)
    .filter(segment => !segment.startsWith('('))
    .join('/')

const routeFiles = dir =>
  readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })

/**
 * The source of one exported method, from its `export` keyword to the brace that
 * closes its body. Brace counting, so a sibling method never leaks into this body.
 * The parameter list is skipped FIRST: `({ params }: { params: { id: string } })`
 * carries braces of its own, and counting them would end the body on the signature
 * and report every such route as unauthenticated.
 * Returns null when the method is not exported as a function of its own.
 */
const methodBody = (source, method) =>
  functionBody(source, new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`))

function functionBody(source, pattern) {
  const opener = pattern.exec(source)
  if (!opener) return null
  let parens = 0
  let i = opener.index
  for (; i < source.length; i++) {
    if (source[i] === '(') parens++
    else if (source[i] === ')' && --parens === 0) break
  }
  let depth = 0
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(opener.index, i + 1)
  }
  return source.slice(opener.index)
}

/** The methods a route file exports, as functions or re-exported from a handler. */
function exportedMethods(source) {
  const found = new Set()
  for (const method of HTTP_METHODS) {
    // `export async function GET(` — and `export const GET = withApiLog(getHandler)`,
    // the form every Bearer route takes since the request journal (lib/apiLog.ts).
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`).test(source)) found.add(method)
    else if (new RegExp(`export\\s+const\\s+${method}\\s*=`).test(source)) found.add(method)
  }
  for (const [, names] of source.matchAll(/export\s+const\s*\{([^}]*)\}\s*=/g)) {
    for (const name of names.split(',')) {
      const clean = name.split(':')[0].trim()
      if (HTTP_METHODS.includes(clean)) found.add(clean)
    }
  }
  return [...found]
}

/**
 * The bodies of the file's own non-exported helper functions, by name. A route
 * often keeps its guard in one (`async function guard() { ... isAdmin ... }`),
 * and a method that only CALLS it would otherwise read as unauthenticated.
 */
function localHelpers(source) {
  const helpers = {}
  for (const [, name] of source.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+(\w+)\s*\(/g)) {
    if (HTTP_METHODS.includes(name)) continue
    helpers[name] = functionBody(source, new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`))
  }
  return helpers
}

/** The mode the CODE enforces for one method: narrowest evidence wins. */
const modeOf = (source, method) => {
  let body = methodBody(source, method) ?? source
  const helpers = localHelpers(source)
  // One hop is enough for the shape used here (a method calls its file's guard);
  // ponytail: a guard hidden two hops deep would read as public — widen only if
  // a route ever does that.
  for (const [name, helperBody] of Object.entries(helpers)) {
    if (helperBody && new RegExp(`\\b${name}\\s*\\(`).test(body)) body += '\n' + helperBody
  }
  return MODE_ORDER.find(name => MODES[name].detect(body))
}

/** Reads `app/api/**` into `{ 'GET /api/x': { file, mode } }`. */
function readCode(overrides = {}) {
  const routes = {}
  for (const file of routeFiles(APP_DIR)) {
    const source = overrides[file] ?? readFileSync(file, 'utf8')
    const path = routePathOf(file)
    for (const method of exportedMethods(source)) {
      routes[`${method} ${path}`] = { file: relative(ROOT, file), mode: modeOf(source, method) }
    }
  }
  return routes
}

/**
 * Reads the `### \`METHOD /api/path?query\` — mode` headings of the document.
 * Query strings and the optional-parameter brackets the prose uses (`[?account=…]`)
 * are stripped: they describe a call, not a route. Path segments in brackets
 * (`[id]`) are kept — those ARE the route.
 */
function readDoc(text) {
  const entries = {}
  for (const line of text.split('\n')) {
    const heading = /^###\s+`([^`]+)`(.*)$/.exec(line)
    if (!heading) continue
    const [, target, rest] = heading
    const spaced = target.trim().split(/\s+/)
    // A heading may name a bare path with no method (`/api/auth/[...nextauth]`),
    // which covers every method that path exports. `*` marks it; it expands below.
    const [method, raw] =
      spaced.length === 1 && spaced[0].startsWith('/') ? ['*', spaced[0]] : spaced
    if (!HTTP_METHODS.includes(method) && method !== '*') continue
    const path = raw.replace(/\[\?[^\]]*\]/g, '').split('?')[0].replace(/\/$/, '')
    const mode = MODE_ORDER.find(name => MODES[name].markers.some(marker => rest.includes(marker)))
    // `🔑 Bearer (`accounts:delete`)` — la portée annoncée par le titre, s'il en annonce une.
    const scope = (/\(`([a-z]+:[a-z]+)`\)/.exec(rest) || [])[1] ?? null
    entries[`${method} ${path}`] = { mode, scope, line: line.trim() }
  }
  return entries
}

const BREAK = (/--break=(\w+)/.exec(process.argv.join(' )')) || [])[1]

let docText = readFileSync(DOC_PATH, 'utf8')
let code = readCode()

if (BREAK === 'missing') {
  // Drop the first documented route from a COPY of the document.
  const victim = Object.values(readDoc(docText))[0].line
  docText = docText.replace(victim, '### `GET /api/nothing-here` — session only')
} else if (BREAK === 'ghost') {
  docText += '\n### `DELETE /api/ghost-route` — session only\nA route that does not exist.\n'
} else if (BREAK === 'scope') {
  // Annonce une portée que le code n'exige pas, dans une COPIE du document.
  const victim = Object.entries(readDoc(docText)).find(([key, e]) => e.scope && ROUTE_SCOPES[key])[1]
  docText = docText.replace(victim.line, victim.line.replace(`\`${victim.scope}\``, '`messages:send`'))
} else if (BREAK === 'searchscope') {
  // Efface d'une COPIE du document la ligne de tableau de la portée la plus large.
  const widest = SEARCH_SCOPES[SEARCH_SCOPES.length - 1]
  docText = docText.replace(new RegExp(`^\\|[^\\n]*\`${widest}\`[^\\n]*$`, 'm'), '')
} else if (BREAK === 'mode') {
  // Announce a session-only route as Bearer-eligible, in a COPY of the document.
  const victim = Object.entries(readDoc(docText)).find(([key]) => code[key]?.mode === 'session')[1].line
  docText = docText.replace(victim, victim.replace('— session only', '🔑 Bearer'))
}

const doc = readDoc(docText)
// Expand a method-less heading into the methods its path really exports.
for (const [key, entry] of Object.entries(doc)) {
  if (!key.startsWith('* ')) continue
  delete doc[key]
  const path = key.slice(2)
  for (const method of Object.keys(code).filter(k => k.endsWith(` ${path}`))) doc[method] = entry
}
console.log(`api docs — ${Object.keys(code).length} method/route pairs in the code, ${Object.keys(doc).length} headings in the document`)

const undocumented = Object.keys(code).filter(key => !doc[key]).sort()
check(undocumented.length === 0, 'every exported method has its heading', undocumented.join('\n      '))

const ghosts = Object.keys(doc).filter(key => !code[key]).sort()
check(ghosts.length === 0, 'every heading names a route and a method that exist', ghosts.join('\n      '))

const wrongMode = Object.entries(doc)
  .filter(([key, entry]) => code[key] && entry.mode !== code[key].mode)
  .map(([key, entry]) => `${key}: the document says ${entry.mode ?? 'no mode'}, ${code[key].file} enforces ${code[key].mode}`)
check(wrongMode.length === 0, 'the announced access mode is the one the code enforces', wrongMode.join('\n      '))

// ---- Toute route ouverte aux clés annonce la portée que le code exige --------
// Sans cela, un agent lit « Bearer » et se prend un 403 qu'aucune page n'expliquait.
const bearerKeys = Object.keys(code).filter(key => code[key].mode === 'bearer')

const unscoped = bearerKeys.filter(key => !ROUTE_SCOPES[key]).sort()
check(
  unscoped.length === 0,
  'every route open to keys has its scope in lib/apiScopes.ts',
  unscoped.join('\n      '),
)

const scopeGhosts = Object.keys(ROUTE_SCOPES).filter(key => code[key]?.mode !== 'bearer').sort()
check(
  scopeGhosts.length === 0,
  'every scoped route really is open to keys in the code',
  scopeGhosts.join('\n      '),
)

/**
 * Les titres qui n'annoncent pas encore leur portée. Les sections « messages »,
 * « dossiers », « contacts », « abonnements » et « IA » du document appartiennent à
 * une autre lane en cours : les annoter ici ferait un conflit de fusion. La liste
 * se vide quand ces sections reviennent — voir les deux contrôles ci-dessous, qui
 * empêchent aussi bien d'y ajouter une route neuve que de l'y laisser pourrir.
 */

const wrongScope = bearerKeys
  .filter(key => doc[key] && doc[key].scope !== ROUTE_SCOPES[key])
  .map(key => `${key}: the document says ${doc[key].scope ?? 'no scope'}, the code requires ${ROUTE_SCOPES[key]}`)
  .sort()
check(
  wrongScope.length === 0,
  'the scope announced by each Bearer heading is the one the code requires',
  wrongScope.join('\n      '),
)

// Plus de liste d'attente : au lot P12, TOUTE route Bearer annonce sa portée. Une
// nouvelle en-tête sans portée tombe désormais sur l'assertion ci-dessus, qui la lit
// comme « le document ne dit rien, le code exige X » — c'était l'objet de la liste.
const unannounced = bearerKeys.filter(key => doc[key] && !doc[key].scope).sort()
check(
  unannounced.length === 0,
  'every Bearer heading announces the scope it requires, none pending',
  unannounced.join('\n      '),
)

// Le libellé de `API_SCOPES` est celui de l'ÉCRAN, en français ; le document est en
// anglais. On exige donc que le document nomme chaque portée et lui donne une ligne
// de tableau — pas qu'il recopie un libellé d'interface dans une autre langue.
const scopeRow = scope => new RegExp(`^\\|[^|\\n]*\`${scope}\`[^|\\n]*\\|\\s*\\S`, 'm').test(docText)
const undescribedScopes = [...new Set(Object.values(ROUTE_SCOPES))].filter(s => !scopeRow(s)).sort()
check(
  undescribedScopes.length === 0,
  'the document gives every scope a row of its own, name and meaning',
  undescribedScopes.join('\n      '),
)

// ---- Every SEARCH scope says what it searches (lot S11) ----------------------
// Le défaut corrigé au lot S11 : `scope=accounts` sans flux ignorait silencieusement
// la portée demandée. Un document qui ne dit pas ce que fait chaque portée laisse
// l'appelant le deviner — c'est ainsi qu'un agent a conclu « la recherche plante ».
const searchHeading = /^###\s+`GET \/api\/messages\/search[^`]*`.*$/m.exec(docText)
check(!!searchHeading, 'the search route has its heading')
// La section de la recherche, du titre au titre suivant : une portée nommée trois
// sections plus loin ne documente pas cette route.
const searchSection = searchHeading
  ? docText.slice(searchHeading.index).split(/\n### /)[0]
  : ''
const scopeUndocumented = SEARCH_SCOPES.filter(scope => !new RegExp(`\`${scope}\``).test(searchSection))
check(
  scopeUndocumented.length === 0,
  'the search section names every scope lib/search.ts serves',
  scopeUndocumented.join(', '),
)
// Chaque portée a une LIGNE DE TABLEAU qui dit ce qu'elle cherche : la nommer en
// passant dans une phrase ne suffit pas.
const scopeTableRow = scope =>
  new RegExp(`^\\|[^|\\n]*\`${scope}\`[^|\\n]*\\|[^|\\n]*\\S[^|\\n]*\\|`, 'm').test(searchSection)
const scopeWithoutRow = SEARCH_SCOPES.filter(scope => !scopeTableRow(scope))
check(
  scopeWithoutRow.length === 0,
  'every search scope has a table row saying what it searches',
  scopeWithoutRow.join(', '),
)
// Un balayage tronqué se DIT : les raisons d'arrêt du module sont dans le document,
// sinon l'appelant lit `complete: false` sans savoir ce que ça lui coûte.
const reasonsUndocumented = SWEEP_STOP_REASONS.filter(r => !new RegExp(`\`${r}\``).test(searchSection))
check(
  reasonsUndocumented.length === 0,
  'the search section names every reason a sweep may stop early',
  reasonsUndocumented.join(', '),
)

// The mode reader must look inside the method, not across the file: a route file
// holding one Bearer method and one session method must report both truthfully.
// Mesuré sur une SOURCE FICTIVE, et non sur un fichier du dépôt qui se trouverait
// mélanger les deux : cette propriété du lecteur doit rester vérifiée même quand
// plus aucune route n'est mixte — ce fut le cas de `app/api/contacts/route.ts`
// jusqu'à ce que ses écritures s'ouvrent aux clés (lot P12), et l'assertion serait
// alors devenue verte par disparition de son sujet.
const MIXED_FIXTURE = `
async function getHandler(req) { const gate = await authorize(req); return gate }
export async function POST(req) { const session = await auth(); return session }
export const GET = withApiLog(getHandler)
`
check(
  modeOf(MIXED_FIXTURE, 'GET') === 'bearer' && modeOf(MIXED_FIXTURE, 'POST') === 'session',
  'the mode is read inside each method, so two modes in one file are told apart',
  `GET read as ${modeOf(MIXED_FIXTURE, 'GET')}, POST read as ${modeOf(MIXED_FIXTURE, 'POST')}`,
)

// ---- The document is SERVED, and packaged so it can be ----------------------
// A reference that only exists in the repository is a reference no agent reaches.
const source = file => readFileSync(join(ROOT, file), 'utf8')

check(
  source(join('lib', 'publicPaths.ts')).includes(`'${API_DOC_PATH}'`) &&
    source(join('lib', 'publicPaths.ts')).includes(`'${LLMS_TXT_PATH}'`),
  `${API_DOC_PATH} and ${LLMS_TXT_PATH} are public, so an agent can read them before it has a key`,
)

check(
  /COPY\s[^\n]*\/app\/docs\s/.test(source('Dockerfile')),
  'the image carries docs/, without which the served reference would 404',
)

// The served links must be built from the request, never from a host written here:
// every instance answers under the name its owner chose.
const docsModule = source(join('lib', 'apiDocs.ts'))
check(
  !/https?:\/\/[a-z0-9.-]+/i.test(docsModule.replace(/llmstxt\.org/g, '')),
  'no instance host is written into the served files',
)

const llms = (await import(new URL('../lib/apiDocs.ts', import.meta.url))).buildLlmsTxt('https://example.test')
check(llms.startsWith('# '), 'llms.txt opens with its title, as llmstxt.org asks')
check(/\n> /.test(llms), 'llms.txt carries the summary as a blockquote')
check(llms.includes(`https://example.test${API_DOC_PATH}`), 'llms.txt links the reference at the calling origin')
check(
  /untrusted/i.test(llms),
  'llms.txt tells a reader that mail content is untrusted, where it will read it first',
)

// ---- The public entries name ONE document each -------------------------------
// `startsWith` would hand `/api/docs-probe` to an anonymous caller too.
const prefixOnly = pathname => PUBLIC_PATHS.some(p => pathname.startsWith(p))
const publicPathOf = BREAK === 'prefix' ? prefixOnly : isPublicPath

for (const entry of [API_DOC_PATH, LLMS_TXT_PATH]) {
  check(publicPathOf(entry) === true, `${entry} itself is public`)
  check(publicPathOf(`${entry}?x=1`) === true, `${entry} stays public with a query string`)
  // Negative control: the neighbour must NOT inherit the exemption.
  check(publicPathOf(`${entry}-probe`) === false, `${entry}-probe is NOT public`)
}
// The prefix entries keep matching what lives under them.
check(publicPathOf('/api/auth/callback/credentials') === true, '/api/auth/* stays public')
check(publicPathOf('/api/messages') === false, 'a protected route is still not public')

// ---- The served links carry the PUBLIC origin, not the container's ----------
// Behind a reverse proxy `new URL(req.url).origin` is the container id and port:
// unreachable for an agent, and an internal name disclosed.
const brokenOrigin = req => new URL(req.url).origin
const originOf = BREAK === 'origin' ? brokenOrigin : appOrigin

/** What a proxied request looks like inside the container. */
const proxiedRequest = () =>
  new Request('http://a88ef164e023:3000/llms.txt', {
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'mail.example.test' },
  })

const configuredBefore = process.env.NEXT_PUBLIC_APP_URL
try {
  process.env.NEXT_PUBLIC_APP_URL = 'https://mail.example.test'
  check(
    originOf(proxiedRequest()) === 'https://mail.example.test',
    'the configured address wins over the host the container answers on',
    `got ${originOf(proxiedRequest())}`,
  )
  delete process.env.NEXT_PUBLIC_APP_URL
  check(
    originOf(proxiedRequest()) === 'https://mail.example.test',
    'without the configured address, the forwarded headers are used',
    `got ${originOf(proxiedRequest())}`,
  )
  // Negative control: the container's own host must never reach a reader.
  check(
    !originOf(proxiedRequest()).includes('a88ef164e023'),
    'the internal host is never served to a reader',
  )
} finally {
  if (configuredBefore === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = configuredBefore
}

// One source for that origin: no route may read the variable on its own again.
const readers = routeFiles(APP_DIR)
  .concat([join(ROOT, 'lib', 'msOAuth.ts')])
  .filter(file => /NEXT_PUBLIC_APP_URL/.test(readFileSync(file, 'utf8')))
  .map(file => relative(ROOT, file))
check(readers.length === 0, 'the public origin is read in ONE module', readers.join(', '))

// That one module must read the address at RUN time. Spelled literally,
// `process.env.NEXT_PUBLIC_APP_URL` is replaced by its build-time value, so an
// image built without it would serve an empty origin whatever the deployment sets.
const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const originModule = withoutComments(
  BREAK === 'inline'
    ? 'const configured = process.env.NEXT_PUBLIC_APP_URL'
    : source(join('lib', 'appOrigin.ts')),
)
check(
  !/process\.env\s*\.\s*NEXT_PUBLIC_APP_URL/.test(originModule),
  'the address is read at run time, not frozen into the image at build time',
)

// ---- The OpenAPI contract describes the Bearer routes, and ONLY those --------
// A contract holding a session-only route generates calls that answer 401; a
// contract missing a Bearer route hides a capability an agent could have used.
const contract = JSON.parse(
  BREAK === 'ref'
    ? readFileSync(join(ROOT, OPENAPI_FILE), 'utf8').replace('#/components/schemas/Error', '#/components/schemas/Nowhere')
    : readFileSync(join(ROOT, OPENAPI_FILE), 'utf8'),
)
// The stream is an OPT-IN of the caller (PR-29 follow-up): a key that never sends
// `stream=1` keeps the single JSON object. So the contract must name the parameter
// and the NDJSON answer it switches to — a generated client that does not know
// the parameter cannot ask for it, and one that reads only `application/json`
// would crash on `json()` when it does. `--break=stream` hides both.
if (BREAK === 'stream') {
  const search = contract.paths['/api/messages/search'].get
  search.parameters = search.parameters.filter(p => p.name !== STREAM_PARAM)
  delete search.responses['200']
  search.responses['200'] = { $ref: '#/components/responses/MessageList' }
}

/** `/api/messages/{id}` in the contract is `/api/messages/[id]` in the tree. */
const codePathOf = contractPath => contractPath.replace(/\{(\w+)\}/g, '[$1]')

/** `{ 'GET /api/messages': operation }`, the contract read the way the code is. */
const operations = {}
for (const [path, item] of Object.entries(contract.paths)) {
  for (const [method, operation] of Object.entries(item)) {
    if (!HTTP_METHODS.includes(method.toUpperCase())) continue
    operations[`${method.toUpperCase()} ${codePathOf(path)}`] = operation
  }
}

let bearerRoutes = Object.entries(code)
  .filter(([, { mode }]) => mode === 'bearer')
  .map(([key]) => key)
if (BREAK === 'contract') bearerRoutes = [...bearerRoutes, 'GET /api/not-in-the-contract']
if (BREAK === 'session') {
  const sessionRoute = Object.entries(code).find(([, { mode }]) => mode === 'session')[0]
  operations[sessionRoute] = { operationId: 'smuggled', responses: { 200: {} }, security: [] }
}

console.log(
  `openapi — ${bearerRoutes.length} Bearer method/route pairs in the code, ${Object.keys(operations).length} operations in the contract`,
)

const absent = bearerRoutes.filter(key => !operations[key]).sort()
check(absent.length === 0, 'every Bearer route of the code is an operation of the contract', absent.join('\n      '))

const strangers = Object.keys(operations)
  .filter(key => code[key]?.mode !== 'bearer')
  .map(key => `${key}: the contract describes it, ${code[key] ? `${code[key].file} enforces ${code[key].mode}` : 'no route exports it'}`)
check(strangers.length === 0, 'the contract describes nothing a key cannot call', strangers.join('\n      '))

/** What a `#/…` reference points at inside the contract, or `undefined`. */
const resolveRef = ref =>
  ref.startsWith('#/')
    ? ref.slice(2).split('/').reduce((node, segment) => (node == null ? undefined : node[segment]), contract)
    : undefined
const resolve = ref => resolveRef(ref) !== undefined
/** The node itself, or the node its `$ref` points at. */
const resolveNode = node => (node?.$ref ? resolveRef(node.$ref) : node)

// ---- The search stream is the caller's choice, and the contract says so -----
const streamMediaType = STREAM_CONTENT_TYPE.split(';')[0].trim()
const searchOp = operations['GET /api/messages/search']
const searchParams = (searchOp?.parameters ?? []).map(resolveNode).filter(Boolean)
const streamParam = searchParams.find(p => p.name === STREAM_PARAM)
check(!!streamParam, `the contract names \`${STREAM_PARAM}\` as a parameter of the search route`)
check(
  (streamParam?.description ?? '').includes(streamMediaType),
  `that parameter says the answer becomes ${streamMediaType}`,
)
const scopeParam = searchParams.find(p => p.name === 'scope')
const scopesMissing = SEARCH_SCOPES.filter(scope => !(scopeParam?.schema?.enum ?? []).includes(scope))
check(scopesMissing.length === 0, 'the contract enumerates every search scope lib/search.ts serves', scopesMissing.join(', '))
const searchAnswer = resolveNode(searchOp?.responses?.['200'])
check(
  !!searchAnswer?.content?.[streamMediaType] && !!searchAnswer?.content?.['application/json'],
  `the search answer is described as application/json AND ${streamMediaType}`,
  JSON.stringify(Object.keys(searchAnswer?.content ?? {})),
)
check(
  source(join('app', 'api', 'messages', 'search', 'route.ts')).includes('STREAM_CONTENT_TYPE') &&
    !source(join('app', 'api', 'messages', 'search', 'route.ts')).includes(streamMediaType),
  'the route announces the stream through STREAM_CONTENT_TYPE, never a retyped media type',
)

// ---- The contract is structurally sound, without a new dependency -----------
check(/^3\.1\.\d+$/.test(contract.openapi ?? ''), `the contract declares OpenAPI 3.1 (got ${contract.openapi})`)
check(
  contract.components?.securitySchemes?.bearerAuth?.scheme === 'bearer',
  'the contract declares the bearerAuth scheme the routes actually use',
)
check(
  Array.isArray(contract.security) && contract.security.some(entry => 'bearerAuth' in entry),
  'the contract requires that scheme by default, so no operation reads as open',
)

const unanswered = Object.entries(operations)
  .filter(([, operation]) => Object.keys(operation.responses ?? {}).length === 0)
  .map(([key]) => key)
check(unanswered.length === 0, 'every operation says what it answers', unanswered.join('\n      '))

const unidentified = Object.entries(operations)
  .filter(([, operation]) => !operation.operationId)
  .map(([key]) => key)
check(unidentified.length === 0, 'every operation carries an operationId, which generators name calls after', unidentified.join('\n      '))

const unsecured = Object.entries(operations)
  .filter(([, operation]) => Array.isArray(operation.security) && operation.security.length === 0)
  .map(([key]) => key)
check(unsecured.length === 0, 'no operation opts out of authentication', unsecured.join('\n      '))

/** Every `$ref` of the document, wherever it sits. */
const refsOf = node =>
  node && typeof node === 'object'
    ? Object.entries(node).flatMap(([key, value]) => (key === '$ref' ? [value] : refsOf(value)))
    : []

const danglingRefs = [...new Set(refsOf(contract))].filter(ref => !resolve(ref)).sort()
check(danglingRefs.length === 0, 'every $ref of the contract resolves', danglingRefs.join('\n      '))

// The contract is SERVED, and reachable before a key exists.
check(
  source(join('lib', 'publicPaths.ts')).includes(`'${OPENAPI_PATH}'`),
  `${OPENAPI_PATH} is public, so an agent can read the contract before it has a key`,
)
check(publicPathOf(OPENAPI_PATH) === true, `${OPENAPI_PATH} itself is public`)
check(publicPathOf(`${OPENAPI_PATH}-probe`) === false, `${OPENAPI_PATH}-probe is NOT public`)
check(llms.includes(`https://example.test${OPENAPI_PATH}`), 'llms.txt links the contract at the calling origin')

// A host written into the FILE would send every agent to somebody else's
// mailbox. The file names none; the route puts this instance's own address in
// as it serves, because several agent-tool importers need an absolute base URL.
check(
  contract.servers?.every(server => !/^https?:\/\//i.test(server.url)),
  'the contract file on disk names no instance host',
  JSON.stringify(contract.servers),
)

const served = JSON.parse(
  (BREAK === 'servers' ? contractText => contractText : withServedOrigin)(
    readFileSync(join(ROOT, OPENAPI_FILE), 'utf8'),
    'https://mail.example.test',
  ),
)
check(
  served.servers?.length === 1 && served.servers[0].url === 'https://mail.example.test',
  'served, the contract names the address this instance answers on',
  JSON.stringify(served.servers),
)
check(
  JSON.parse(withServedOrigin(readFileSync(join(ROOT, OPENAPI_FILE), 'utf8'), '')).servers?.[0]?.url === '/',
  'with no address known, the served contract keeps the relative fallback',
)
check(
  JSON.stringify(Object.keys(served)) === JSON.stringify(Object.keys(contract)),
  'serving the contract changes its servers entry and nothing else',
)
check(
  source(join('app', 'openapi.json', 'route.ts')).includes('withServedOrigin('),
  'the route serves the contract through that one helper, not a copy of it',
)

if (BREAK) {
  if (fail.length === 0) {
    console.error(`\nKO: negative control --break=${BREAK} was NOT caught — this battery proves nothing`)
    process.exit(1)
  }
  console.log(`\n  ok  negative control: --break=${BREAK} IS caught by this battery`)
  console.log(`      (${fail.length} check(s) failed, as expected)`)
  console.log('\napi docs: negative control passed')
  process.exit(0)
}

if (fail.length) {
  console.error('\nKO: the document and the code disagree\n')
  for (const detail of fail) console.error(`  KO  ${detail}`)
  process.exit(1)
}
console.log('\napi docs: all checks passed')
