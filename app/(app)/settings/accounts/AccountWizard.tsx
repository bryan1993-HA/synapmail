'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Wifi, Info, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Vrais logos brand SVG ────────────────────────────────────────────────────

function GmailLogo() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"/>
      <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"/>
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"/>
      <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0 C4.924,8,3,9.924,3,12.298z"/>
      <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0 C43.076,8,45,9.924,45,12.298z"/>
    </svg>
  )
}

function OutlookLogo() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="outGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#35b8f1"/>
          <stop offset="100%" stopColor="#0078d4"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="9" fill="url(#outGrad)"/>
      <rect x="7" y="13" width="34" height="23" rx="3" fill="white"/>
      <path fill="none" stroke="#0078d4" strokeWidth="2.5" strokeLinejoin="round" d="M7 13 L24 27 L41 13"/>
    </svg>
  )
}

function YahooLogo() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#5f01d1"/>
      <path fill="white" d="M8 12 L18 28 L18 38 L22 38 L22 28 L32 12 L28 12 L20 25 L12 12 Z"/>
      <circle cx="36" cy="36" r="4" fill="white"/>
    </svg>
  )
}

function ICloudLogo() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="icloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#64b5f6"/>
          <stop offset="100%" stopColor="#1565c0"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="9" fill="url(#icloudGrad)"/>
      <path fill="white" d="M36 31H13a7 7 0 0 1-.9-13.9A11 11 0 0 1 33.5 22a6 6 0 0 1 2.5 9z"/>
    </svg>
  )
}

function ProtonLogo() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="protonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b6fff"/>
          <stop offset="100%" stopColor="#6d4aff"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="9" fill="url(#protonGrad)"/>
      {/* Proton "P" letterform */}
      <path fill="white" d="M14 36V12h11.5C31.8 12 36 15.6 36 21c0 5.4-4.2 9-10.5 9H20v6zm6-12h5c2.8 0 4.5-1.5 4.5-3.8 0-2.3-1.7-3.7-4.5-3.7H20z"/>
    </svg>
  )
}

function FranceLogo() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#ed2939"/>
      <rect width="32" height="48" rx="0" fill="white"/>
      <rect width="16" height="48" rx="0" fill="#002395"/>
      <rect width="48" height="48" rx="10" fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth="1"/>
    </svg>
  )
}

function CustomLogo() {
  return (
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#3f3f46"/>
      <g fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="24" cy="24" r="5"/>
        <path d="M24 8v4M24 36v4M8 24h4M36 24h4M12.7 12.7l2.8 2.8M32.5 32.5l2.8 2.8M35.3 12.7l-2.8 2.8M15.5 32.5l-2.8 2.8"/>
      </g>
    </svg>
  )
}

// ── Provider config ──────────────────────────────────────────────────────────

type ProviderKey = 'gmail' | 'outlook' | 'yahoo' | 'icloud' | 'proton' | 'ovh' | 'custom'

interface ProviderConfig {
  name: string
  subtitle: string
  domains: string[]
  imapHost: string; imapPort: number; imapSecure: boolean
  smtpHost: string; smtpPort: number; smtpSecure: boolean
  hint?: string; hintLink?: string; hintLinkLabel?: string
  requiresAppPassword?: boolean; needsManualServers?: boolean
  Logo: React.ComponentType
  hoverClass: string
}

const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  gmail: {
    name: 'Gmail',
    subtitle: 'Google Workspace',
    domains: ['gmail.com', 'googlemail.com'],
    imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false,
    requiresAppPassword: true,
    hint: 'Gmail requiert un mot de passe d\'application, pas votre mot de passe habituel.',
    hintLink: 'https://myaccount.google.com/apppasswords',
    hintLinkLabel: 'Créer un mot de passe d\'application →',
    Logo: GmailLogo,
    hoverClass: 'hover:border-red-400/50 hover:shadow-red-500/10',
  },
  outlook: {
    name: 'Outlook / Hotmail',
    subtitle: 'Live · Hotmail · MSN',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'live.fr', 'hotmail.fr', 'outlook.fr', 'msn.com'],
    imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false,
    Logo: OutlookLogo,
    hoverClass: 'hover:border-blue-400/50 hover:shadow-blue-500/10',
  },
  yahoo: {
    name: 'Yahoo Mail',
    subtitle: 'Yahoo · Ymail',
    domains: ['yahoo.com', 'yahoo.fr', 'yahoo.co.uk', 'yahoo.ca', 'ymail.com'],
    imapHost: 'imap.mail.yahoo.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com', smtpPort: 587, smtpSecure: false,
    requiresAppPassword: true,
    hint: 'Yahoo requiert un mot de passe d\'application.',
    hintLink: 'https://login.yahoo.com/account/security',
    hintLinkLabel: 'Gérer les mots de passe →',
    Logo: YahooLogo,
    hoverClass: 'hover:border-purple-400/50 hover:shadow-purple-500/10',
  },
  icloud: {
    name: 'iCloud Mail',
    subtitle: 'Apple · Me.com · Mac.com',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imapHost: 'imap.mail.me.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecure: false,
    requiresAppPassword: true,
    hint: 'iCloud requiert un mot de passe spécifique à l\'application.',
    hintLink: 'https://appleid.apple.com',
    hintLinkLabel: 'Gérer sur Apple ID →',
    Logo: ICloudLogo,
    hoverClass: 'hover:border-sky-400/50 hover:shadow-sky-500/10',
  },
  proton: {
    name: 'Proton Mail',
    subtitle: 'ProtonMail · PM.me',
    domains: ['proton.me', 'protonmail.com', 'pm.me', 'protonmail.ch'],
    imapHost: '127.0.0.1', imapPort: 1143, imapSecure: false,
    smtpHost: '127.0.0.1', smtpPort: 1025, smtpSecure: false,
    hint: 'Proton Mail requiert le Proton Bridge installé sur ce serveur.',
    Logo: ProtonLogo,
    hoverClass: 'hover:border-violet-400/50 hover:shadow-violet-500/10',
  },
  ovh: {
    name: 'OVH · Orange · Free',
    subtitle: 'SFR · La Poste · Infomaniak',
    domains: ['laposte.net', 'orange.fr', 'sfr.fr', 'free.fr', 'wanadoo.fr', 'infomaniak.com'],
    imapHost: '', imapPort: 993, imapSecure: true,
    smtpHost: '', smtpPort: 587, smtpSecure: false,
    needsManualServers: true,
    hint: 'Renseignez les serveurs fournis par votre opérateur ou hébergeur.',
    Logo: FranceLogo,
    hoverClass: 'hover:border-red-300/50 hover:shadow-red-400/10',
  },
  custom: {
    name: 'Autre serveur',
    subtitle: 'Configuration manuelle IMAP/SMTP',
    domains: [],
    imapHost: '', imapPort: 993, imapSecure: true,
    smtpHost: '', smtpPort: 587, smtpSecure: false,
    needsManualServers: true,
    Logo: CustomLogo,
    hoverClass: 'hover:border-zinc-400/50 hover:shadow-zinc-400/10',
  },
}

function detectProvider(email: string): ProviderKey | null {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return null
  for (const [key, config] of Object.entries(PROVIDERS) as [ProviderKey, ProviderConfig][]) {
    if (config.domains.includes(domain)) return key
  }
  return null
}

export interface AccountFormData {
  name: string; email: string
  imapHost: string; imapPort: number; imapSecure: boolean
  smtpHost: string; smtpPort: number; smtpSecure: boolean
  username: string; password: string; isDefault: boolean; color: string
}

interface TestResult {
  imap: { ok: boolean; error: string }
  smtp: { ok: boolean; error: string }
}

const COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316']

interface Props {
  onSave: (data: AccountFormData) => Promise<void>
  onCancel: () => void
  saving: boolean
}

export function AccountWizard({ onSave, onCancel, saving }: Props) {
  const [step, setStep] = useState<'provider' | 'credentials' | 'advanced'>('provider')
  const [provider, setProvider] = useState<ProviderKey | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountName, setAccountName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [imapSecure, setImapSecure] = useState(true)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpSecure, setSmtpSecure] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [error, setError] = useState('')

  const selectedProvider = provider ? PROVIDERS[provider] : null

  const applyProvider = (key: ProviderKey) => {
    const p = PROVIDERS[key]
    setProvider(key)
    setImapHost(p.imapHost); setImapPort(String(p.imapPort)); setImapSecure(p.imapSecure)
    setSmtpHost(p.smtpHost); setSmtpPort(String(p.smtpPort)); setSmtpSecure(p.smtpSecure)
    setTestResult(null); setError('')
  }

  const selectProvider = (key: ProviderKey) => {
    applyProvider(key)
    setStep(PROVIDERS[key].needsManualServers ? 'advanced' : 'credentials')
  }

  const handleEmailBlur = () => {
    const detected = detectProvider(email)
    if (detected && detected !== provider) applyProvider(detected)
    if (!accountName && email.includes('@')) {
      const domain = email.split('@')[1]?.split('.')[0] ?? ''
      setAccountName(domain.charAt(0).toUpperCase() + domain.slice(1))
    }
  }

  const handleTest = async () => {
    if (!password || !imapHost || !smtpHost) { setError('Remplissez tous les champs pour tester'); return }
    setTesting(true); setTestResult(null); setError('')
    try {
      const res = await fetch('/api/accounts/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imapHost, imapPort: parseInt(imapPort), imapSecure, smtpHost, smtpPort: parseInt(smtpPort), smtpSecure, username: email, password }),
      })
      setTestResult(await res.json())
    } catch { setError('Échec du test') } finally { setTesting(false) }
  }

  const handleSave = async () => {
    if (!email || !password) { setError('Email et mot de passe requis'); return }
    if (!imapHost || !smtpHost) { setError('Serveurs IMAP et SMTP requis'); return }
    setError('')
    await onSave({ name: accountName || email.split('@')[0], email, imapHost, imapPort: parseInt(imapPort), imapSecure, smtpHost, smtpPort: parseInt(smtpPort), smtpSecure, username: email, password, isDefault: false, color })
  }

  const TestResultBlock = () => testResult ? (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
      {(['imap', 'smtp'] as const).map(proto => (
        <div key={proto} className={cn('flex items-center gap-3 text-sm', testResult[proto].ok ? 'text-emerald-500' : 'text-destructive')}>
          <span className={cn('w-5 h-5 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0', testResult[proto].ok ? 'bg-emerald-500' : 'bg-destructive')}>
            {testResult[proto].ok ? '✓' : '✗'}
          </span>
          <span className="font-medium">{proto.toUpperCase()}</span>
          {!testResult[proto].ok && <span className="text-xs opacity-70 truncate">{testResult[proto].error}</span>}
        </div>
      ))}
    </div>
  ) : null

  const ColorPicker = () => (
    <div className="flex gap-2.5">
      {COLORS.map(c => (
        <button key={c} onClick={() => setColor(c)} type="button"
          className="w-7 h-7 rounded-full transition-all hover:scale-110 relative"
          style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }}
        >
          {color === c && <Check className="w-3.5 h-3.5 text-white absolute inset-0 m-auto" />}
        </button>
      ))}
    </div>
  )

  // ── STEP 1 : Grille fournisseurs ──────────────────────────────────────────
  if (step === 'provider') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Choisissez votre fournisseur</h2>
          <p className="text-muted-foreground mt-1">Les serveurs IMAP/SMTP seront configurés automatiquement.</p>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          {(Object.entries(PROVIDERS) as [ProviderKey, ProviderConfig][]).map(([key, p]) => (
            <button
              key={key}
              onClick={() => selectProvider(key)}
              className={cn(
                'group flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border bg-card text-center',
                'transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5',
                p.hoverClass
              )}
            >
              <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-sm flex items-center justify-center bg-white shrink-0">
                <div className="w-10 h-10"><p.Logo /></div>
              </div>
              <div className="space-y-0.5 min-w-0 w-full">
                <div className="font-semibold text-sm text-foreground truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground truncate">{p.subtitle}</div>
                {!p.needsManualServers && p.imapHost && (
                  <div className="text-[10px] text-muted-foreground/40 font-mono pt-0.5 truncate">{p.imapHost}</div>
                )}
              </div>
            </button>
          ))}
        </div>

        <Button variant="outline" onClick={onCancel} size="lg" className="w-full">Annuler</Button>
      </div>
    )
  }

  // Back header réutilisable
  const BackHeader = ({ title, sub }: { title: string; sub: string }) => (
    <div className="flex items-center gap-4 pb-6 border-b border-border">
      <button onClick={() => setStep('provider')}
        className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      {selectedProvider && (
        <div className="w-12 h-12 rounded-xl overflow-hidden bg-white shadow-sm flex items-center justify-center shrink-0">
          <div className="w-9 h-9"><selectedProvider.Logo /></div>
        </div>
      )}
      <div>
        <h2 className="font-bold text-xl">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </div>
    </div>
  )

  // ── STEP 2 : Identifiants ─────────────────────────────────────────────────
  if (step === 'credentials' && selectedProvider) {
    return (
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <BackHeader
          title={selectedProvider.name}
          sub={`${selectedProvider.imapHost} · port ${selectedProvider.imapPort} · SSL/TLS`}
        />

        {selectedProvider.hint && (
          <div className="flex gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Info className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
            <div className="text-sm">
              <p className="font-semibold text-amber-700 dark:text-amber-300">
                {selectedProvider.requiresAppPassword ? 'Mot de passe d\'application requis' : 'Information'}
              </p>
              <p className="text-amber-700/80 dark:text-amber-300/80 mt-0.5">{selectedProvider.hint}</p>
              {selectedProvider.hintLink && (
                <a href={selectedProvider.hintLink} target="_blank" rel="noopener noreferrer"
                  className="mt-2 inline-block font-semibold text-amber-700 dark:text-amber-300 underline underline-offset-2">
                  {selectedProvider.hintLinkLabel}
                </a>
              )}
            </div>
          </div>
        )}

        {error && <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20">{error}</div>}

        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label>Nom du compte</Label>
            <Input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder={selectedProvider.name} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label>Adresse email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={handleEmailBlur} placeholder="vous@exemple.com" autoFocus className="h-11" />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>{selectedProvider.requiresAppPassword ? 'Mot de passe d\'application' : 'Mot de passe'}</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} className="h-11" />
          </div>
          <div className="col-span-2 space-y-2">
            <Label>Couleur du compte</Label>
            <ColorPicker />
          </div>
        </div>

        <TestResultBlock />

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving || !email || !password} size="lg" className="flex-1">
            {saving ? 'Enregistrement…' : 'Ajouter le compte'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || !email || !password} size="lg" className="gap-2">
            <Wifi className="w-4 h-4" />{testing ? 'Test…' : 'Tester la connexion'}
          </Button>
          <Button variant="ghost" onClick={onCancel} size="lg">Annuler</Button>
        </div>
      </div>
    )
  }

  // ── STEP 3 : Configuration avancée ───────────────────────────────────────
  if (step === 'advanced') {
    return (
      <div className="max-w-2xl mx-auto w-full space-y-6">
        <BackHeader
          title={selectedProvider?.name ?? 'Configuration manuelle'}
          sub="Renseignez vos paramètres IMAP / SMTP"
        />

        {selectedProvider?.hint && (
          <div className="flex gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Info className="w-5 h-5 shrink-0 mt-0.5 text-amber-500" />
            <p className="text-sm text-amber-700 dark:text-amber-300">{selectedProvider.hint}</p>
          </div>
        )}

        {error && <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20">{error}</div>}

        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label>Nom du compte</Label>
            <Input value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Mon compte" className="h-11" />
          </div>
          <div className="space-y-2">
            <Label>Adresse email</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={handleEmailBlur} autoFocus className="h-11" />
          </div>

          <div className="col-span-2 grid grid-cols-4 gap-4">
            <div className="col-span-3 space-y-2">
              <Label>Serveur IMAP</Label>
              <Input value={imapHost} onChange={e => setImapHost(e.target.value)} placeholder="imap.exemple.com" className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>Port</Label>
              <Input type="number" value={imapPort} onChange={e => setImapPort(e.target.value)} className="h-11" />
            </div>
          </div>

          <div className="col-span-2 grid grid-cols-4 gap-4">
            <div className="col-span-3 space-y-2">
              <Label>Serveur SMTP</Label>
              <Input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.exemple.com" className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>Port</Label>
              <Input type="number" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} className="h-11" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Mot de passe</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label>Couleur du compte</Label>
            <div className="pt-1.5"><ColorPicker /></div>
          </div>
        </div>

        <TestResultBlock />

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} size="lg" className="flex-1">
            {saving ? 'Enregistrement…' : 'Ajouter le compte'}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing} size="lg" className="gap-2">
            <Wifi className="w-4 h-4" />{testing ? 'Test…' : 'Tester la connexion'}
          </Button>
          <Button variant="ghost" onClick={onCancel} size="lg">Annuler</Button>
        </div>
      </div>
    )
  }

  return null
}
