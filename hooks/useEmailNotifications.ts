'use client'

import { useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { Message } from '@/types/email'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useEmailNotifications(folder: string, accountId?: string) {
  const lastUidRef = useRef<string | null>(null)
  const isFirstLoad = useRef(true)

  const { data: settingsData } = useSWR<{ data: { notifications: boolean } }>(
    '/api/settings',
    fetcher
  )

  const notificationsEnabled = settingsData?.data?.notifications !== false

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (notificationsEnabled && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [notificationsEnabled])

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

        if (!notificationsEnabled) return

        if (Notification.permission === 'granted') {
          try {
            const senderName = newest.from.name || newest.from.address
            const preview = newest.preview
              ? newest.preview.slice(0, 120)
              : newest.subject

            const notification = new Notification(`${senderName}`, {
              body: `${newest.subject}${preview && preview !== newest.subject ? `\n${preview}` : ''}`,
              icon: '/brand/png/synapmail-favicon@64.png',
              tag: `synapmail-${newest.uid}`, // prevent duplicates
              requireInteraction: false,
              silent: false,
            })

            notification.onclick = () => {
              window.focus()
              window.dispatchEvent(new CustomEvent('synapmail:open-message', {
                detail: {
                  uid: newest.uid,
                  accountId: newest.accountId || accountId,
                  folder,
                },
              }))
              notification.close()
            }
          } catch {
            // Notifications not supported
          }
        }
      }
    },
  })
}
