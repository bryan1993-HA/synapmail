import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { getAccountById } from '@/lib/accounts'
import { decrypt } from '@/lib/encrypt'
import {
  TEST_DECISION,
  classifyTestFailure,
  resolveTestPassword,
} from '@/lib/accountTest'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as { id: string }).id

  try {
    const {
      accountId, imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure, username, password,
    } = await req.json()

    if (!imapHost || !smtpHost || !username) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Which password to try — the decision lives in `lib/accountTest.ts`, standalone and
    // executable. The account is loaded through `getAccountById`, which only accepts its
    // OWNER: a guest on a shared mailbox cannot test its credentials. The stored password
    // is decrypted ONLY when the decision is `STORED`, hence only towards the REGISTERED
    // hosts: the form comes from the browser, and a stolen session must not be able to
    // have it read out to a server of its own choosing.
    let storedEncrypted: string | null = null
    const { decision, password: pass, connection } = await resolveTestPassword(
      {
        accountId, password, username,
        imapHost, imapPort, imapSecure,
        smtpHost, smtpPort, smtpSecure,
      },
      async id => {
        const account = await getAccountById(id, userId)
        if (!account) return null
        storedEncrypted = account.password_encrypted || null
        return {
          isOwner: true,
          oauthProvider: account.oauth_provider,
          hasStoredPassword: Boolean(account.password_encrypted),
          imapHost: account.imap_host,
          imapPort: account.imap_port,
          imapSecure: account.imap_secure,
          smtpHost: account.smtp_host,
          smtpPort: account.smtp_port,
          smtpSecure: account.smtp_secure,
          username: account.username,
        }
      },
      async () => decrypt(storedEncrypted ?? '')
    )

    if (decision === TEST_DECISION.DENIED) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (decision === TEST_DECISION.OAUTH) {
      return NextResponse.json({ tested: decision })
    }
    if (decision === TEST_DECISION.MISSING) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    // No connection is attempted: the form points at a different server, so the caller
    // must supply the password.
    if (decision === TEST_DECISION.PASSWORD_REQUIRED || pass === null || !connection) {
      return NextResponse.json({ error: TEST_DECISION.PASSWORD_REQUIRED }, { status: 400 })
    }

    // Test IMAP
    let imapOk = false
    let imapError = ''
    try {
      const client = new ImapFlow({
        host: connection.imapHost,
        port: connection.imapPort,
        secure: connection.imapSecure,
        auth: { user: connection.username, pass },
        logger: false,
        tls: { rejectUnauthorized: false },
      })
      await client.connect()
      await client.logout()
      imapOk = true
    } catch (e) {
      imapError = classifyTestFailure(String(e instanceof Error ? e.message : e))
    }

    // Test SMTP
    let smtpOk = false
    let smtpError = ''
    try {
      const transport = nodemailer.createTransport({
        host: connection.smtpHost,
        port: connection.smtpPort,
        secure: connection.smtpSecure,
        auth: { user: connection.username, pass },
        tls: { rejectUnauthorized: false },
      })
      await transport.verify()
      smtpOk = true
    } catch (e) {
      smtpError = classifyTestFailure(String(e instanceof Error ? e.message : e))
    }

    return NextResponse.json({
      tested: decision,
      imap: { ok: imapOk, error: imapError },
      smtp: { ok: smtpOk, error: smtpError },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
