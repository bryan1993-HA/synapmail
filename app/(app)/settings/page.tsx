import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function SettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="space-y-2">
        <Link
          href="/settings/accounts"
          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          <div>
            <div className="font-medium">Email accounts</div>
            <div className="text-sm text-muted-foreground">Manage your IMAP/SMTP accounts</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
        <Link
          href="/settings/profile"
          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          <div>
            <div className="font-medium">Profile</div>
            <div className="text-sm text-muted-foreground">Name, email, password</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
        <Link
          href="/settings/signatures"
          className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent transition-colors"
        >
          <div>
            <div className="font-medium">Signatures</div>
            <div className="text-sm text-muted-foreground">Manage email signatures</div>
          </div>
          <span className="text-muted-foreground">→</span>
        </Link>
      </div>
    </div>
  )
}
