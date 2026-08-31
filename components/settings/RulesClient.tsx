'use client'

import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import {
  Filter, Plus, Trash2, Pencil, Play, AlertCircle, X,
  Zap, CheckCircle2, ArrowRight, ToggleLeft, ToggleRight,
  Loader2, FlaskConical, Download, Upload, FileCode2,
  GripVertical, Clock, BarChart2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type {
  EmailRule, RuleCondition, RuleAction, RuleField,
  RuleOperator, RuleActionType, RuleTemplate,
} from '@/types/rule'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetcher = (url: string) => fetch(url).then(r => r.json())
const uid = () => Math.random().toString(36).slice(2)

function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 2)   return "à l'instant"
  if (min < 60)  return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24)    return `il y a ${h}h`
  const d = Math.floor(h / 24)
  if (d < 7)     return `il y a ${d}j`
  return new Date(dateStr).toLocaleDateString('fr')
}

// ---------------------------------------------------------------------------
// Config maps
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<RuleField, string> = {
  from:            'Expéditeur',
  to:              'Destinataire',
  cc:              'CC',
  subject:         'Objet',
  body:            'Corps du message',
  has_attachments: 'Pièces jointes',
  list_unsubscribe:'Liste de diffusion',
  size:            'Taille (Ko)',
  date_received:   'Date de réception',
  priority:        'Priorité (X-Priority)',
  header:          'En-tête personnalisé',
}

const FIELD_OPERATORS: Record<RuleField, RuleOperator[]> = {
  from:            ['contains','not_contains','equals','not_equals','starts_with','ends_with'],
  to:              ['contains','not_contains','equals','not_equals'],
  cc:              ['contains','not_contains','equals','not_equals'],
  subject:         ['contains','not_contains','equals','not_equals','starts_with','ends_with'],
  body:            ['contains','not_contains'],
  has_attachments: ['is_true','is_false'],
  list_unsubscribe:['is_true','is_false'],
  size:            ['greater_than','less_than'],
  date_received:   ['before','after'],
  priority:        ['equals','less_than','greater_than'],
  header:          ['contains','not_contains','equals'],
}

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains:     'contient',
  not_contains: 'ne contient pas',
  equals:       'est exactement',
  not_equals:   "n'est pas",
  starts_with:  'commence par',
  ends_with:    'se termine par',
  is_true:      'est présent(e)',
  is_false:     "n'est pas présent(e)",
  greater_than: 'supérieur à',
  less_than:    'inférieur à',
  before:       'avant le',
  after:        'après le',
}

const ACTION_LABELS: Record<RuleActionType, string> = {
  move:          'Déplacer vers',
  mark_read:     'Marquer comme lu',
  mark_unread:   'Marquer comme non lu',
  mark_starred:  'Ajouter une étoile',
  mark_unstarred:"Retirer l'étoile",
  delete:        'Supprimer',
  forward:       'Transférer à',
}

const ACTIONS_NEEDING_VALUE: RuleActionType[] = ['move', 'forward']
const BOOLEAN_FIELDS: RuleField[] = ['has_attachments', 'list_unsubscribe']

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES: RuleTemplate[] = [
  {
    id: 'newsletters',
    name: 'Newsletters',
    description: 'Emails marketing détectés automatiquement',
    icon: '📧',
    conditionLogic: 'any',
    conditions: [
      { field: 'list_unsubscribe', operator: 'is_true',  value: '' },
      { field: 'subject',          operator: 'contains', value: 'newsletter' },
      { field: 'subject',          operator: 'contains', value: 'unsubscribe' },
    ],
    actions: [{ type: 'mark_read' }, { type: 'move', value: 'Newsletters' }],
  },
  {
    id: 'receipts',
    name: 'Factures & Reçus',
    description: 'Commandes, factures, confirmations de paiement',
    icon: '🧾',
    conditionLogic: 'any',
    conditions: [
      { field: 'subject', operator: 'contains', value: 'facture' },
      { field: 'subject', operator: 'contains', value: 'reçu' },
      { field: 'subject', operator: 'contains', value: 'commande' },
      { field: 'subject', operator: 'contains', value: 'receipt' },
      { field: 'subject', operator: 'contains', value: 'invoice' },
    ],
    actions: [{ type: 'move', value: 'Factures' }],
  },
  {
    id: 'social',
    name: 'Réseaux sociaux',
    description: 'Notifications LinkedIn, Twitter, Facebook…',
    icon: '📱',
    conditionLogic: 'any',
    conditions: [
      { field: 'from', operator: 'contains', value: 'linkedin' },
      { field: 'from', operator: 'contains', value: 'twitter' },
      { field: 'from', operator: 'contains', value: 'facebook' },
      { field: 'from', operator: 'contains', value: 'instagram' },
    ],
    actions: [{ type: 'mark_read' }, { type: 'move', value: 'Réseaux sociaux' }],
  },
  {
    id: 'noreply',
    name: 'Notifications auto',
    description: 'Emails automatisés (noreply, donotreply…)',
    icon: '🤖',
    conditionLogic: 'any',
    conditions: [
      { field: 'from', operator: 'starts_with', value: 'noreply' },
      { field: 'from', operator: 'starts_with', value: 'no-reply' },
      { field: 'from', operator: 'starts_with', value: 'donotreply' },
      { field: 'from', operator: 'contains',    value: 'notification@' },
    ],
    actions: [{ type: 'mark_read' }],
  },
  {
    id: 'large',
    name: 'Gros fichiers',
    description: 'Emails avec pièces jointes > 5 Mo',
    icon: '📦',
    conditionLogic: 'all',
    conditions: [
      { field: 'has_attachments', operator: 'is_true',      value: '' },
      { field: 'size',            operator: 'greater_than',  value: '5120' },
    ],
    actions: [{ type: 'move', value: 'Gros fichiers' }],
  },
]

// ---------------------------------------------------------------------------
// Plain-language summary
// ---------------------------------------------------------------------------

function conditionText(c: RuleCondition): string {
  const f = FIELD_LABELS[c.field] ?? c.field
  const o = OPERATOR_LABELS[c.operator] ?? c.operator
  if (BOOLEAN_FIELDS.includes(c.field)) return `${f} ${o}`
  if (c.field === 'date_received') return `${f} ${o} ${c.value}`
  if (c.field === 'size') return `${f} ${o} ${c.value} Ko`
  return `${f} ${o} "${c.value}"`
}

function ruleSummary(rule: EmailRule): string {
  if (!rule.conditions.length) return '(aucune condition)'
  const lg   = rule.conditionLogic === 'all' ? 'ET' : 'OU'
  const cond = rule.conditions.slice(0, 2).map(conditionText).join(` ${lg} `)
  const more = rule.conditions.length > 2 ? ` +${rule.conditions.length - 2}` : ''
  const acts = rule.actions.map(a => ACTION_LABELS[a.type]).slice(0, 2).join(', ')
  return `Si ${cond}${more} → ${acts}`
}

// ---------------------------------------------------------------------------
// Condition row
// ---------------------------------------------------------------------------

function ConditionRow({
  cond, onChange, onRemove, canRemove,
}: {
  cond: RuleCondition
  onChange: (c: RuleCondition) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const operators = FIELD_OPERATORS[cond.field] ?? []
  const isBoolean = BOOLEAN_FIELDS.includes(cond.field)
  const isDate    = cond.field === 'date_received'
  const isPriority = cond.field === 'priority'

  const handleFieldChange = (field: RuleField) => {
    const ops = FIELD_OPERATORS[field] ?? []
    onChange({ ...cond, field, operator: ops[0], value: '' })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={cond.field}
        onChange={e => handleFieldChange(e.target.value as RuleField)}
        className="h-8 rounded-lg border border-border bg-background text-sm px-2 text-foreground focus:ring-1 focus:ring-ring outline-none"
      >
        {(Object.keys(FIELD_LABELS) as RuleField[]).map(f => (
          <option key={f} value={f}>{FIELD_LABELS[f]}</option>
        ))}
      </select>

      <select
        value={cond.operator}
        onChange={e => onChange({ ...cond, operator: e.target.value as RuleOperator })}
        className="h-8 rounded-lg border border-border bg-background text-sm px-2 text-foreground focus:ring-1 focus:ring-ring outline-none"
      >
        {operators.map(op => (
          <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
        ))}
      </select>

      {!isBoolean && (
        isDate ? (
          <Input
            type="date"
            value={cond.value}
            onChange={e => onChange({ ...cond, value: e.target.value })}
            className="h-8 text-sm w-36"
          />
        ) : isPriority ? (
          <select
            value={cond.value}
            onChange={e => onChange({ ...cond, value: e.target.value })}
            className="h-8 rounded-lg border border-border bg-background text-sm px-2 text-foreground focus:ring-1 focus:ring-ring outline-none"
          >
            <option value="1">1 — Urgente</option>
            <option value="2">2 — Haute</option>
            <option value="3">3 — Normale</option>
            <option value="4">4 — Basse</option>
            <option value="5">5 — Très basse</option>
          </select>
        ) : (
          <Input
            value={cond.value}
            onChange={e => onChange({ ...cond, value: e.target.value })}
            placeholder={cond.field === 'size' ? 'Ko (ex: 5120 = 5 Mo)' : 'Valeur…'}
            className="h-8 text-sm flex-1 min-w-[120px]"
          />
        )
      )}

      {canRemove && (
        <button type="button" onClick={onRemove}
          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Action row
// ---------------------------------------------------------------------------

function ActionRow({
  action, onChange, onRemove, canRemove, folders,
}: {
  action: RuleAction
  onChange: (a: RuleAction) => void
  onRemove: () => void
  canRemove: boolean
  folders: { path: string; name: string }[]
}) {
  const needsValue = ACTIONS_NEEDING_VALUE.includes(action.type)
  return (
    <div className="flex items-center gap-2">
      <select
        value={action.type}
        onChange={e => onChange({ ...action, type: e.target.value as RuleActionType, value: '' })}
        className="h-8 rounded-lg border border-border bg-background text-sm px-2 text-foreground focus:ring-1 focus:ring-ring outline-none"
      >
        {(Object.keys(ACTION_LABELS) as RuleActionType[]).map(t => (
          <option key={t} value={t}>{ACTION_LABELS[t]}</option>
        ))}
      </select>

      {needsValue && action.type === 'move' && folders.length > 0 ? (
        <select
          value={action.value ?? ''}
          onChange={e => onChange({ ...action, value: e.target.value })}
          className="h-8 rounded-lg border border-border bg-background text-sm px-2 text-foreground focus:ring-1 focus:ring-ring outline-none flex-1"
        >
          <option value="">— Choisir un dossier —</option>
          {folders.map(f => <option key={f.path} value={f.path}>{f.name}</option>)}
        </select>
      ) : needsValue ? (
        <Input
          value={action.value ?? ''}
          onChange={e => onChange({ ...action, value: e.target.value })}
          placeholder={action.type === 'forward' ? 'email@exemple.com' : 'Nom du dossier…'}
          className="h-8 text-sm flex-1 min-w-0"
        />
      ) : null}

      {canRemove && (
        <button type="button" onClick={onRemove}
          className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rule Editor
// ---------------------------------------------------------------------------

interface EditorProps {
  rule: Partial<EmailRule> & { accountId?: string }
  accounts: { id: string; name: string; email: string }[]
  onSave: (rule: Partial<EmailRule> & { accountId: string }) => Promise<void>
  onCancel: () => void
  saving: boolean
  error: string | null
}

function RuleEditor({ rule, accounts, onSave, onCancel, saving, error }: EditorProps) {
  const [name, setName]           = useState(rule.name ?? '')
  const [accountId, setAccountId] = useState(rule.accountId ?? accounts[0]?.id ?? '')
  const [logic, setLogic]         = useState<'all'|'any'>(rule.conditionLogic ?? 'all')
  const [conditions, setConditions] = useState<RuleCondition[]>(
    rule.conditions?.length ? rule.conditions : [{ id: uid(), field: 'from', operator: 'contains', value: '' }]
  )
  const [actions, setActions]     = useState<RuleAction[]>(
    rule.actions?.length ? rule.actions : [{ id: uid(), type: 'mark_read' }]
  )
  const [stopProcessing, setStop] = useState(rule.stopProcessing ?? false)
  const [showAdvanced, setShowAdv]= useState(false)

  // Test state
  const [testFolder, setTestFolder] = useState('INBOX')
  const [testing, setTesting]     = useState(false)
  const [testResult, setTestResult] = useState<{
    matched: { uid: string; from: { name: string; address: string }; subject: string; date: string }[]
    scanned: number
  } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const { data: foldersData } = useSWR<{ data: { path: string; name: string }[] }>(
    accountId ? `/api/folders?account=${accountId}` : null, fetcher
  )
  const folders = foldersData?.data ?? []
  const folderPaths = folders.map(f => ({ path: f.path, name: f.name }))

  const handleTest = async () => {
    if (!rule.id) return
    setTesting(true); setTestResult(null); setTestError(null)
    try {
      const res = await fetch(`/api/rules/${rule.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: testFolder, limit: 100 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setTestResult(json.data)
    } catch (e) { setTestError(String(e)) }
    finally { setTesting(false) }
  }

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <div className="p-5 space-y-5">

        {/* Name + Account */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block font-medium">Nom de la règle *</label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="Ex : Newsletters" className="h-9 text-sm" autoFocus />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block font-medium">Compte</label>
            <select value={accountId} onChange={e => setAccountId(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-background text-sm px-2 text-foreground focus:ring-1 focus:ring-ring outline-none">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
            </select>
          </div>
        </div>

        {/* Conditions */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Conditions</span>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5">
              {(['all','any'] as const).map(l => (
                <button key={l} type="button" onClick={() => setLogic(l)}
                  className={cn('px-2.5 py-1 text-xs rounded-md transition-colors',
                    logic === l ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>
                  {l === 'all' ? 'Toutes (ET)' : "L'une (OU)"}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {logic === 'all' ? 'Toutes les conditions doivent correspondre' : 'Au moins une condition doit correspondre'}
            </span>
          </div>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <ConditionRow key={c.id} cond={c}
                onChange={updated => setConditions(cs => cs.map((x, j) => j === i ? updated : x))}
                onRemove={() => setConditions(cs => cs.filter((_, j) => j !== i))}
                canRemove={conditions.length > 1} />
            ))}
          </div>
          <button type="button" onClick={() => setConditions(cs => [...cs, { id: uid(), field: 'from', operator: 'contains', value: '' }])}
            className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Ajouter une condition
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <ArrowRight className="w-4 h-4 text-muted-foreground" />
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Actions */}
        <div>
          <span className="text-xs font-semibold text-foreground uppercase tracking-wide block mb-3">Actions</span>
          <div className="space-y-2">
            {actions.map((a, i) => (
              <ActionRow key={a.id} action={a}
                onChange={updated => setActions(as => as.map((x, j) => j === i ? updated : x))}
                onRemove={() => setActions(as => as.filter((_, j) => j !== i))}
                canRemove={actions.length > 1} folders={folderPaths} />
            ))}
          </div>
          <button type="button" onClick={() => setActions(as => [...as, { id: uid(), type: 'mark_read' }])}
            className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Ajouter une action
          </button>
        </div>

        {/* Advanced */}
        <div>
          <button type="button" onClick={() => setShowAdv(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showAdvanced ? '▲ Masquer les options avancées' : '▼ Options avancées'}
          </button>
          {showAdvanced && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input type="checkbox" checked={stopProcessing} onChange={e => setStop(e.target.checked)} className="rounded" />
              <span className="text-sm text-foreground">Arrêter le traitement des règles suivantes si cette règle correspond</span>
            </label>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <FlaskConical className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium">
                {testResult.matched.length} message{testResult.matched.length !== 1 ? 's' : ''} correspondant
                <span className="text-muted-foreground ml-1">sur {testResult.scanned} analysés dans {testFolder}</span>
              </span>
            </div>
            {testResult.matched.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {testResult.matched.slice(0, 10).map(m => (
                  <div key={m.uid} className="text-xs text-muted-foreground flex items-start gap-2">
                    <span className="shrink-0 text-foreground/50">{new Date(m.date).toLocaleDateString('fr')}</span>
                    <span className="font-medium text-foreground truncate">{m.from.name || m.from.address}</span>
                    <span className="truncate">{m.subject}</span>
                  </div>
                ))}
                {testResult.matched.length > 10 && <p className="text-xs text-muted-foreground">+{testResult.matched.length - 10} autres…</p>}
              </div>
            )}
          </div>
        )}
        {testError && <p className="text-xs text-destructive">{testError}</p>}
        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => onSave({ ...rule, name, accountId, conditionLogic: logic, conditions, actions, stopProcessing })}
          disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>

        {rule.id && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing} className="gap-1.5">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
              {testing ? 'Test…' : 'Tester dans'}
            </Button>
            <select
              value={testFolder}
              onChange={e => setTestFolder(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background text-xs px-2 text-foreground focus:ring-1 focus:ring-ring outline-none"
            >
              <option value="INBOX">INBOX</option>
              {folderPaths.filter(f => f.path !== 'INBOX').map(f => (
                <option key={f.path} value={f.path}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        <Button size="sm" variant="ghost" onClick={onCancel} className="ml-auto">Annuler</Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rule card with drag & drop
// ---------------------------------------------------------------------------

function RuleCard({
  rule, onEdit, onDelete, onToggle,
  isDragging, onDragStart, onDragOver, onDrop,
}: {
  rule: EmailRule
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
  isDragging: boolean
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'border border-border rounded-xl bg-card transition-all cursor-default',
        !rule.enabled && 'opacity-50',
        isDragging && 'opacity-40 scale-[0.99] border-primary/40'
      )}
    >
      <div className="flex items-center gap-3 px-3 py-3">
        {/* Drag handle */}
        <div className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground shrink-0">
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Toggle */}
        <button onClick={onToggle} title={rule.enabled ? 'Désactiver' : 'Activer'}
          className={cn('shrink-0 transition-colors', rule.enabled ? 'text-primary' : 'text-muted-foreground')}>
          {rule.enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{rule.name}</p>
            {rule.stopProcessing && (
              <span className="text-[10px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded shrink-0">
                Stop
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{ruleSummary(rule)}</p>

          {/* Stats */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {rule.lastRunAt ? (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="w-2.5 h-2.5" /> {formatRelative(rule.lastRunAt)}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground/50">jamais exécutée</span>
            )}
            {(rule.totalMatched ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <BarChart2 className="w-2.5 h-2.5" /> {rule.totalMatched} traité{(rule.totalMatched ?? 0) > 1 ? 's' : ''}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/50">
              {rule.conditionLogic === 'all' ? 'Toutes' : 'L\'une des'} · {rule.conditions.length} cond. · {rule.actions.length} action{rule.actions.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onEdit}
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  prefill?: {
    fromAddress?: string
    fromName?: string
    subject?: string
    accountId?: string
  }
}

export default function RulesClient({ prefill }: Props) {
  const { data: accountsData } = useSWR<{ data: { id: string; name: string; email: string }[] }>('/api/accounts', fetcher)
  const accounts = accountsData?.data ?? []

  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const effectiveAccount = selectedAccount || accounts[0]?.id || ''

  const { data, mutate } = useSWR<{ data: EmailRule[] }>(
    effectiveAccount ? `/api/rules?account=${effectiveAccount}` : null, fetcher
  )
  const rules = (data?.data ?? []).sort((a, b) => a.priority - b.priority)

  const [editing, setEditing]   = useState<Partial<EmailRule> & { accountId?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [running, setRunning]   = useState(false)
  const [runResult, setRunResult] = useState<{ processed: number; matched: number } | null>(null)
  const [runFolder, setRunFolder] = useState('INBOX')
  const [dragId, setDragId]     = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // Folders for run-now selector
  const { data: foldersData } = useSWR<{ data: { path: string; name: string }[] }>(
    effectiveAccount ? `/api/folders?account=${effectiveAccount}` : null, fetcher
  )
  const folders = foldersData?.data ?? []

  // Import ref
  const importRef = useRef<HTMLInputElement>(null)

  // SSE: listen for rule_applied events
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'rule_applied') {
          mutate()  // refresh stats
        }
      } catch {}
    }
    return () => es.close()
  }, [mutate])

  // Prefill from ReadingPane
  useEffect(() => {
    if (!prefill || !accounts.length) return
    const prefillAccountId = prefill.accountId || accounts[0]?.id
    const initialConditions: RuleCondition[] = []
    if (prefill.fromAddress) {
      initialConditions.push({ id: uid(), field: 'from', operator: 'contains', value: prefill.fromAddress })
    }
    if (prefill.subject) {
      initialConditions.push({ id: uid(), field: 'subject', operator: 'contains', value: prefill.subject })
    }
    setCreating(true)
    setEditing({
      accountId: prefillAccountId,
      name: prefill.fromName ? `De : ${prefill.fromName}` : prefill.fromAddress ? `De : ${prefill.fromAddress}` : '',
      conditionLogic: 'all',
      conditions: initialConditions.length ? initialConditions : [{ id: uid(), field: 'from', operator: 'contains', value: '' }],
      actions: [{ id: uid(), type: 'mark_read' }],
      enabled: true,
      stopProcessing: false,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length])

  // ------- Save -------
  const handleSave = async (formData: Partial<EmailRule> & { accountId: string }) => {
    setSaving(true); setError(null)
    try {
      const isNew = !formData.id
      const res = await fetch(isNew ? '/api/rules' : `/api/rules/${formData.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      await mutate()
      setEditing(null); setCreating(false)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  // ------- Delete -------
  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette règle ?')) return
    await fetch(`/api/rules/${id}`, { method: 'DELETE' })
    await mutate()
  }

  // ------- Toggle -------
  const handleToggle = async (rule: EmailRule) => {
    await fetch(`/api/rules/${rule.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    await mutate()
  }

  // ------- Drag & drop reorder -------
  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    const fromIdx = rules.findIndex(r => r.id === dragId)
    const toIdx   = rules.findIndex(r => r.id === targetId)
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setDragOverId(null); return }

    // Reassign priorities
    const newOrder = [...rules]
    const [moved] = newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, moved)

    await Promise.all(newOrder.map((r, i) =>
      fetch(`/api/rules/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: i }),
      })
    ))
    setDragId(null); setDragOverId(null)
    await mutate()
  }

  // ------- Run now -------
  const handleRunNow = async () => {
    setRunning(true); setRunResult(null)
    try {
      const res = await fetch('/api/rules/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: effectiveAccount, folder: runFolder, perPage: 50 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRunResult(json.data)
      await mutate()
    } catch (e) { setError(String(e)) }
    finally { setRunning(false) }
  }

  // ------- Export JSON -------
  const handleExport = () => {
    window.location.href = '/api/rules/export'
  }

  // ------- Export Sieve -------
  const handleExportSieve = () => {
    window.location.href = `/api/rules/sieve?account=${effectiveAccount}`
  }

  // ------- Import JSON -------
  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const res = await fetch(`/api/rules/import?account=${effectiveAccount}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      await mutate()
      setRunResult({ processed: 0, matched: result.data.imported })
    } catch (e) { setError(String(e)) }
  }

  const applyTemplate = (tpl: RuleTemplate) => {
    setCreating(true)
    setEditing({
      accountId: effectiveAccount,
      name: tpl.name,
      conditionLogic: tpl.conditionLogic,
      conditions: tpl.conditions.map(c => ({ ...c, id: uid() })),
      actions: tpl.actions.map(a => ({ ...a, id: uid() })),
      enabled: true,
      stopProcessing: false,
    })
  }

  const startNew = () => {
    setCreating(true)
    setEditing({ accountId: effectiveAccount })
    setError(null)
  }

  const cancelEdit = () => {
    setEditing(null); setCreating(false); setError(null)
  }

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Règles & Filtres</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tri automatique · exécution toutes les 5 min sur les nouveaux emails
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* Import/Export */}
          <input ref={importRef} type="file" accept=".json" className="hidden"
            onChange={e => e.target.files?.[0] && handleImport(e.target.files[0])} />
          <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}
            className="gap-1.5 h-8 text-xs">
            <Upload className="w-3.5 h-3.5" /> Importer
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5 h-8 text-xs">
            <Download className="w-3.5 h-3.5" /> JSON
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportSieve} className="gap-1.5 h-8 text-xs">
            <FileCode2 className="w-3.5 h-3.5" /> Sieve
          </Button>
          <Button size="sm" onClick={startNew} className="gap-1.5 h-8 text-xs"
            disabled={creating && !editing?.id}>
            <Plus className="w-3.5 h-3.5" /> Nouvelle règle
          </Button>
        </div>
      </div>

      {/* Account selector */}
      {accounts.length > 1 && (
        <div className="mb-4">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted p-0.5 inline-flex">
            {accounts.map(a => (
              <button key={a.id} onClick={() => setSelectedAccount(a.id)}
                className={cn('px-3 py-1.5 text-xs rounded-md transition-colors',
                  effectiveAccount === a.id
                    ? 'bg-background text-foreground shadow-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground')}>
                {a.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Run result */}
      {runResult && (
        <div className="mb-4 px-3 py-2 bg-green-500/10 text-green-700 dark:text-green-400 text-sm rounded-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {runResult.matched > 0
              ? `${runResult.matched} message${runResult.matched > 1 ? 's' : ''} traité${runResult.matched > 1 ? 's' : ''}`
              : `Aucun message ne correspond aux règles`}
            {runResult.processed > 0 && (
              <span className="text-green-600/70 dark:text-green-500/70">sur {runResult.processed} analysés</span>
            )}
          </span>
          <button onClick={() => setRunResult(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 bg-destructive/10 text-destructive text-sm rounded-lg flex items-center justify-between">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</span>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* New rule editor */}
      {creating && (
        <div className="mb-6">
          <RuleEditor rule={editing!} accounts={accounts} onSave={handleSave}
            onCancel={cancelEdit} saving={saving} error={error} />
        </div>
      )}

      {/* Run Now bar — only when rules exist */}
      {rules.length > 0 && !creating && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-xl border border-border bg-muted/30">
          <Play className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground flex-1">
            Appliquer toutes les règles sur les messages existants dans
          </span>
          <select
            value={runFolder}
            onChange={e => setRunFolder(e.target.value)}
            className="h-7 rounded-lg border border-border bg-background text-xs px-2 text-foreground focus:ring-1 focus:ring-ring outline-none"
          >
            <option value="INBOX">INBOX</option>
            {folders.filter(f => f.path !== 'INBOX').map(f => (
              <option key={f.path} value={f.path}>{f.name}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={handleRunNow} disabled={running} className="gap-1.5 h-7 text-xs">
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? 'Exécution…' : 'Exécuter'}
          </Button>
        </div>
      )}

      {/* Rule list (drag & drop) */}
      {rules.length > 0 && (
        <div className="space-y-2 mb-6">
          {rules.map(rule => (
            <div key={rule.id}
              onDragOver={e => { e.preventDefault(); setDragOverId(rule.id) }}
              onDrop={() => handleDrop(rule.id)}
              className={cn(dragOverId === rule.id && dragId !== rule.id && 'ring-2 ring-primary/40 rounded-xl')}
            >
              {editing?.id === rule.id && !creating ? (
                <RuleEditor rule={editing} accounts={accounts} onSave={handleSave}
                  onCancel={cancelEdit} saving={saving} error={error} />
              ) : (
                <RuleCard
                  rule={rule}
                  onEdit={() => { setCreating(false); setEditing(rule); setError(null) }}
                  onDelete={() => handleDelete(rule.id)}
                  onToggle={() => handleToggle(rule)}
                  isDragging={dragId === rule.id}
                  onDragStart={() => setDragId(rule.id)}
                  onDragOver={e => { e.preventDefault(); setDragOverId(rule.id) }}
                  onDrop={() => handleDrop(rule.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {rules.length === 0 && !creating && (
        <div className="flex flex-col items-center justify-center py-12 text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Filter className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-base font-semibold mb-1">Aucune règle configurée</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Les règles s&apos;appliquent automatiquement toutes les 5 minutes.
            Commencez avec un modèle ou créez votre propre règle.
          </p>
        </div>
      )}

      {/* Templates */}
      {!creating && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold">Démarrage rapide — Modèles</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map(tpl => (
              <button key={tpl.id} onClick={() => applyTemplate(tpl)}
                className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-colors text-left group">
                <span className="text-xl shrink-0 mt-0.5">{tpl.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium group-hover:text-primary transition-colors">{tpl.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>
                  <p className="text-[10px] text-primary/70 mt-1">
                    {tpl.actions.map(a => ACTION_LABELS[a.type]).join(' + ')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
