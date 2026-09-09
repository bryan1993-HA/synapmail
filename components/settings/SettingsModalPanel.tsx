'use client'

import { useSearchParams } from 'next/navigation'

import ProfilePage from '@/app/(app)/settings/profile/page'
import AppearancePage from '@/app/(app)/settings/appearance/page'
import ReadingPage from '@/app/(app)/settings/reading/page'
import NotificationsPage from '@/app/(app)/settings/notifications/page'
import CompositionPage from '@/app/(app)/settings/composition/page'
import SignaturesPage from '@/app/(app)/settings/signatures/page'
import TemplatesPage from '@/app/(app)/settings/templates/page'
import ContactsPage from '@/app/(app)/settings/contacts/page'
import { AccountsClient } from '@/app/(app)/settings/accounts/AccountsClient'
import { AISettingsClient } from '@/app/(app)/settings/ai/AISettingsClient'
import RulesClient from '@/components/settings/RulesClient'

/**
 * Maps a settings segment (from the intercepted route path) to the same leaf
 * component the full-page route renders. Server wrappers that only read
 * searchParams / guard auth (accounts, rules, ai) are bypassed — auth is already
 * enforced by the (app) layout, and searchParams are read here via the hook.
 */
export function SettingsModalPanel({ segment }: { segment: string }) {
  const sp = useSearchParams()

  switch (segment) {
    case 'appearance':
      return <AppearancePage />
    case 'reading':
      return <ReadingPage />
    case 'notifications':
      return <NotificationsPage />
    case 'composition':
      return <CompositionPage />
    case 'signatures':
      return <SignaturesPage />
    case 'templates':
      return <TemplatesPage />
    case 'contacts':
      return <ContactsPage />
    case 'accounts':
      return (
        <AccountsClient
          initialError={sp.get('error') ?? undefined}
          initialSuccess={sp.get('success') ?? undefined}
        />
      )
    case 'rules': {
      const prefill = (sp.get('prefill_from') || sp.get('prefill_subject'))
        ? {
            fromAddress: sp.get('prefill_from') ?? undefined,
            fromName: sp.get('prefill_from_name') ?? undefined,
            subject: sp.get('prefill_subject') ?? undefined,
            accountId: sp.get('prefill_account') ?? undefined,
          }
        : undefined
      return <RulesClient prefill={prefill} />
    }
    case 'ai':
      return <AISettingsClient />
    case 'profile':
    default:
      return <ProfilePage />
  }
}
