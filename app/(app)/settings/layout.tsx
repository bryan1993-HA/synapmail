import { auth } from '@/lib/auth'
import { SettingsSidebar } from '@/components/settings/SettingsSidebar'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string })?.role === 'admin'

  return (
    <div className="flex h-full overflow-hidden">
      <SettingsSidebar isAdmin={isAdmin} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
