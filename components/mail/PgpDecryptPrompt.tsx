'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { decryptText, getStoredIdentity } from '@/lib/pgp'
import { usePgpSession } from '@/components/pgp/PgpSessionProvider'

export function PgpDecryptPrompt({
  armoredMessage,
  onDecrypted,
}: {
  armoredMessage: string
  onDecrypted: (plaintext: string) => void
}) {
  const t = useTranslations('pgp.decrypt')
  const pgpSession = usePgpSession()
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const runDecrypt = async () => {
    setError(null)
    setBusy(true)
    try {
      const key = pgpSession.getUnlockedKey()
      if (key) {
        const plaintext = await decryptText(armoredMessage, key)
        onDecrypted(plaintext)
        return
      }

      const identity = await getStoredIdentity()
      if (!identity) {
        setError(t('noKey'))
        return
      }

      await pgpSession.unlock(passphrase)
      const unlockedKey = pgpSession.getUnlockedKey()
      if (!unlockedKey) throw new Error('unlock failed')
      const plaintext = await decryptText(armoredMessage, unlockedKey)
      onDecrypted(plaintext)
    } catch {
      setError(t('wrongPassphrase'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-6 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300">
          {pgpSession.isUnlocked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </span>
        <p className="text-sm font-medium">{t('title')}</p>
      </div>

      {pgpSession.isUnlocked ? (
        <Button size="sm" onClick={runDecrypt} disabled={busy}>
          {busy ? t('decrypting') : t('unlockedButton')}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('passphrasePrompt')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runDecrypt() }}
              className="h-8 text-sm" containerClassName="max-w-xs"
              autoFocus
            />
            <Button size="sm" onClick={runDecrypt} disabled={busy || !passphrase}>
              {busy ? t('decrypting') : t('button')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-destructive">
          {error}
          {error === t('noKey') && (
            <p className="text-muted-foreground mt-0.5">{t('noKeyHint')}</p>
          )}
        </div>
      )}
    </div>
  )
}
