// AI services used by sessions: grading, Sketch conversion, error explanations, "explain more".
// Every method returns null on any failure so the session falls back (self-rating, Plan mode).
import type { Drill } from '../data/types'
import type { AiGrader } from '../engine/session'
import type { Score } from '../engine/scheduler'
import { getApiKey, getSettings, hasApiKey } from '../settings'
import { sendForJson, type AiCredentials, type CallOptions } from './anthropic'
import {
  converterSystem,
  converterUser,
  editSystem,
  editUser,
  isEditReply,
  type EditReply,
  EXPLAIN_MORE_SYSTEM,
  explainerUser,
  EXPLAINER_SYSTEM,
  explainMoreUser,
  GRADER_SYSTEM,
  graderUser,
  isConverterReply,
  isGraderReply,
  isSpokenReply,
  speakable,
  type ConverterReply,
  type GraderReply,
} from './prompts'

export interface AiConfig {
  cred: AiCredentials
  model: string
  sketchModel: string
}

export function liveConfig(): AiConfig {
  const s = getSettings()
  return { cred: { apiKey: getApiKey(), workspaceId: s.workspaceId }, model: s.model, sketchModel: s.sketchModel }
}

export class AiServices implements AiGrader {
  constructor(
    private config: () => AiConfig = liveConfig,
    private callOpts: CallOptions = {},
    private hasKey: () => boolean = hasApiKey,
  ) {}

  available(): boolean {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false
    return this.hasKey() && online
  }

  private opts(signal?: AbortSignal): CallOptions {
    return { ...this.callOpts, signal }
  }

  /** Full grader reply; throws on failure (used by the self-test). */
  async gradeRaw(d: Drill, transcript: string, signal?: AbortSignal): Promise<GraderReply> {
    const c = this.config()
    const { data } = await sendForJson(
      c.cred,
      { model: c.model, maxTokens: 300, system: GRADER_SYSTEM, user: graderUser(d, transcript), cacheSystem: true },
      isGraderReply,
      this.opts(signal),
    )
    return { ...data, missed: data.missed ?? [], verdict: data.verdict ?? '' }
  }

  async grade(d: Drill, transcript: string, signal: AbortSignal): Promise<{ score: Score; feedback: string } | null> {
    try {
      const r = await this.gradeRaw(d, transcript, signal)
      return { score: r.score, feedback: speakable(r.feedback_spoken, 60) }
    } catch {
      return null
    }
  }

  /** Literal conversion of spoken words to code; throws on failure. */
  async convertRaw(d: Drill, transcript: string, signal?: AbortSignal): Promise<ConverterReply> {
    const c = this.config()
    const { data } = await sendForJson(
      c.cred,
      { model: c.sketchModel, maxTokens: 700, system: converterSystem(d.lang), user: converterUser(d, transcript), cacheSystem: true },
      isConverterReply,
      this.opts(signal),
    )
    return {
      code: data.code,
      assumptions: (data.assumptions ?? []).map((a) => speakable(a, 25)).filter(Boolean),
      unclear: (data.unclear ?? []).map((u) => speakable(u, 15)).filter(Boolean),
    }
  }

  async convert(d: Drill, transcript: string, signal?: AbortSignal): Promise<ConverterReply | null> {
    try {
      return await this.convertRaw(d, transcript, signal)
    } catch {
      return null
    }
  }

  async explainError(d: Drill, learnerCode: string, failure: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const c = this.config()
      const { data } = await sendForJson(
        c.cred,
        { model: c.model, maxTokens: 200, system: EXPLAINER_SYSTEM, user: explainerUser(d, learnerCode, failure), cacheSystem: true },
        isSpokenReply,
        this.opts(signal),
      )
      return speakable(data.feedback_spoken, 50)
    } catch {
      return null
    }
  }

  /** One spoken edit to the learner's code (only what was asked). Null on any failure. */
  async editCode(d: Drill, code: string, instruction: string, signal?: AbortSignal): Promise<EditReply | null> {
    try {
      const c = this.config()
      const { data } = await sendForJson(
        c.cred,
        { model: c.model, maxTokens: 900, system: editSystem(d.lang), user: editUser(code, instruction), cacheSystem: true },
        isEditReply,
        this.opts(signal),
      )
      return data
    } catch {
      return null
    }
  }

  async explainMore(d: Drill, signal: AbortSignal): Promise<string | null> {
    try {
      const c = this.config()
      const { data } = await sendForJson(
        c.cred,
        { model: c.model, maxTokens: 300, system: EXPLAIN_MORE_SYSTEM, user: explainMoreUser(d), cacheSystem: true },
        isSpokenReply,
        this.opts(signal),
      )
      return speakable(data.feedback_spoken, 110)
    } catch {
      return null
    }
  }
}
