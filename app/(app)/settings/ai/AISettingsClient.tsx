'use client'

import { useState, useEffect } from 'react'
import useSWR, { mutate } from 'swr'
import {
  Bot, CheckCircle2, AlertCircle, Loader2, Zap,
  ChevronDown, ChevronUp, Clock, Wand2, MessageSquareDiff,
  Languages, FileText, Globe, Lock, ScanSearch,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Provider = 'claude' | 'openai' | 'ollama' | 'custom'

interface AISettingsData {
  provider: Provider
  hasApiKey: boolean
  baseUrl: string
  model: string
  systemPrompt: string
  featureSummarize: boolean
  featureReplyDraft: boolean
  featureImprove: boolean
  featureTranslate: boolean
  configured: boolean
}

const PROVIDERS: {
  id: Provider
  label: string
  emoji: string
  tagline: string
  keyLabel?: string
  keyPlaceholder?: string
  keyLink?: string
  urlLabel?: string
  defaultModel: string
  defaultUrl?: string
  modelHint: string
}[] = [
  {
    id: 'claude',
    label: 'Claude',
    emoji: '🤖',
    tagline: 'Anthropic — excellent pour la rédaction',
    keyLabel: 'Clé API Anthropic',
    keyPlaceholder: 'sk-ant-...',
    keyLink: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-4-6',
    modelHint: 'claude-sonnet-4-6 · claude-opus-4-6 · claude-haiku-4-5-20251001',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    emoji: '🧠',
    tagline: 'GPT-4o — le plus populaire',
    keyLabel: 'Clé API OpenAI',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o',
    modelHint: 'gpt-4o · gpt-4o-mini · gpt-4-turbo',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    emoji: '🦙',
    tagline: '100% local, aucune donnée envoyée',
    urlLabel: 'URL Ollama',
    defaultModel: 'llama3',
    defaultUrl: 'http://localhost:11434',
    modelHint: 'llama3 · mistral · gemma3 · phi3 · qwen2',
  },
  {
    id: 'custom',
    label: 'Compatible OpenAI',
    emoji: '⚙️',
    tagline: 'LM Studio, Groq, Mistral, Together…',
    keyLabel: 'Clé API (si requise)',
    keyPlaceholder: 'sk-...',
    urlLabel: 'URL du serveur',
    defaultModel: 'mistral',
    modelHint: 'Nom du modèle accepté par votre endpoint',
  },
]

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[9px] font-semibold border border-amber-500/30">
      <Clock className="w-2 h-2" /> Bientôt
    </span>
  )
}

const COMING_SOON = [
  { icon: Zap, label: 'Complétion inline' },
  { icon: Clock, label: 'Score de priorité automatique' },
  { icon: FileText, label: 'Extraction des tâches' },
  { icon: MessageSquareDiff, label: 'Chat avec la boîte mail' },
  { icon: Globe, label: 'Règles IA intelligentes' },
  { icon: Lock, label: 'Personas par compte' },
]

export function AISettingsClient() {
  const { data } = useSWR<{ data: AISettingsData }>('/api/ai/settings', fetcher)
  const settings = data?.data

  const [provider, setProvider] = useState<Provider>('ollama')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  const [model, setModel] = useState('llama3')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [featureSummarize, setFeatureSummarize] = useState(true)
  const [featureReplyDraft, setFeatureReplyDraft] = useState(true)
  const [featureImprove, setFeatureImprove] = useState(true)
  const [featureTranslate, setFeatureTranslate] = useState(true)

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectResult, setDetectResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [detectedModels, setDetectedModels] = useState<string[]>([])

  useEffect(() => {
    if (!settings) return
    setProvider(settings.provider)
    setBaseUrl(settings.baseUrl || 'http://localhost:11434')
    setModel(settings.model || 'llama3')
    setSystemPrompt(settings.systemPrompt || '')
    setFeatureSummarize(settings.featureSummarize)
    setFeatureReplyDraft(settings.featureReplyDraft)
    setFeatureImprove(settings.featureImprove)
    setFeatureTranslate(settings.featureTranslate)
  }, [settings])

  const selected = PROVIDERS.find(p => p.id === provider)!

  const handleProviderChange = (id: Provider) => {
    setProvider(id)
    const p = PROVIDERS.find(x => x.id === id)!
    setModel(p.defaultModel)
    if (p.defaultUrl) setBaseUrl(p.defaultUrl)
    setApiKey('')
    setTestResult(null)
  }

  const handleDetect = async () => {
    setDetecting(true)
    setDetectResult(null)
    setDetectedModels([])
    try {
      const res = await fetch('/api/ai/detect')
      const json = await res.json() as { data?: { found: boolean; url: string | null; models: string[] } }
      if (json.data?.found && json.data.url) {
        setBaseUrl(json.data.url)
        setDetectedModels(json.data.models)
        if (json.data.models.length > 0) setModel(json.data.models[0])
        setDetectResult({ ok: true, msg: `Ollama trouvé sur ${json.data.url}` })
      } else {
        setDetectResult({ ok: false, msg: 'Ollama non trouvé. Vérifiez qu\'il est bien démarré.' })
      }
    } catch {
      setDetectResult({ ok: false, msg: 'Erreur lors de la détection' })
    } finally {
      setDetecting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch('/api/ai/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider, apiKey: apiKey || undefined, baseUrl, model, systemPrompt,
          featureSummarize, featureReplyDraft, featureImprove, featureTranslate,
        }),
      })
      if (res.ok) {
        setSaveStatus('ok')
        setApiKey('')
        mutate('/api/ai/settings')
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const handleTest = async () => {
    // Save first, then test
    await handleSave()
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'summarize', content: 'Test de connexion Synapmail. Dis bonjour en une phrase.' }),
      })
      const json = await res.json() as { data?: { result: string }; error?: string }
      if (res.ok && json.data?.result) {
        setTestResult({ ok: true, msg: json.data.result.slice(0, 150) })
      } else {
        setTestResult({ ok: false, msg: json.error || 'Erreur inconnue' })
      }
    } catch (e: unknown) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Erreur réseau' })
    } finally {
      setTesting(false)
    }
  }

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        value ? 'bg-violet-600' : 'bg-muted-foreground/30'
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform',
        value ? 'translate-x-4' : 'translate-x-0'
      )} />
    </button>
  )

  return (
    <div className="max-w-xl space-y-6 p-6">

      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Bot className="w-5 h-5 text-violet-500" />
        <div>
          <h1 className="text-base font-semibold">IA Copilot</h1>
          <p className="text-xs text-muted-foreground">Choisissez votre modèle IA et sauvegardez.</p>
        </div>
        {settings?.configured && (
          <span className="ml-auto flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Configuré
          </span>
        )}
      </div>

      {/* Step 1 — Provider */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">1 — Fournisseur</p>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleProviderChange(p.id)}
              className={cn(
                'flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all',
                provider === p.id
                  ? 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30'
                  : 'border-border hover:bg-muted/50'
              )}
            >
              <span className="text-xl shrink-0">{p.emoji}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">{p.label}</p>
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">{p.tagline}</p>
              </div>
              {provider === p.id && <CheckCircle2 className="w-3.5 h-3.5 text-violet-500 ml-auto shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2 — Credentials */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">2 — Accès</p>
        <div className="space-y-3 rounded-xl border border-border p-4 bg-muted/20">

          {selected.keyLabel && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">{selected.keyLabel}</label>
                {selected.keyLink && (
                  <a
                    href={selected.keyLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-violet-500 hover:underline"
                  >
                    Obtenir une clé ↗
                  </a>
                )}
              </div>
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={settings?.hasApiKey && provider === settings.provider ? '••••••••• (clé déjà enregistrée)' : selected.keyPlaceholder}
                className="h-9 text-sm font-mono"
              />
            </div>
          )}

          {selected.urlLabel && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-muted-foreground">{selected.urlLabel}</label>
                {(provider === 'ollama' || provider === 'custom') && (
                  <button
                    type="button"
                    onClick={handleDetect}
                    disabled={detecting}
                    className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-400 transition-colors disabled:opacity-50"
                  >
                    {detecting
                      ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Détection…</>
                      : <><ScanSearch className="w-2.5 h-2.5" /> Détecter automatiquement</>
                    }
                  </button>
                )}
              </div>
              <Input
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder={selected.defaultUrl || 'https://...'}
                className="h-9 text-sm font-mono"
              />
              {detectResult && (
                <p className={cn(
                  'text-[11px] mt-1 flex items-center gap-1',
                  detectResult.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'
                )}>
                  {detectResult.ok
                    ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                    : <AlertCircle className="w-3 h-3 shrink-0" />
                  }
                  {detectResult.msg}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Modèle</label>
            {detectedModels.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {detectedModels.map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModel(m)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs border transition-colors font-mono',
                        model === m
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'border-border text-muted-foreground hover:border-violet-500 hover:text-foreground'
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <Input
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder={selected.defaultModel}
                className="h-9 text-sm font-mono"
              />
            )}
            {detectedModels.length === 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">{selected.modelHint}</p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={handleTest}
          disabled={saving || testing}
          className="h-9 px-5 bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
        >
          {testing || saving
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {saving ? 'Enregistrement…' : 'Test…'}</>
            : <><Zap className="w-3.5 h-3.5" /> Enregistrer et tester</>
          }
        </Button>

        {saveStatus === 'ok' && !testing && (
          <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4" /> Enregistré
          </span>
        )}
        {saveStatus === 'error' && !testing && (
          <span className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" /> Erreur
          </span>
        )}
      </div>

      {/* Test result */}
      {testResult && (
        <div className={cn(
          'flex items-start gap-2 text-sm rounded-xl px-4 py-3',
          testResult.ok
            ? 'bg-green-500/10 text-green-700 dark:text-green-400'
            : 'bg-destructive/10 text-destructive'
        )}>
          {testResult.ok
            ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span className="break-all">{testResult.ok ? `✅ Connexion OK — Réponse : "${testResult.msg}"` : testResult.msg}</span>
        </div>
      )}

      {/* Advanced (collapsible) */}
      <div className="border border-border rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <span>Paramètres avancés</span>
          {showAdvanced ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
            {/* System prompt */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Prompt système</label>
              <textarea
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                rows={3}
                placeholder="Ex : Tu es un assistant email professionnel. Réponds toujours en français, de manière concise."
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Feature toggles */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Fonctionnalités</p>
              <div className="space-y-2">
                {[
                  { label: 'Résumé TL;DR', icon: FileText, value: featureSummarize, set: setFeatureSummarize },
                  { label: 'Répondre avec l\'IA', icon: MessageSquareDiff, value: featureReplyDraft, set: setFeatureReplyDraft },
                  { label: 'Améliorer / Ton', icon: Wand2, value: featureImprove, set: setFeatureImprove },
                  { label: 'Traduire', icon: Languages, value: featureTranslate, set: setFeatureTranslate },
                ].map(({ label, icon: Icon, value, set }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      {label}
                    </div>
                    <Toggle value={value} onChange={set} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Coming soon */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Prochainement</p>
        <div className="grid grid-cols-2 gap-1.5">
          {COMING_SOON.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 opacity-60">
              <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{label}</span>
              <ComingSoonBadge />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
