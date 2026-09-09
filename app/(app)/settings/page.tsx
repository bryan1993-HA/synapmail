import ProfilePage from './profile/page'

// Bare /settings shows the profile pane (full page on hard load; the intercepted
// modal handles the soft-navigation case). No server redirect — a redirect here
// would promote the URL to /settings/profile and double-render under the modal.
export default function SettingsPage() {
  return <ProfilePage />
}
