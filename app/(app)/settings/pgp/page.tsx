'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { KeyRound, Download, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Label } from '@/components/ui/label'
import { SettingsPage, SettingsHeader, SettingsSection } from '@/components/settings/primitives'
import { RowMenu, ContextMenuItem, MENU_ICON } from '@/components/ui/ContextMenu'
import {
  generateKeypair, readPublicKeyInfo, unlockPrivateKey,
  saveIdentity, getStoredIdentity, clearStoredIdentity,
  type StoredIdentity,
} from '@/lib/pgp'
import type { PgpContactKey, PgpIdentity } from '@/types/pgp'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function formatFingerprint(fp: string) {
  return fp.toUpperCase().match(/.{1,4}/g)?.join(' ') ?? fp
}

export default function PgpPage() {
  const t = useTranslations('pgp')
  const tRow = useTranslations('settings.rowActions')

  const { data: profileData } = useSWR<{ data: { name: string; email: string } }>('/api/profile', fetcher)
  const { mutate: mutateMe } = useSWR<{ data: PgpIdentity | null }>('/api/pgp/me', fetcher)
  const { data: contactsData, mutate: mutateContacts } = useSWR<{ data: PgpContactKey[] }>('/api/pgp/contacts', fetcher)
  const contacts = contactsData?.data ?? []

  const [localIdentity, setLocalIdentity] = useState<StoredIdentity | null>(null)
  const [loadedLocal, setLoadedLocal] = useState(false)

  useEffect(() => {
    getStoredIdentity().then(id => { setLocalIdentity(id); setLoadedLocal(true) })
  }, [])

  // Generation form
  const [genName, setGenName] = useState('')
  const [genEmail, setGenEmail] = useState('')
  const [genPassphrase, setGenPassphrase] = useState('')
  const [genConfirm, setGenConfirm] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  useEffect(() => {
    if (profileData?.data) {
      setGenName(prev => prev || profileData.data.name)
      setGenEmail(prev => prev || profileData.data.email)
    }
  }, [profileData])

  const publishIdentity = async (fingerprint: string, armoredPublicKey: string) => {
    await fetch('/api/pgp/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint, armoredPublicKey }),
    })
    await mutateMe()
  }

  const handleGenerate = async () => {
    setGenError(null)
    if (genPassphrase.length < 8) { setGenError(t('myKey.passphraseTooShort')); return }
    if (genPassphrase !== genConfirm) { setGenError(t('myKey.passphraseMismatch')); return }
    setGenerating(true)
    try {
      const kp = await generateKeypair(genPassphrase, genName, genEmail)
      const identity: StoredIdentity = {
        armoredPublicKey: kp.armoredPublicKey,
        armoredPrivateKey: kp.armoredPrivateKey,
        fingerprint: kp.fingerprint,
        email: genEmail,
        name: genName,
        createdAt: new Date().toISOString(),
      }
      await saveIdentity(identity)
      setLocalIdentity(identity)
      await publishIdentity(kp.fingerprint, kp.armoredPublicKey)
      setGenPassphrase('')
      setGenConfirm('')
    } catch (err) {
      setGenError(String(err))
    } finally {
      setGenerating(false)
    }
  }

  const handleRegenerate = async () => {
    if (!confirm(t('myKey.regenerateConfirm'))) return
    await clearStoredIdentity()
    setLocalIdentity(null)
  }

  const handleDownloadPublic = () => {
    if (!localIdentity) return
    downloadTextFile(`${localIdentity.email}-public.asc`, localIdentity.armoredPublicKey)
  }
  const handleDownloadPrivate = () => {
    if (!localIdentity) return
    downloadTextFile(`${localIdentity.email}-private-backup.asc`, localIdentity.armoredPrivateKey)
  }

  // Import backup (restore private key on a new browser)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const handleImportBackup = async () => {
    if (!importFile) return
    setImportError(null)
    setImporting(true)
    try {
      const armoredPrivateKey = await importFile.text()
      const unlocked = await unlockPrivateKey(armoredPrivateKey, importPassphrase)
      const armoredPublicKey = unlocked.toPublic().armor()
      const info = await readPublicKeyInfo(armoredPublicKey)
      const identity: StoredIdentity = {
        armoredPublicKey,
        armoredPrivateKey,
        fingerprint: info.fingerprint,
        email: info.email,
        name: info.name,
        createdAt: new Date().toISOString(),
      }
      await saveIdentity(identity)
      setLocalIdentity(identity)
      await publishIdentity(identity.fingerprint, identity.armoredPublicKey)
      setImportFile(null)
      setImportPassphrase('')
    } catch {
      setImportError(t('myKey.backupInvalid'))
    } finally {
      setImporting(false)
    }
  }

  // Contact key import
  const [contactEmail, setContactEmail] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactArmored, setContactArmored] = useState('')
  const [contactError, setContactError] = useState<string | null>(null)
  const [addingContact, setAddingContact] = useState(false)

  const handleContactFile = async (file: File) => {
    setContactArmored(await file.text())
  }

  const handleAddContactKey = async () => {
    setContactError(null)
    if (!contactArmored.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) {
      setContactError(t('contactKeys.invalidKey'))
      return
    }
    setAddingContact(true)
    try {
      const info = await readPublicKeyInfo(contactArmored)
      const email = contactEmail.trim() || info.email
      const res = await fetch('/api/pgp/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: contactName.trim() || info.name || null,
          armoredKey: contactArmored,
          fingerprint: info.fingerprint,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Error')
      }
      await mutateContacts()
      setContactEmail('')
      setContactName('')
      setContactArmored('')
    } catch (err) {
      setContactError(err instanceof Error ? err.message : t('contactKeys.invalidKey'))
    } finally {
      setAddingContact(false)
    }
  }

  const handleDeleteContact = async (contact: PgpContactKey) => {
    if (!confirm(tRow('pgpKeyDeleteConfirm', { name: contact.name || contact.email }))) return
    await fetch(`/api/pgp/contacts/${contact.id}`, { method: 'DELETE' })
    await mutateContacts()
  }

  return (
    <SettingsPage width="2xl">
      <SettingsHeader icon={<KeyRound className="h-4 w-4" />} title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <SettingsSection title={t('myKey.title')}>
          {!loadedLocal ? null : localIdentity ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('myKey.fingerprint')}</p>
                <p className="font-mono text-sm break-all">{formatFingerprint(localIdentity.fingerprint)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleDownloadPublic} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> {t('myKey.downloadPublic')}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadPrivate} className="gap-1.5">
                  <Download className="w-3.5 h-3.5" /> {t('myKey.downloadPrivateBackup')}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleRegenerate} className="gap-1.5 text-destructive hover:text-destructive">
                  <RotateCcw className="w-3.5 h-3.5" /> {t('myKey.regenerate')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('myKey.noKeyText')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('myKey.name')}</Label>
                  <Input value={genName} onChange={e => setGenName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('myKey.email')}</Label>
                  <Input value={genEmail} onChange={e => setGenEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('myKey.passphrase')}</Label>
                  <PasswordInput value={genPassphrase} onChange={e => setGenPassphrase(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('myKey.confirmPassphrase')}</Label>
                  <PasswordInput value={genConfirm} onChange={e => setGenConfirm(e.target.value)} />
                </div>
              </div>
              {genError && <p className="text-sm text-destructive">{genError}</p>}
              <Button size="sm" onClick={handleGenerate} disabled={generating || !genName.trim() || !genEmail.trim()}>
                {generating ? t('myKey.generating') : t('myKey.generate')}
              </Button>

              <div className="pt-3 border-t border-border space-y-2">
                <p className="text-xs font-medium">{t('myKey.importBackupTitle')}</p>
                <input
                  type="file"
                  accept=".asc,text/plain"
                  onChange={e => setImportFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-muted-foreground"
                />
                <PasswordInput
                  placeholder={t('myKey.importBackupPassphrase')}
                  value={importPassphrase}
                  onChange={e => setImportPassphrase(e.target.value)}
                  className="h-8 text-sm" containerClassName="max-w-xs"
                />
                {importError && <p className="text-sm text-destructive">{importError}</p>}
                <div>
                  <Button size="sm" variant="outline" onClick={handleImportBackup} disabled={!importFile || importing}>
                    {t('myKey.importBackupButton')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SettingsSection>

        <SettingsSection title={t('contactKeys.title')} description={t('contactKeys.description')}>
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('contactKeys.empty')}</p>
          ) : (
            <div className="space-y-2">
              {contacts.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name || c.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                    <p className="text-xs font-mono text-muted-foreground truncate">{formatFingerprint(c.fingerprint)}</p>
                  </div>
                  <div className="shrink-0">
                    <RowMenu label={tRow('menu', { name: c.name || c.email })} itemsKey={c.id}>
                      {close => (
                        <ContextMenuItem
                          itemKey="delete" icon={<Trash2 className={MENU_ICON} />} label={tRow('pgpKeyDelete')}
                          onClick={() => handleDeleteContact(c)} onClose={close} enabled danger
                        />
                      )}
                    </RowMenu>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-border space-y-2">
            <p className="text-xs font-medium">{t('contactKeys.import')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder={t('contactKeys.email')} value={contactEmail} onChange={e => setContactEmail(e.target.value)} className="h-8 text-sm" />
              <Input placeholder={t('contactKeys.name')} value={contactName} onChange={e => setContactName(e.target.value)} className="h-8 text-sm" />
            </div>
            <textarea
              value={contactArmored}
              onChange={e => setContactArmored(e.target.value)}
              placeholder={t('contactKeys.pastePlaceholder')}
              rows={4}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono outline-none focus:ring-2 focus:ring-violet-500/40"
            />
            <input
              type="file"
              accept=".asc,text/plain"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleContactFile(f) }}
              className="text-xs text-muted-foreground"
            />
            {contactError && <p className="text-sm text-destructive">{contactError}</p>}
            <div>
              <Button size="sm" onClick={handleAddContactKey} disabled={addingContact || !contactArmored.trim()}>
                {t('contactKeys.add')}
              </Button>
            </div>
          </div>
        </SettingsSection>
      </div>
    </SettingsPage>
  )
}
