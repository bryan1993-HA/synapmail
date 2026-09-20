#!/usr/bin/env node
/**
 * Measures that the AI screens carry NO user-facing string of their own: every
 * word the visitor reads comes from `locales/`, in en / fr / zh together.
 *
 * Pure: it reads the two source files and the three locale files, runs nothing,
 * touches no network and no database.
 *
 * Why this bench exists (found in production): the reading pane
 * button said "TL;DR" — English jargon, written in the source — and the AI
 * settings screen showed FRENCH to a visitor reading the site in zh or en.
 *
 * Negative control — proves the bench can see the defect it exists for:
 *   node scripts/check-ai-strings.mjs --break=<case>
 *
 *   node scripts/check-ai-strings.mjs
 */
import { readFileSync } from 'node:fs'

const FILES = [
  'components/ai/AIToolbar.tsx',
  'app/(app)/settings/ai/AISettingsClient.tsx',
]
const LOCALES = ['en', 'fr', 'zh']

/** Labels the visitor reads. Brand names are NOT here: they stay as they are. */
const REQUIRED_KEYS = [
  'mail.ai.actions.summarize', 'mail.ai.actions.reply',
  'mail.ai.actions.improve', 'mail.ai.actions.translate',
  'mail.ai.translateToFr', 'mail.ai.translateToEn',
  'mail.ai.tasks', 'mail.ai.priority', 'mail.ai.soonBadge', 'mail.ai.soonTitle',
  'mail.ai.resultSummary', 'mail.ai.resultTranslation', 'mail.ai.resultReply',
  'settings.ai.detect', 'settings.ai.detecting', 'settings.ai.detectError',
  'settings.ai.model', 'settings.ai.saveAndTest', 'settings.ai.saving',
  'settings.ai.testing', 'settings.ai.saved', 'settings.ai.failed',
  'settings.ai.advanced', 'settings.ai.systemPrompt',
  'settings.ai.systemPromptPlaceholder', 'settings.ai.features',
  'settings.ai.soonTitle', 'settings.ai.soonBadge',
  'settings.ai.keySaved', 'settings.ai.getKey',
  'settings.ai.keyLabel.anthropic', 'settings.ai.keyLabel.openai',
  'settings.ai.keyLabel.optional',
  'settings.ai.urlLabel.ollama', 'settings.ai.urlLabel.server',
  'settings.ai.modelHint.custom',
  'settings.ai.soon.inlineCompletion', 'settings.ai.soon.priorityScore',
  'settings.ai.soon.taskExtraction', 'settings.ai.soon.mailboxChat',
  'settings.ai.soon.smartRules', 'settings.ai.soon.personas',
  'settings.ai.pageDescription', 'settings.ai.configured', 'settings.nav.ai',
]

/** The exact strings found written in the source on 2026-09-19. */
const BANNED = [
  'TL;DR', 'Résumé TL;DR', 'Bientôt', 'Bientôt disponible', 'Prochainement',
  'Détecter automatiquement', 'Détection…', 'Enregistrer et tester',
  'Enregistrement…', 'Paramètres avancés', 'Prompt système', 'Fonctionnalités',
  'clé déjà enregistrée', 'Obtenir une clé', 'Clé API Anthropic',
  'Clé API OpenAI', 'Clé API (si requise)', 'URL Ollama', 'URL du serveur',
  'Complétion inline', 'Score de priorité automatique', 'Extraction des tâches',
  'Chat avec la boîte mail', 'Règles IA intelligentes', 'Personas par compte',
  'Répondre avec l', 'Améliorer / Ton', 'En français', 'In English',
  'Traduire', 'Traduction', 'Enregistré', 'Modèle',
  // Seen still in French on the zh screenshot taken 2026-09-19.
  'IA Copilot', 'Résumés, réponses suggérées', 'Configuré',
]

const BREAKAGES = {
  'label-in-source': 'the summarize button is written in the source again instead of read from locales',
  'locale-missing': 'a key exists in en but not in zh, so zh readers fall back to English',
  'title-in-source': 'the screen title and its badge are written in French in the source again',
}
const BREAK = process.argv.find(a => a.startsWith('--break='))?.slice('--break='.length) ?? null
if (BREAK && !BREAKAGES[BREAK]) {
  console.log(`HARNESS: --break=${BREAK} is not one of ${Object.keys(BREAKAGES).join(', ')}`)
  process.exit(1)
}

let failures = 0
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
}

const sources = Object.fromEntries(FILES.map(f => {
  let text = readFileSync(f, 'utf8')
  if (BREAK === 'label-in-source' && f.endsWith('AIToolbar.tsx')) {
    text = text.replace("{t('actions.summarize')}", 'TL;DR')
  }
  if (BREAK === 'title-in-source' && f.endsWith('AISettingsClient.tsx')) {
    text = text
      .replace("{tNav('ai')}", '"IA Copilot"')
      .replace("{t('configured')}", 'Configuré')
  }
  return [f, text]
}))

const locales = Object.fromEntries(LOCALES.map(l => {
  const json = JSON.parse(readFileSync(`locales/${l}.json`, 'utf8'))
  if (BREAK === 'locale-missing' && l === 'zh') delete json.mail.ai.actions.summarize
  return [l, json]
}))

const lookup = (json, path) =>
  path.split('.').reduce((node, seg) => (node == null ? undefined : node[seg]), json)

// 1. no user-facing string of its own, in either file
for (const [file, text] of Object.entries(sources)) {
  // Strip comments: they explain the code, the visitor never reads them.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const banned of BANNED) {
    check(!code.includes(banned), `${file}: no hardcoded ${JSON.stringify(banned)}`)
  }
}

// 2. every label the screens ask for exists in all three locales, non-empty
for (const key of REQUIRED_KEYS) {
  for (const loc of LOCALES) {
    const value = lookup(locales[loc], key)
    check(typeof value === 'string' && value.trim() !== '', `${loc}: ${key}`)
  }
}

// 3. the four feature labels have ONE source, shared by both screens
const shared = ['summarize', 'reply', 'improve', 'translate']
for (const name of shared) {
  const inSettings = sources['app/(app)/settings/ai/AISettingsClient.tsx']
    .includes(`tAction('${name}')`)
  check(inSettings, `settings reuses mail.ai.actions.${name} instead of its own copy`)
}

// 3b. the title reuses the navigation entry instead of a copy of its own
check(
  sources['app/(app)/settings/ai/AISettingsClient.tsx'].includes("tNav('ai')"),
  'settings title reuses settings.nav.ai instead of its own copy',
)

// 4. zh really is zh: the four action labels must not be the English ones
for (const name of shared) {
  const en = lookup(locales.en, `mail.ai.actions.${name}`)
  const zh = lookup(locales.zh, `mail.ai.actions.${name}`)
  check(zh !== en, `zh mail.ai.actions.${name} is translated, not the English text`)
}

// 5. house rules: no em dash, no emoji in what the visitor reads
for (const loc of LOCALES) {
  for (const key of REQUIRED_KEYS) {
    const v = lookup(locales[loc], key) ?? ''
    check(!v.includes('\u2014'), `${loc} ${key}: no em dash`)
    check(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(v), `${loc} ${key}: no emoji`)
  }
}

if (BREAK) {
  console.log(`\nnegative control --break=${BREAK} (${BREAKAGES[BREAK]}): ${failures} failure(s)`)
  if (failures === 0) {
    console.log('FAIL: the bench saw nothing while the defect was in place')
    process.exit(1)
  }
  console.log('ok   the bench sees the defect')
  process.exit(0)
}
console.log(`\n${failures === 0 ? 'check-ai-strings: OK' : `check-ai-strings: ${failures} failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
