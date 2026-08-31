import createNextIntlPlugin from 'next-intl/plugin'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { version } = require('./package.json')

const withNextIntl = createNextIntlPlugin('./lib/i18n.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  output: 'standalone',
  images: {
    remotePatterns: [],
  },
  experimental: {
    instrumentationHook: true,
  },
}

export default withNextIntl(nextConfig)
