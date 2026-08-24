'use client'

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { Message } from '@/types/email'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useEmailNotifications(folder: string, accountId?: string) {
  const lastUidRef = useRef<string | null>(null)
  const isFirstLoad = useRef(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const accountParam = accountId ? `&account=${accountId}` : ''
  const swrKey = `/api/messages?folder=${encodeURIComponent(folder)}&page=1&perPage=5${accountParam}`

  useSWR<{ messages: Message[]; total: number }>(swrKey, fetcher, {
    refreshInterval: 60000,
    onSuccess(data) {
      if (!data?.messages?.length) return

      const newest = data.messages[0]
      const newestUid = newest?.uid ?? null

      if (isFirstLoad.current) {
        lastUidRef.current = newestUid
        isFirstLoad.current = false
        return
      }

      if (newestUid && newestUid !== lastUidRef.current) {
        lastUidRef.current = newestUid

        if (Notification.permission === 'granted') {
          try {
            new Notification('Nouveau message', {
              body: `${newest.from.name || newest.from.address}: ${newest.subject}`,
              icon: '/favicon.ico',
            })
          } catch {
            // Notifications not supported in this context
          }
        }
      }
    },
  })
}
