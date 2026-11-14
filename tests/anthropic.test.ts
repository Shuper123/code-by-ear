import { describe, expect, it, vi } from 'vitest'
import {
  AiError,
  ANTHROPIC_VERSION,
  buildBody,
  buildHeaders,
  extractJson,
  sendForJson,
  sendMessage,
} from '../src/ai/anthropic'

const cred = { apiKey: 'sk-test', workspaceId: '' }
const req = { model: 'claude-haiku-5-5', maxTokens: 50, system: 'sys', user: 'hi', cacheSystem: true }

function reply(text: string, status = 200) {
  const body = status === 200 ? { content: [{ type: 'text', text }], model: 'claude-haiku-5-5', stop_reason: 'end_turn' } : { error: { type: 'x', message: text } }
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('request shape', () => {
  it('uses bearer auth, the 2026-10-21 version and the browser-access header', () => {
    const h = buildHeaders({ apiKey: ' sk-abc ', workspaceId: 'wrkspc_1' })
    expect(h.Authorization).toBe('Bearer sk-abc')
    expect(h['anthropic-version']).toBe('2026-10-21')
    expect(ANTHROPIC_VERSION).toBe('2026-10-21')
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(h['anthropic-workspace-id']).toBe('wrkspc_1')
    expect(buildHeaders({ apiKey: 'k' })['anthropic-workspace-id']).toBeUndefined()
  })
  it('never sends sampling parameters (removed in 2026-10-21) and caches the system prompt', () => {
    const b = buildBody(req)
    expect(b).not.toHaveProperty('temperature')
    expect(b).not.toHaveProperty('top_p')
    expect(b).not.toHaveProperty('top_k')
    expect(b.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }])
    expect(b.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('sendMessage', () => {
  it('returns the text of a good reply', async () => {
    const fetchImpl = vi.fn(async () => reply('ready'))
    const r = await sendMessage(cred, req, { fetchImpl })
    expect(r.text).toBe('ready')
    expect(r.attempts).toBe(1)
  })
  it('retries once on a server error, then succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply('boom', 529)).mockResolvedValueOnce(reply('ok'))
    const r = await sendMessage(cred, req, { fetchImpl, retryDelayMs: 1 })
    expect(r.text).toBe('ok')
    expect(r.attempts).toBe(2)
  })
  it('does not retry an auth error', async () => {
    const fetchImpl = vi.fn(async () => reply('invalid x-api-key', 401))
    await expect(sendMessage(cred, req, { fetchImpl, retryDelayMs: 1 })).rejects.toMatchObject({ kind: 'auth' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('recognizes the missing-workspace error', async () => {
    const fetchImpl = vi.fn(async () =>
      reply('This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header', 400),
    )
    await expect(sendMessage(cred, req, { fetchImpl })).rejects.toMatchObject({ kind: 'workspace' })
  })
  it('times out after the limit, retries once, then fails with timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        }),
    )
    const t0 = Date.now()
    await expect(sendMessage(cred, req, { fetchImpl, timeoutMs: 60, retryDelayMs: 1 })).rejects.toMatchObject({ kind: 'timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
  it('fails fast with no key', async () => {
    await expect(sendMessage({ apiKey: '' }, req)).rejects.toBeInstanceOf(AiError)
  })
})

describe('JSON replies', () => {
  const isScore = (x: unknown): x is { score: number } => typeof (x as { score?: unknown })?.score === 'number'
  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('```json\n{"score": 2}\n```')).toEqual({ score: 2 })
    expect(extractJson('Sure! {"score": 3} hope that helps')).toEqual({ score: 3 })
    expect(extractJson('no json here')).toBeNull()
  })
  it('retries an invalid JSON reply once, then succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply('not json')).mockResolvedValueOnce(reply('{"score": 1}'))
    const { data } = await sendForJson(cred, req, isScore, { fetchImpl })
    expect(data.score).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('gives up after two invalid replies so the app can fall back to self-rating', async () => {
    const fetchImpl = vi.fn(async () => reply('still not json'))
    await expect(sendForJson(cred, req, isScore, { fetchImpl })).rejects.toMatchObject({ kind: 'bad-response' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
