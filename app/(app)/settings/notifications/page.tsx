'use client'

import { useState, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function NotificationsPage() {
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>('default')

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermissionState(Notification.permission)
    } else {
      setPermissionState('unsupported')
    }
  }, [])

  const requestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const result = await Notification.requestPermission()
    setPermissionState(result)
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-1">Notifications</h1>
      <p className="text-sm text-muted-foreground mb-8">Gérez les alertes pour les nouveaux messages</p>

      <div className="space-y-6">
        {/* Desktop notifications */}
        <div className="border border-border rounded-xl p-5 space-y-5">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Notifications bureau</h2>

          {/* Toggle — non fonctionnel, câblage à venir */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <Bell className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-muted-foreground">Activer / Désactiver les notifications</p>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Bientôt disponible
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Le contrôle on/off sera pris en compte dans une prochaine mise à jour
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled
              className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full border-2 border-transparent bg-muted opacity-40"
            >
              <span className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 translate-x-0" />
            </button>
          </div>

          {/* Browser permission status */}
          {permissionState !== 'unsupported' && (
            <div className={cn(
              'rounded-lg px-4 py-3 text-sm',
              permissionState === 'granted'
                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                : permissionState === 'denied'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted text-muted-foreground'
            )}>
              {permissionState === 'granted' && 'Le navigateur autorise les notifications.'}
              {permissionState === 'denied' && 'Le navigateur a refusé les notifications. Modifiez les permissions dans les réglages de votre navigateur.'}
              {permissionState === 'default' && (
                <div className="flex items-center justify-between gap-3">
                  <span>Le navigateur n&apos;a pas encore autorisé les notifications.</span>
                  <button
                    onClick={requestPermission}
                    className="text-xs font-medium underline underline-offset-2 hover:no-underline shrink-0"
                  >
                    Autoriser
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Pour activer les notifications, autorisez-les dans votre navigateur via le bouton ci-dessus.
        </p>
      </div>
    </div>
  )
}
