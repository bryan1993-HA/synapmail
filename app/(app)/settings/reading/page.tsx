'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import { BookOpen } from 'lucide-react'
import {
  SettingsPage, SettingsHeader, SettingsSection, SettingsRow, SettingsDivider,
  Toggle, Chips, SaveBar,
} from '@/components/settings/primitives'

interface UserSettings {
  messages_per_page: number
  thread_view: boolean
  reading_pane: boolean
  start_view: string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())
const PER_PAGE_OPTIONS = [10, 20, 30, 50, 100]

export default function ReadingPage() {
  const t = useTranslations('settings.reading')
  const tc = useTranslations('settings.common')
  const { data, mutate } = useSWR<{ data: UserSettings }>('/api/settings', fetcher)
  const settings = data?.data

  const [messagesPerPage, setMessagesPerPage] = useState(30)
  const [threadView, setThreadView] = useState(true)
  const [readingPane, setReadingPane] = useState(true)
  const [startOnDashboard, setStartOnDashboard] = useState(false)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (settings) {
      setMessagesPerPage(settings.messages_per_page)
      setThreadView(settings.thread_view)
      setReadingPane(settings.reading_pane)
      setStartOnDashboard(settings.start_view === 'dashboard')
    }
  }, [settings])

  const dirty = !!settings && (
    messagesPerPage !== settings.messages_per_page
    || threadView !== settings.thread_view
    || readingPane !== settings.reading_pane
    || startOnDashboard !== (settings.start_view === 'dashboard')
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages_per_page: messagesPerPage,
          thread_view: threadView,
          reading_pane: readingPane,
          start_view: startOnDashboard ? 'dashboard' : 'inbox',
        }),
      })
      await mutate()
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage width="lg">
      <SettingsHeader icon={<BookOpen className="h-4 w-4" />} title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <SettingsSection title={t('perPage')} description={t('perPageDesc')}>
          <Chips
            value={messagesPerPage}
            onChange={setMessagesPerPage}
            options={PER_PAGE_OPTIONS.map(n => ({ value: n, label: n }))}
          />
        </SettingsSection>

        <SettingsSection title={t('displayOptions')}>
          <SettingsRow title={t('threadView')} description={t('threadViewDesc')}>
            <Toggle checked={threadView} onChange={setThreadView} label={t('threadView')} />
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow title={t('readingPane')} description={t('readingPaneDesc')}>
            <Toggle checked={readingPane} onChange={setReadingPane} label={t('readingPane')} />
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow title={t('startDashboard')} description={t('startDashboardDesc')}>
            <Toggle checked={startOnDashboard} onChange={setStartOnDashboard} label={t('startDashboard')} />
          </SettingsRow>
        </SettingsSection>

        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={success}
          onSave={handleSave}
          labels={{ save: tc('save'), saving: tc('saving'), saved: tc('saved'), unsaved: tc('unsaved') }}
        />
      </div>
    </SettingsPage>
  )
}
