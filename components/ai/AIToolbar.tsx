'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  Bot, FileText, MessageSquareDiff, Languages,
  Loader2, X, Clock, AlertCircle, Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Message } from '@/types/email'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface AISettingsData {
  configured: boolean
  featureSummarize: boolean
  featureReplyDraft: boolean
  featureTranslate: boolean
}

interface Props {
  message: Message
  onReplyWithAI: (draft: string) => void
}

type AIAction = 'summarize' | 'reply' | 'translate_fr' | 'translate_en'

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[9px] font-semibold border border-amber-500/30">
      <Clock className="w-2 h-2" />
      Bientôt
    </span>
  )
}

export function AIToolbar({ message, onReplyWithAI }: Props) {
  const { data } = useSWR<{ data: AISettingsData }>('/api/ai/settings', fetcher)
  const settings = data?.data

  const [loading, setLoading] = useState<AIAction | null>(null)
  const [result, setResult] = useState<{ action: AIAction; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showTranslatePicker, setShowTranslatePicker] = useState(false)

  if (!settings?.configured) return null

  const callAction = async (action: AIAction) => {
    setLoading(action)
    setResult(null)
    setError(null)
    setShowTranslatePicker(false)

    const content = message.bodyHtml || message.bodyPlain || message.subject || ''

    let apiAction: string
    let extra: Record<string, string> = {}
    if (action === 'translate_fr') { apiAction = 'translate'; extra = { targetLang: 'fr' } }
    else if (action === 'translate_en') { apiAction = 'translate'; extra = { targetLang: 'en' } }
    else { apiAction = action }

    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: apiAction, content, ...extra }),
      })
      const json = await res.json() as { data?: { result: string }; error?: string }
      if (res.ok && json.data?.result) {
        setResult({ action, text: json.data.result })
        if (action === 'reply') onReplyWithAI(json.data.result)
      } else {
        setError(json.error || 'Erreur IA')
      }
    } catch {
      setError('Impossible de joindre le service IA')
    } finally {
      setLoading(null)
    }
  }

  const isLoading = (a: AIAction) => loading === a

  return (
    <div className="border-b border-border shrink-0">
      {/* Toolbar strip */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-violet-500/5">
        <Bot className="w-3.5 h-3.5 text-violet-500 shrink-0 mr-1" />

        {/* TL;DR */}
        {settings.featureSummarize && (
          <button
            type="button"
            onClick={() => callAction('summarize')}
            disabled={!!loading}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              'text-muted-foreground hover:text-foreground hover:bg-violet-500/10',
              loading === 'summarize' && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isLoading('summarize')
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <FileText className="w-3 h-3" />
            }
            TL;DR
          </button>
        )}

        {/* Reply with AI */}
        {settings.featureReplyDraft && (
          <button
            type="button"
            onClick={() => callAction('reply')}
            disabled={!!loading}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
              'text-muted-foreground hover:text-foreground hover:bg-violet-500/10',
              loading === 'reply' && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isLoading('reply')
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <MessageSquareDiff className="w-3 h-3" />
            }
            Répondre avec l&apos;IA
          </button>
        )}

        {/* Translate */}
        {settings.featureTranslate && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTranslatePicker(v => !v)}
              disabled={!!loading}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                'text-muted-foreground hover:text-foreground hover:bg-violet-500/10',
                (isLoading('translate_fr') || isLoading('translate_en')) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {(isLoading('translate_fr') || isLoading('translate_en'))
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Languages className="w-3 h-3" />
              }
              Traduire
            </button>
            {showTranslatePicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[130px]">
                <button
                  type="button"
                  onClick={() => callAction('translate_fr')}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  🇫🇷 En français
                </button>
                <button
                  type="button"
                  onClick={() => callAction('translate_en')}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  🇬🇧 In English
                </button>
              </div>
            )}
          </div>
        )}

        {/* Coming soon: action items + priority */}
        <button
          type="button"
          disabled
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground/40 cursor-not-allowed"
          title="Bientôt disponible"
        >
          <Sparkles className="w-3 h-3" />
          Tâches
          <ComingSoonBadge />
        </button>

        <button
          type="button"
          disabled
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground/40 cursor-not-allowed"
          title="Bientôt disponible"
        >
          <Sparkles className="w-3 h-3" />
          Priorité
          <ComingSoonBadge />
        </button>
      </div>

      {/* Result panel */}
      {(result || error) && (
        <div className={cn(
          'px-4 py-3 border-t border-border text-sm relative',
          error ? 'bg-destructive/5' : 'bg-violet-500/5'
        )}>
          <button
            type="button"
            onClick={() => { setResult(null); setError(null) }}
            className="absolute top-2 right-3 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {error && (
            <div className="flex items-start gap-2 text-destructive text-xs pr-6">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {result && result.action !== 'reply' && (
            <div className="pr-6">
              <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-1.5 flex items-center gap-1.5">
                <Bot className="w-3 h-3" />
                {result.action === 'summarize' && 'Résumé'}
                {(result.action === 'translate_fr' || result.action === 'translate_en') && 'Traduction'}
              </p>
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{result.text}</p>
            </div>
          )}

          {result && result.action === 'reply' && (
            <div className="pr-6">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1.5 flex items-center gap-1.5">
                <MessageSquareDiff className="w-3 h-3" />
                Brouillon IA — ouvert dans la composition
              </p>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3">{result.text}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
