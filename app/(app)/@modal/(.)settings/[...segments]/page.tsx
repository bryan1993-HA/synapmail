import { SettingsModal } from '@/components/settings/SettingsModal'

// Intercepts soft-navigation to /settings/<sub> and renders the settings area as
// a modal over the current page. Hard load falls through to app/(app)/settings/**.
export default function InterceptedSettings() {
  return <SettingsModal />
}
