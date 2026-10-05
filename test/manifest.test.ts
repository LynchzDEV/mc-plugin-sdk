import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { manifestSchema, parseManifest, SUPPORTED_PLUGIN_APIS } from '../src/manifest'
import type { PluginManifest } from '../src/types'

const PLUGIN_ID_PATTERN = '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'

const clickupManifest: PluginManifest = {
  id: 'clickup-board',
  name: 'ClickUp board',
  version: '1.0.0',
  description: 'See a ClickUp board and start a chat or terminal on any task.',
  pluginApi: 1,
  runtime: 'isolated',
  icon: 'assets/icon.svg',
  server: 'src/server.ts',
  screen: 'src/screen.ts',
  permissions: {
    network: ['api.clickup.com'],
    sessions: ['chat', 'terminal'],
    settings: true,
  },
  settings: [
    { key: 'token', label: 'ClickUp token', type: 'secret', help: 'ClickUp, Settings, Apps, Generate.' },
  ],
}

function errorsOf(raw: unknown): string[] {
  const result = parseManifest(raw)
  if (!result.ok) return result.errors
  throw new Error('expected the manifest to be refused')
}

describe('parseManifest', () => {
  test('parses the ClickUp manifest from the spec', () => {
    const result = parseManifest(clickupManifest)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest).toEqual(clickupManifest)
  })

  test('accepts a minimal manifest with only a server part', () => {
    const result = parseManifest({
      id: 'tiny-tool',
      name: 'Tiny tool',
      version: '0.1.0',
      description: 'Does one thing.',
      pluginApi: 1,
      runtime: 'trusted',
      server: 'src/server.ts',
      permissions: {},
    })
    expect(result.ok).toBe(true)
  })

  test('pluginApi 2 says it needs a newer Mission Control', () => {
    const errors = errorsOf({ ...clickupManifest, pluginApi: 2 })
    expect(errors).toContain('This plugin needs a newer Mission Control')
  })

  test('rejects an id with uppercase and underscores', () => {
    expect(errorsOf({ ...clickupManifest, id: 'Bad_ID' }).length).toBeGreaterThan(0)
  })

  test('rejects ids shorter than 3 or longer than 40 characters', () => {
    expect(errorsOf({ ...clickupManifest, id: 'ab' }).length).toBeGreaterThan(0)
    expect(errorsOf({ ...clickupManifest, id: 'a'.repeat(41) }).length).toBeGreaterThan(0)
  })

  test('rejects a server path outside the repo', () => {
    expect(errorsOf({ ...clickupManifest, server: '../x.ts' }).length).toBeGreaterThan(0)
  })

  test('rejects an absolute screen path', () => {
    expect(errorsOf({ ...clickupManifest, screen: '/etc/passwd' }).length).toBeGreaterThan(0)
  })

  test('rejects wildcard network permissions', () => {
    const permissions = { ...clickupManifest.permissions, network: ['*.clickup.com'] }
    expect(errorsOf({ ...clickupManifest, permissions }).length).toBeGreaterThan(0)
  })

  test('rejects network entries that are not plain host names', () => {
    const urlForm = { ...clickupManifest.permissions, network: ['https://api.clickup.com'] }
    expect(errorsOf({ ...clickupManifest, permissions: urlForm }).length).toBeGreaterThan(0)
    const localhostForm = { ...clickupManifest.permissions, network: ['localhost'] }
    expect(errorsOf({ ...clickupManifest, permissions: localhostForm }).length).toBeGreaterThan(0)
  })

  test('rejects a session kind other than chat and terminal', () => {
    const permissions = { ...clickupManifest.permissions, sessions: ['chat', 'irc'] }
    expect(errorsOf({ ...clickupManifest, permissions }).length).toBeGreaterThan(0)
  })

  test('rejects a repeated session kind', () => {
    const permissions = { ...clickupManifest.permissions, sessions: ['chat', 'chat'] }
    expect(errorsOf({ ...clickupManifest, permissions })).toContain('sessions must not repeat')
  })

  test('accepts queueSource true or false and rejects a non-boolean', () => {
    for (const queueSource of [true, false]) {
      const result = parseManifest({ ...clickupManifest, queueSource })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.manifest.queueSource).toBe(queueSource)
    }
    expect(errorsOf({ ...clickupManifest, queueSource: 'yes' }).length).toBeGreaterThan(0)
  })

  test('rejects an unknown top-level field', () => {
    expect(errorsOf({ ...clickupManifest, homepage: 'https://example.com' }).length).toBeGreaterThan(0)
  })

  test('rejects an unknown permissions field', () => {
    const permissions = { ...clickupManifest.permissions, filesystem: true }
    expect(errorsOf({ ...clickupManifest, permissions }).length).toBeGreaterThan(0)
  })

  test('rejects an unknown settings field property', () => {
    const settings = [{ key: 'token', label: 'Token', type: 'secret', placeholder: 'paste it' }]
    expect(errorsOf({ ...clickupManifest, settings }).length).toBeGreaterThan(0)
  })

  test('rejects a manifest missing its name', () => {
    const { name: _name, ...withoutName } = clickupManifest
    expect(errorsOf(withoutName).length).toBeGreaterThan(0)
  })

  test('rejects a settings field with an unknown type', () => {
    const settings = [{ key: 'token', label: 'Token', type: 'password' }]
    expect(errorsOf({ ...clickupManifest, settings }).length).toBeGreaterThan(0)
  })
})

describe('manifestSchema', () => {
  test('accepts the spec manifest', () => {
    expect(manifestSchema.safeParse(clickupManifest).success).toBe(true)
  })

  test('SUPPORTED_PLUGIN_APIS lists exactly version 1', () => {
    expect(SUPPORTED_PLUGIN_APIS).toEqual([1])
  })

  test('rejects pluginApi 2 like the JSON Schema enum', () => {
    expect(manifestSchema.safeParse({ ...clickupManifest, pluginApi: 2 }).success).toBe(false)
  })

  test('rejects repeated session kinds like the JSON Schema uniqueItems', () => {
    const permissions = { ...clickupManifest.permissions, sessions: ['chat', 'chat'] }
    expect(manifestSchema.safeParse({ ...clickupManifest, permissions }).success).toBe(false)
  })

  test('rejects unknown fields like the JSON Schema additionalProperties', () => {
    expect(manifestSchema.safeParse({ ...clickupManifest, homepage: 'https://example.com' }).success).toBe(false)
    const permissions = { ...clickupManifest.permissions, filesystem: true }
    expect(manifestSchema.safeParse({ ...clickupManifest, permissions }).success).toBe(false)
  })
})

describe('schema/mc-plugin.schema.json', () => {
  test('mirrors the manifest rules for editors', () => {
    const schema = JSON.parse(readFileSync('schema/mc-plugin.schema.json', 'utf8'))
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.properties.id.pattern).toBe(PLUGIN_ID_PATTERN)
    expect(schema.properties.pluginApi.enum).toEqual([1])
    expect(schema.properties.runtime.enum).toEqual(['trusted', 'isolated'])
    expect(schema.properties.permissions.properties.sessions.uniqueItems).toBe(true)
    expect(new RegExp(schema.$defs.repoPath.pattern).test('../x.ts')).toBe(false)
    expect(new RegExp(schema.$defs.repoPath.pattern).test('src/server.ts')).toBe(true)
    expect(new RegExp(schema.properties.permissions.properties.network.items.pattern).test('*.clickup.com')).toBe(false)
    expect(new RegExp(schema.properties.permissions.properties.network.items.pattern).test('api.clickup.com')).toBe(true)
    expect(schema.properties.queueSource.type).toBe('boolean')
  })
})
