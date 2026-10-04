import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from 'vscode-jsonrpc/node'
import { definePlugin } from '../src/server'
import type { ServerContext } from '../src/types'

let child: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
let connection: MessageConnection
let savedSetting: { key: string; value: string | null } | undefined
let resolveNextLog: (message: string) => void

function toNodeReadable(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as unknown as NodeWebReadableStream<Uint8Array>)
}

beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mc-plugin-sdk-'))
  child = Bun.spawn({
    cmd: [process.execPath, join(import.meta.dir, 'fixtures', 'echo-plugin.ts')],
    env: {
      ...process.env,
      MC_PLUGIN_RUNTIME: 'isolated',
      MC_PLUGIN_ID: 'echo',
      MC_PLUGIN_DATA: join(dataDir, 'files'),
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const outbound = new Writable({
    write(chunk, _encoding, callback) {
      child.stdin.write(chunk)
      child.stdin.flush()
      callback()
    },
  })
  connection = createMessageConnection(
    new StreamMessageReader(toNodeReadable(child.stdout)),
    new StreamMessageWriter(outbound),
  )
  connection.onRequest('settings.get', (params: { key: string }) => (params.key === 'token' ? 'test-token' : null))
  connection.onRequest('settings.set', (params: { key: string; value: string | null }) => {
    savedSetting = params
    return null
  })
  connection.onNotification('log', (params: { message: string }) => resolveNextLog?.(params.message))
  connection.listen()
})

afterAll(async () => {
  connection.dispose()
  child.kill()
  await child.exited
})

describe('serveStdio', () => {
  test('plugin.call echo returns the params', async () => {
    const result = await connection.sendRequest('plugin.call', {
      method: 'echo',
      params: { hello: 'world', list: [1, 2] },
    })
    expect(result).toEqual({ hello: 'world', list: [1, 2] })
  })

  test('a handler with typed params answers over the wire', async () => {
    const result = await connection.sendRequest('plugin.call', {
      method: 'board.load',
      params: { boardId: 'bcd1' },
    })
    expect(result).toBe('bcd1')
  })

  test('ctx.settings.get round-trips through the host handler', async () => {
    const result = await connection.sendRequest('plugin.call', { method: 'settings.read' })
    expect(result).toBe('test-token')
  })

  test('ctx.settings.set reaches the host handler', async () => {
    const result = await connection.sendRequest('plugin.call', { method: 'settings.write' })
    expect(result).toBe('ok')
    expect(savedSetting).toEqual({ key: 'name', value: 'clicked' })
  })

  test('ctx.log reaches the host as a log notification', async () => {
    const logArrives = new Promise<string>((resolve) => {
      resolveNextLog = resolve
    })
    await connection.sendRequest('plugin.call', { method: 'shout' })
    await expect(logArrives).resolves.toBe('hello from the plugin')
  })

  test('an unknown method fails with No method', async () => {
    const error: unknown = await connection
      .sendRequest('plugin.call', { method: 'nope' })
      .then(() => null, (thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('No method nope')
  })

  test('undeclared inherited method names fail with No method', async () => {
    for (const method of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
      const error: unknown = await connection
        .sendRequest('plugin.call', { method })
        .then(() => null, (thrown: unknown) => thrown)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(`No method ${method}`)
    }
  })

  test('a method declared with an inherited name is dispatched', async () => {
    const result = await connection.sendRequest('plugin.call', { method: 'valueOf' })
    expect(result).toBe('own-valueOf')
  })
})

describe('definePlugin', () => {
  const ctx: ServerContext = {
    settings: { get: async () => null, set: async () => {} },
    data: '/tmp/mc-plugin-sdk-direct',
    log: () => {},
  }

  test('an unannotated handler accepts unknown params on a direct call', async () => {
    const definition = definePlugin({ methods: { hello: (_p, ctx) => ctx.data } })
    expect(await definition.methods.hello(undefined, ctx)).toBe('/tmp/mc-plugin-sdk-direct')
    expect(await definition.methods.hello('anything', ctx)).toBe('/tmp/mc-plugin-sdk-direct')
  })

  test('an annotated handler keeps its param type on a direct call', async () => {
    const definition = definePlugin({ methods: { load: (params: { id: number }, _ctx) => params.id } })
    const declaredParams: Parameters<typeof definition.methods.load>[0] = { id: 7 }
    expect(await definition.methods.load(declaredParams, ctx)).toBe(7)
    // @ts-expect-error an annotated handler must reject a wrongly-shaped params object
    void definition.methods.load({ wrong: true }, ctx)
  })
})
