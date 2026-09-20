/**
 * WHICH password the "Test connection" button tries, and for WHOM.
 *
 * Measured in production on 20/09/2026: the button was lying. The edit screen never shows the
 * stored password (it does not leave the server), so the field starts empty; the test
 * sent the CONTENT of the field anyway. Empty, the route answered "Missing fields";
 * filled in without the person's knowledge by the browser password manager, it was
 * the WEBMAIL password that went out to the hosting provider. Each attempt was worth two
 * failed authentications, and the hosting provider eventually locks the account for good.
 *
 * The decision lives here, outside the route, so it can be run on its own: no database, no
 * network, no browser. It NEVER returns the password, neither in clear text nor
 * encrypted: it says which one to try, and the route goes and fetches it.
 */

/** What the route must do, once the decision is made. */
export const TEST_DECISION = {
  /** Try the password the person just typed. */
  SUBMITTED: 'submitted',
  /** Try the STORED password, decrypted server side. */
  STORED: 'stored',
  /** Nothing to try: the account authenticates by token. */
  OAUTH: 'oauth',
  /** Refusal: the account does not exist, or the person is not its owner. */
  DENIED: 'denied',
  /** Refusal: no password to try (creation without a password typed in). */
  MISSING: 'missing',
  /**
   * Refusal: the form targets ANOTHER server (or another username) than the
   * stored one, and nobody typed a password. The stored password only goes out
   * to the stored hosts: otherwise a stolen session would be enough to have it read in
   * clear text by a server chosen by the attacker, in the LOGIN command.
   */
  PASSWORD_REQUIRED: 'password_required',
} as const

export type TestDecision = (typeof TEST_DECISION)[keyof typeof TEST_DECISION]

/** Default ports, when neither the account nor the form provides a usable one. */
export const DEFAULT_IMAP_PORT = 993
export const DEFAULT_SMTP_PORT = 587

/** Where and how to connect. The password travels separately: it is not a setting. */
export interface TestConnection {
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
}

/** The bare minimum the decision reads from an account. Never the password itself. */
export interface TestableAccount {
  isOwner: boolean
  oauthProvider: string | null
  hasStoredPassword: boolean
  /** The STORED settings: the only destinations of the stored password. */
  imapHost: string | null
  imapPort?: number | null
  imapSecure?: boolean | null
  smtpHost: string | null
  smtpPort?: number | null
  smtpSecure?: boolean | null
  username: string | null
}

export interface TestRequest {
  /** Present on EDIT, absent on CREATION. */
  accountId?: string | null
  /** What the field contains. Empty on edit means "unchanged". */
  password?: string | null
  /** What the FORM targets. Compared against the stored values before sending a secret. */
  imapHost?: string | null
  imapPort?: number | string | null
  imapSecure?: boolean | null
  smtpHost?: string | null
  smtpPort?: number | string | null
  smtpSecure?: boolean | null
  username?: string | null
}

/**
 * Loads what the decision needs to know about an account, or null if it is out of
 * reach. Injected so the self-check can run without a database.
 */
export type AccountLoader = (accountId: string) => Promise<TestableAccount | null>

/**
 * Fetches the STORED password, in clear text. Only called after a `STORED`
 * decision: any other decision must leave it alone, and the self-check measures that.
 */
export type StoredPasswordLoader = () => Promise<string>

/**
 * A password made of whitespace is not a password: it is an empty field that would
 * be sent to the hosting provider anyway, so one more authentication failure.
 */
export const hasSubmittedPassword = (password?: string | null): boolean =>
  typeof password === 'string' && password.trim().length > 0

/**
 * A hostname and a username are compared ignoring case and edge
 * whitespace: `IMAP.Example.com ` and `imap.example.com` are the same server, and refusing the
 * test over a capital letter would make the rule look like a bug.
 */
const sameSetting = (a?: string | null, b?: string | null): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/**
 * Does the form target EXACTLY the stored server? The port and the TLS option
 * stay free: a port can be corrected and retried without having to retype the password,
 * and a port does not change who the secret is entrusted to. The host and the username do.
 */
export const targetsSavedServer = (req: TestRequest, account: TestableAccount): boolean =>
  sameSetting(req.imapHost, account.imapHost) &&
  sameSetting(req.smtpHost, account.smtpHost) &&
  sameSetting(req.username, account.username)

export async function decideTestPassword(
  req: TestRequest,
  loadAccount: AccountLoader
): Promise<TestDecision> {
  const submitted = hasSubmittedPassword(req.password)

  // Creation: there is no account, so nothing stored. Behavior unchanged.
  if (!req.accountId) return submitted ? TEST_DECISION.SUBMITTED : TEST_DECISION.MISSING

  const account = await loadAccount(req.accountId)
  // A guest does not test the credentials of a shared mailbox: they are not theirs.
  // Same answer as for an unknown account, so as not to reveal that it exists.
  if (!account || !account.isOwner) return TEST_DECISION.DENIED

  // A TYPED password wins: it is the gesture of someone changing their password who wants
  // to try it before saving.
  if (submitted) return TEST_DECISION.SUBMITTED
  if (account.oauthProvider) return TEST_DECISION.OAUTH
  if (!account.hasStoredPassword) return TEST_DECISION.MISSING

  // The stored password goes ONLY where it is already known. The form comes from the
  // browser: without this rule, a stolen session would request the test against a rogue
  // server and read it in clear text in the LOGIN command, for every mailbox.
  return targetsSavedServer(req, account)
    ? TEST_DECISION.STORED
    : TEST_DECISION.PASSWORD_REQUIRED
}

/**
 * The whole server step: decide, THEN fetch the secret only if the decision
 * calls for it. The stored password is decrypted only on a `STORED`; any other
 * verdict leaves the loader at rest, and the self-check verifies it.
 */
const port = (value: number | string | null | undefined, fallback: number): number =>
  Number(value) || fallback

const text = (value: string | null | undefined): string => (value ?? '').trim()

/**
 * A single factory, two sources. The DESTINATION (hosts, username) and the TUNING
 * (ports, TLS) do not answer the same question: the first says to WHOM the password
 * is entrusted (that is the security boundary), the second says HOW we knock on the
 * door. The defaults live only here, never copied from one call to another.
 */
type ConnectionTarget = {
  imapHost?: string | null
  smtpHost?: string | null
  username?: string | null
}
type ConnectionTuning = {
  imapPort?: number | string | null
  imapSecure?: boolean | null
  smtpPort?: number | string | null
  smtpSecure?: boolean | null
}

const buildConnection = (target: ConnectionTarget, tuning: ConnectionTuning): TestConnection => ({
  imapHost: text(target.imapHost),
  imapPort: port(tuning.imapPort, DEFAULT_IMAP_PORT),
  imapSecure: tuning.imapSecure ?? true,
  smtpHost: text(target.smtpHost),
  smtpPort: port(tuning.smtpPort, DEFAULT_SMTP_PORT),
  smtpSecure: tuning.smtpSecure ?? false,
  username: text(target.username),
})

/** The FORM settings: what is tried when the person has typed their password. */
export const formConnection = (req: TestRequest): TestConnection => buildConnection(req, req)

/**
 * What is contacted when it is the STORED password that goes out. The HOSTS and
 * the USERNAME come from the account: `targetsSavedServer` has established that the form
 * designates that server, and connecting with the account values removes the last
 * difference between what is COMPARED and what is CONTACTED (an edge space, a
 * capital letter, were enough to reach a host accepted under another spelling).
 *
 * The PORTS and TLS come from the FORM: that is the very use of the button, trying a
 * setting BEFORE saving it (587 -> 465, ticking TLS to repair a mailbox). On
 * the stored host, changing port entrusts the secret to nobody else; refusing the
 * correction would force saving an unverified setting, or retyping the password
 * for nothing.
 */
export const savedConnection = (account: TestableAccount, req: TestRequest): TestConnection =>
  buildConnection(account, req)

export async function resolveTestPassword(
  req: TestRequest,
  loadAccount: AccountLoader,
  loadStoredPassword: StoredPasswordLoader
): Promise<{ decision: TestDecision; password: string | null; connection: TestConnection | null }> {
  let loaded: TestableAccount | null = null
  const decision = await decideTestPassword(req, async id => {
    loaded = await loadAccount(id)
    return loaded
  })
  if (decision === TEST_DECISION.STORED && loaded) {
    return {
      decision,
      password: await loadStoredPassword(),
      connection: savedConnection(loaded, req),
    }
  }
  if (decision === TEST_DECISION.SUBMITTED) {
    return { decision, password: req.password ?? null, connection: formConnection(req) }
  }
  return { decision, password: null, connection: null }
}

/** The two common failures, translated into a CAUSE instead of the raw server error. */
export const TEST_FAILURE = {
  /** The host answered, and it refused the credentials. */
  CREDENTIALS: 'credentials',
  /** The host did not answer: name not found, port closed, timeout exceeded. */
  UNREACHABLE: 'unreachable',
  /** Everything else: shown as is rather than filed under the wrong category. */
  OTHER: 'other',
} as const

export type TestFailure = (typeof TEST_FAILURE)[keyof typeof TEST_FAILURE]

/**
 * Patterns read in the messages actually returned by servers and libraries:
 * `535 Invalid login` (SMTP), `Invalid credentials` / `AUTHENTICATIONFAILED` (IMAP) for
 * the refusal; `ENOTFOUND` / `ECONNREFUSED` / `ETIMEDOUT` for unreachable.
 */
const CREDENTIAL_PATTERNS = [
  /\b535\b/,
  /\b(authenticationfailed|authentication failed)\b/i,
  /invalid (login|credentials|user)/i,
  /\bauth(entication)? (failure|unsuccessful)\b/i,
]
const UNREACHABLE_PATTERNS = [
  /\b(enotfound|econnrefused|etimedout|ehostunreach|enetunreach|eai_again|econnreset)\b/i,
  /\btimed? ?out\b/i,
  /getaddrinfo/i,
]

export function classifyTestFailure(message: string): TestFailure {
  if (CREDENTIAL_PATTERNS.some(p => p.test(message))) return TEST_FAILURE.CREDENTIALS
  if (UNREACHABLE_PATTERNS.some(p => p.test(message))) return TEST_FAILURE.UNREACHABLE
  return TEST_FAILURE.OTHER
}
