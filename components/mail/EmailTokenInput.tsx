'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Contact } from '@/types/contact'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Deterministic avatar color from email hash
function emailToHsl(email: string): string {
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) % 360
  }
  return `hsl(${hash}, 58%, 42%)`
}

function ContactAvatar({ name, email }: { name: string; email: string }) {
  const initials = name
    ? name.trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : email[0].toUpperCase()
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center font-semibold text-white shrink-0 text-[11px]"
      style={{ backgroundColor: emailToHsl(email) }}
    >
      {initials}
    </div>
  )
}

function formatLastContact(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  if (days === 0) return "auj."
  if (days === 1) return "1j"
  if (days < 7) return `${days}j`
  if (days < 30) return `${Math.floor(days / 7)}sem`
  if (days < 365) return `${Math.floor(days / 30)}mois`
  return `${Math.floor(days / 365)}an`
}

interface EmailTokenInputProps {
  tokens: string[]
  onChange: (tokens: string[]) => void
  placeholder?: string
  autoFocus?: boolean
  accountId?: string
}

export function EmailTokenInput({ tokens, onChange, placeholder, autoFocus, accountId }: EmailTokenInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const q = inputValue.trim()
  const accountParam = accountId ? `&account=${encodeURIComponent(accountId)}` : ''
  const { data } = useSWR<{ data: Contact[] }>(
    focused ? `/api/contacts?q=${encodeURIComponent(q)}&limit=7${accountParam}` : null,
    fetcher,
    { dedupingInterval: 100 }
  )
  const suggestions = data?.data ?? []
  const showDropdown = focused && suggestions.length > 0

  const commit = useCallback((raw: string) => {
    const parts = raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    const fresh = parts.filter(p => !tokens.some(t => t.toLowerCase() === p.toLowerCase()))
    if (fresh.length) onChange([...tokens, ...fresh])
    setInputValue('')
    setActiveIndex(-1)
  }, [tokens, onChange])

  const removeToken = useCallback((i: number) => {
    onChange(tokens.filter((_, idx) => idx !== i))
  }, [tokens, onChange])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';') && !e.shiftKey) {
      e.preventDefault()
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        commit(suggestions[activeIndex].email)
      } else if (inputValue.trim()) {
        commit(inputValue)
      }
    } else if (e.key === 'Tab') {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault()
        commit(suggestions[activeIndex].email)
      } else if (inputValue.trim()) {
        e.preventDefault()
        commit(inputValue)
      }
    } else if (e.key === 'Backspace' && !inputValue && tokens.length) {
      removeToken(tokens.length - 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Escape') {
      setActiveIndex(-1)
      setFocused(false)
    }
  }

  // Flush input on blur (click outside)
  const handleBlur = useCallback(() => {
    // Delay: allow suggestion mousedown to fire first
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        if (inputValue.trim()) commit(inputValue)
        setFocused(false)
        setActiveIndex(-1)
      }
    }, 160)
  }, [inputValue, commit])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setFocused(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showDropdown])

  return (
    <div className="relative flex-1 min-w-0" ref={containerRef}>
      {/* Token pills + input */}
      <div
        className="flex flex-wrap gap-1 items-center min-h-[28px] cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {tokens.map((token, i) => {
          const valid = EMAIL_REGEX.test(token)
          const dup = tokens.findIndex(t => t.toLowerCase() === token.toLowerCase()) !== i
          return (
            <span
              key={`${token}-${i}`}
              title={token}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium max-w-[200px]',
                dup
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : valid
                    ? 'bg-primary/12 text-primary'
                    : 'bg-destructive/12 text-destructive'
              )}
            >
              <span className="truncate">{token}</span>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={e => { e.preventDefault(); removeToken(i) }}
                className="shrink-0 hover:opacity-70 transition-opacity ml-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )
        })}

        <input
          ref={inputRef}
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setActiveIndex(-1) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          placeholder={tokens.length === 0 ? placeholder : ''}
          autoFocus={autoFocus}
          className="flex-1 min-w-[100px] h-7 text-sm bg-transparent border-0 outline-none px-0 focus-visible:ring-0 shadow-none text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Suggestions dropdown */}
      {showDropdown && (
        <div className="absolute left-0 top-[calc(100%+6px)] w-[340px] max-h-72 overflow-y-auto bg-popover border border-border rounded-xl shadow-xl z-[300] py-1">
          {suggestions.map((contact, i) => {
            const alreadyIn = tokens.some(t => t.toLowerCase() === contact.email.toLowerCase())
            const isBidir = contact.sentCount > 0 && contact.receivedCount > 0
            return (
              <button
                key={contact.id}
                type="button"
                tabIndex={-1}
                onMouseDown={e => {
                  e.preventDefault()
                  if (!alreadyIn) commit(contact.email)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  activeIndex === i ? 'bg-accent' : 'hover:bg-accent/70',
                  alreadyIn && 'opacity-40 cursor-default'
                )}
              >
                <ContactAvatar name={contact.name} email={contact.email} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">
                      {contact.name || contact.email}
                    </span>
                    {contact.isStarred && (
                      <span className="text-yellow-500 shrink-0 text-xs leading-none">★</span>
                    )}
                    {isBidir && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded shrink-0 leading-none">↔</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                    <span className="truncate">{contact.email}</span>
                    <span className="shrink-0">·</span>
                    <span className="shrink-0 tabular-nums">{contact.frequency} msg</span>
                    <span className="shrink-0">·</span>
                    <span className="shrink-0">{formatLastContact(contact.lastContactAt)}</span>
                  </div>
                </div>

                {alreadyIn && (
                  <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">Ajouté</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
