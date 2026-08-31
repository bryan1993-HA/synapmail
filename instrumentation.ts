export async function register() {
  // Only run in the Node.js server process (not in the Edge runtime or build phase)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDb } = await import('./lib/db')
    await initDb()

    const { startScheduler } = await import('./lib/scheduler')
    startScheduler()
  }
}
