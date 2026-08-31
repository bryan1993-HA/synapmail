'use client'

import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { Bot, Wand2, Loader2, Clock, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface AISettingsData {
  configured: boolean
  featureImprove: boolean
}

interface Props {
  getContent: () => string
  onResult: (text: string) => void
  onError: (msg: string) => void
}

type ToneOption = { value: string; label: string; emoji: string }

const TONES: ToneOption[] = [
  { value: 'formal',    label: 'Formel',       emoji: '👔' },
  { value: 'casual',    label: 'Décontracté',  emoji: '😊' },
  { value: 'assertive', label: 'Assertif',     emoji: '💪' },
  { value: 'concise',   label: 'Concis',       emoji: '✂️' },
  { value: 'empathetic',label: 'Empathique',   emoji: '🤝' },
]

function ComingSoonBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[9px] font-semibold border border-amber-500/30">
      <Clock className="w-2 h-2" />
      Bientôt
    </span>
  )
}

export function AICompose({ getContent, onResult, onError }: Props) {
  const { data } = useSWR<{ data: AISettingsData }>('/api/ai/settings', fetcher)
  const settings = data?.data

  const [loading, setLoading] = useState<'improve' | string | null>(null)
  const [showToneMenu, setShowToneMenu] = useState(false)
  const toneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showToneMenu) return
    const handler = (e: MouseEvent) => {
      if (toneRef.current && !toneRef.current.contains(e.target as Node)) {
        setShowToneMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showToneMenu])

  if (!settings?.configured || !settings.featureImprove) return null

  const callAction = async (action: string, extra?: Record<string, string>) => {
    const content = getContent()
    if (!content.trim()) return

    setLoading(action)
    setShowToneMenu(false)

    try {
      const res = await fetch('/api/ai/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, content, ...extra }),
      })
      const json = await res.json() as { data?: { result: string }; error?: string }
      if (res.ok && json.data?.result) {
        onResult(json.data.result)
      } else {
        onError(json.error || 'Erreur IA')
      }
    } catch {
      onError('Impossible de joindre le service IA')
    } finally {
      setLoading(null)
    }
  }

  const isLoading = (key: string) => loading === key

  return (
    <div className="flex items-center gap-1">
      {/* Separator */}
      <div className="w-px h-4 bg-border mx-0.5 shrink-0" />

      {/* Améliorer */}
      <button
        type="button"
        onClick={() => callAction('improve')}
        disabled={!!loading}
        title="Améliorer l'email avec l'IA"
        className={cn(
          'flex items-center gap-1 h-7 px-2 rounded transition-colors text-xs',
          'text-violet-600 dark:text-violet-400 hover:bg-violet-500/10',
          loading === 'improve' && 'opacity-50 cursor-not-allowed'
        )}
      >
        {isLoading('improve')
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Wand2 className="w-3.5 h-3.5" />
        }
        <span className="font-medium">Améliorer</span>
      </button>

      {/* Tone picker */}
      <div className="relative" ref={toneRef}>
        <button
          type="button"
          onClick={() => setShowToneMenu(v => !v)}
          disabled={!!loading}
          title="Changer le ton de l'email"
          className={cn(
            'flex items-center gap-1 h-7 px-2 rounded transition-colors text-xs',
            'text-violet-600 dark:text-violet-400 hover:bg-violet-500/10',
            !!loading && 'opacity-50 cursor-not-allowed'
          )}
        >
          {loading && loading !== 'improve'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Bot className="w-3.5 h-3.5" />
          }
          <span className="font-medium">Ton</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>

        {showToneMenu && (
          <div className="absolute bottom-full mb-1 left-0 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[155px]">
            {TONES.map(tone => (
              <button
                key={tone.value}
                type="button"
                onClick={() => callAction('tone', { tone: tone.value })}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors flex items-center gap-2"
              >
                <span>{tone.emoji}</span>
                <span>{tone.label}</span>
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1 px-3 py-1.5 flex items-center gap-2 opacity-50 cursor-not-allowed">
              <span className="text-xs text-muted-foreground">Complétion inline</span>
              <ComingSoonBadge />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
