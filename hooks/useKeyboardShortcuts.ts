'use client'

import { useEffect } from 'react'
import type { Message } from '@/types/email'

interface ShortcutHandlers {
  onCompose: () => void
  onReply: (msg: Message) => void
  onReplyAll: (msg: Message) => void
  onForward: (msg: Message) => void
  onDelete: (uid: string, accountId: string) => void
  onMarkUnread: (uid: string, accountId: string) => void
  onFocusSearch: () => void
  currentMessage: Message | null
  composeOpen: boolean
  onCloseCompose: () => void
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable ||
    el.closest('[data-radix-select-content]') !== null
  )
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const {
    onCompose, onReply, onReplyAll, onForward,
    onDelete, onMarkUnread, onFocusSearch,
    currentMessage, composeOpen, onCloseCompose,
  } = handlers

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      // Escape always works
      if (e.key === 'Escape') {
        if (composeOpen) { onCloseCompose(); return }
      }

      if (isTyping(e)) return

      // Ignore modifier combos (except Shift for #)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key) {
        case 'c':
          e.preventDefault()
          onCompose()
          break
        case 'r':
          if (currentMessage) { e.preventDefault(); onReply(currentMessage) }
          break
        case 'a':
          if (currentMessage) { e.preventDefault(); onReplyAll(currentMessage) }
          break
        case 'f':
          if (currentMessage) { e.preventDefault(); onForward(currentMessage) }
          break
        case '#':
        case 'Delete':
          if (currentMessage) {
            e.preventDefault()
            onDelete(currentMessage.uid, currentMessage.accountId)
          }
          break
        case 'u':
          if (currentMessage) {
            e.preventDefault()
            onMarkUnread(currentMessage.uid, currentMessage.accountId)
          }
          break
        case '/':
          e.preventDefault()
          onFocusSearch()
          break
      }
    }

    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [onCompose, onReply, onReplyAll, onForward, onDelete, onMarkUnread, onFocusSearch, currentMessage, composeOpen, onCloseCompose])
}
