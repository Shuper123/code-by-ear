// Anthropic Messages API client, called straight from the browser with the user's own key.
//
// Headers follow the current Claude API docs (checked 2026-11-14):
//   Authorization: Bearer <key>, anthropic-version: 2026-10-21, content-type: application/json,
//   anthropic-dangerous-direct-browser-access: true (required for CORS from a web page),
//   anthropic-workspace-id: <id> (only needed for keys that are not scoped to one workspace).
// API version 2026-10-21 removed temperature/top_p/top_k: sending any of them is a 400 error,
// so requests never include sampling parameters.
//
// Each call has an 8-second timeout and one retry for transient failures.

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2026-10-21'

export interface AiCredentials {
  apiKey: string
  workspaceId?: string
}

export interface MessageRequest {
  model: string
  maxTokens: number
  system?: string
  user: string
  /** Mark the system prompt for prompt caching. */
  cacheSystem?: boolean
}

export interface MessageResult {
  text: string
  latencyMs: number
  model: string
  stopReason: string | null
  attempts: number
  usage?: Record<string, number>
}

export type AiErrorKind =
  | 'no-key'
  | 'auth'
  | 'workspace'
  | 'permission'
  | 'not-found'
  | 'bad-request'
  | 'rate-limit'
  | 'overloaded'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad-response'

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(message)
    this.name = 'AiError'
  }
}

export interface CallOptions {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export function buildHeaders(cred: AiCredentials): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${cred.apiKey.trim()}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
  const ws = cred.workspaceId?.trim()
  if (ws) h['anthropic-workspace-id'] = ws
  return h
}

export function buildBody(req: MessageRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: [{ role: 'user', content: req.user }],
  }
  if (req.system) {
    body.system = [
      req.cacheSystem
        ? { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text: req.system },
    ]
  }
  return body
}

function errorFromResponse(status: number, payload: unknown): AiError {
  const err = (payload as { error?: { type?: string; message?: string } } | null)?.error
  const msg = err?.message ?? `HTTP ${status}`
  if (status === 401) return new AiError('auth', msg, status)
  if (status === 403) return new AiError('permission', msg, status)
  if (status === 404) return new AiError('not-found', msg, status)
  if (status === 400 && /workspace/i.test(msg)) return new AiError('workspace', msg, status)
  if (status === 400 || status === 413 || status === 422) return new AiError('bad-request', msg, status)
  if (status === 429) return new AiError('rate-limit', msg, status, true)
  if (status === 529) return new AiError('overloaded', msg, status, true)
  if (status >= 500) return new AiError('server', msg, status, true)
  return new AiError('bad-request', msg, status)
}

async function attempt(cred: AiCredentials, req: MessageRequest, opts: CallOptions): Promise<MessageResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const timeoutMs = opts.timeoutMs ?? 8000
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)
  const onOuterAbort = () => ctrl.abort()
  opts.signal?.addEventListener('abort', onOuterAbort)
  const t0 = Date.now()
  try {
    let res: Response
    try {
      res = await fetchImpl(ANTHROPIC_URL, {
        method: 'POST',
        headers: buildHeaders(cred),
        body: JSON.stringify(buildBody(req)),
        signal: ctrl.signal,
      })
    } catch (e) {
      if (timedOut) throw new AiError('timeout', `No reply within ${timeoutMs / 1000} seconds`, undefined, true)
      if (opts.signal?.aborted) throw new AiError('timeout', 'Cancelled', undefined, false)
      throw new AiError('network', `Network or CORS failure: ${String(e)}`, undefined, true)
    }
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      if (timedOut) throw new AiError('timeout', `No reply within ${timeoutMs / 1000} seconds`, undefined, true)
      payload = null
    }
    if (!res.ok) throw errorFromResponse(res.status, payload)
    const p = payload as {
      content?: Array<{ type: string; text?: string }>
      model?: string
      stop_reason?: string | null
      usage?: Record<string, number>
    } | null
    if (!p || !Array.isArray(p.content)) throw new AiError('bad-response', 'Reply had no content', res.status)
    const text = p.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
    return {
      text,
      latencyMs: Date.now() - t0,
      model: p.model ?? req.model,
      stopReason: p.stop_reason ?? null,
      attempts: 1,
      usage: p.usage,
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Send one Messages request with timeout and retry. Throws AiError. */
export async function sendMessage(cred: AiCredentials, req: MessageRequest, opts: CallOptions = {}): Promise<MessageResult> {
  if (!cred.apiKey?.trim()) throw new AiError('no-key', 'No API key set')
  const retries = opts.retries ?? 1
  let lastErr: AiError | null = null
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await attempt(cred, req, opts)
      return { ...r, attempts: i + 1 }
    } catch (e) {
      lastErr = e instanceof AiError ? e : new AiError('network', String(e), undefined, true)
      if (!lastErr.retryable || i === retries || opts.signal?.aborted) break
      await sleep(opts.retryDelayMs ?? 400)
    }
  }
  throw lastErr!
}

/** Pull the first JSON object out of a model reply (tolerates code fences and stray prose). */
export function extractJson(text: string): unknown | null {
  const t = text.replace(/```(?:json)?/gi, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(t.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Send a request whose reply must be strict JSON. A reply that isn't valid JSON (or fails
 * `validate`) is retried once; after that the caller should fall back to self-rating.
 */
export async function sendForJson<T>(
  cred: AiCredentials,
  req: MessageRequest,
  validate: (x: unknown) => x is T,
  opts: CallOptions = {},
): Promise<{ data: T; result: MessageResult }> {
  let last: MessageResult | null = null
  for (let i = 0; i < 2; i++) {
    const result = await sendMessage(cred, req, opts)
    last = result
    const parsed = extractJson(result.text)
    if (parsed !== null && validate(parsed)) return { data: parsed, result }
  }
  throw new AiError('bad-response', `Reply was not valid JSON: ${last?.text.slice(0, 120) ?? ''}`)
}

/** Short, plain description for the screen. */
export function describeAiError(e: unknown): string {
  const kind = e instanceof AiError ? e.kind : 'network'
  switch (kind) {
    case 'no-key':
      return 'No API key yet. Add one in Settings.'
    case 'auth':
      return 'The API key was rejected (wrong, revoked or expired). Create a new key and paste it in Settings.'
    case 'workspace':
      return 'This key is not scoped to a workspace. Add the workspace ID in Settings, or create a key scoped to one workspace.'
    case 'permission':
      return 'The key is not allowed to use this model or workspace.'
    case 'not-found':
      return 'Model not found. Check the model name in Settings.'
    case 'rate-limit':
      return 'Rate or spend limit reached. Check limits in the Claude Console.'
    case 'overloaded':
      return 'The API is overloaded right now. Try again shortly.'
    case 'server':
      return 'The API had a server error. Try again shortly.'
    case 'timeout':
      return 'No reply within 8 seconds.'
    case 'network':
      return 'Could not reach the API (offline, blocked, or a CORS problem).'
    case 'bad-response':
      return 'The reply was not in the expected format.'
    default:
      return 'The request failed.'
  }
}
