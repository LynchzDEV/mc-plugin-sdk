import { z } from 'zod'
import type { PluginManifest, SettingField } from './types'

export const SUPPORTED_PLUGIN_APIS: readonly number[] = [1]

const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/
const NETWORK_HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
const REPO_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/

const repoPath = (field: string) =>
  z.string().regex(REPO_PATH_PATTERN, `${field} must be a path inside the plugin repo`)

const noRepeatedSessions = (kinds: Array<'chat' | 'terminal'>) =>
  new Set(kinds).size === kinds.length

const settingFieldSchema = z.strictObject({
  key: z.string().min(1, 'settings key is required'),
  label: z.string().min(1, 'settings label is required'),
  type: z.enum(['text', 'secret']),
  help: z.string().optional(),
})

export const manifestSchema = z.strictObject({
  id: z.string().regex(PLUGIN_ID_PATTERN, 'Plugin id must be 3-40 characters of lowercase letters, digits and dashes'),
  name: z.string().min(1, 'name is required'),
  version: z.string().min(1, 'version is required'),
  description: z.string().min(1, 'description is required'),
  pluginApi: z
    .number()
    .int('pluginApi must be a whole number')
    .refine((value) => SUPPORTED_PLUGIN_APIS.includes(value), 'This plugin needs a newer Mission Control'),
  runtime: z.enum(['trusted', 'isolated']),
  icon: repoPath('icon').optional(),
  server: repoPath('server').optional(),
  screen: repoPath('screen').optional(),
  queueSource: z.boolean().optional(),
  permissions: z.strictObject({
    network: z
      .array(z.string().regex(NETWORK_HOST_PATTERN, 'Network permissions must be plain host names like api.clickup.com'))
      .optional(),
    sessions: z
      .array(z.enum(['chat', 'terminal']))
      .refine(noRepeatedSessions, 'sessions must not repeat')
      .optional(),
    settings: z.boolean().optional(),
  }),
  settings: z.array(settingFieldSchema).optional(),
})

export type ManifestParseResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] }

export function parseManifest(raw: unknown): ManifestParseResult {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
  }
  return { ok: true, manifest: parsed.data }
}

export type { PluginManifest, SettingField }
