import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

export default async function SettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const t = await getTranslations('settings')

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('title')}</h1>
      <div className="space-y-2">
        <Link
          href="/settings/accounts"
          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          <div>
            <div className="font-medium">{t('accounts.title')}</div>
            <div className="text-sm text-muted-foreground">{t('accountsDesc')}</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
        <Link
          href="/settings/profile"
          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          <div>
            <div className="font-medium">{t('profile.title')}</div>
            <div className="text-sm text-muted-foreground">{t('profileDesc')}</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
        <Link
          href="/settings/signatures"
          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          <div>
            <div className="font-medium">{t('signatures.title')}</div>
            <div className="text-sm text-muted-foreground">{t('signaturesDesc')}</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      </div>
    </div>
  )
}
