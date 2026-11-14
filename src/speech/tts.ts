// Speech out: the phone's text-to-speech voices through speechSynthesis.
// Raw code never comes here; drills carry pre-written spoken versions.

export interface SpeakOptions {
  rate?: number
  voiceURI?: string
  lang?: string
}

// Chrome can garbage-collect an utterance mid-speech and never fire `end`; keep references.
const live = new Set<SpeechSynthesisUtterance>()

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getVoices(): SpeechSynthesisVoice[] {
  return ttsSupported() ? window.speechSynthesis.getVoices() : []
}

/** Voices load asynchronously on Android; wait briefly for them. */
export function waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([])
  const now = window.speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      clearTimeout(t)
      resolve(window.speechSynthesis.getVoices())
    }
    const t = setTimeout(done, timeoutMs)
    window.speechSynthesis.addEventListener('voiceschanged', done)
  })
}

/** Preferred voice: the saved one, else a local US English voice, else any English voice. */
export function chooseVoice(voices: SpeechSynthesisVoice[], voiceURI?: string): SpeechSynthesisVoice | undefined {
  if (voiceURI) {
    const v = voices.find((x) => x.voiceURI === voiceURI)
    if (v) return v
  }
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  return (
    en.find((v) => v.lang.toLowerCase().replace('_', '-') === 'en-us' && v.localService) ??
    en.find((v) => v.lang.toLowerCase().replace('_', '-') === 'en-us') ??
    en.find((v) => v.localService) ??
    en[0] ??
    voices[0]
  )
}

/** Split text into sentence-sized chunks; long single utterances get cut off on some phones. */
export function splitIntoChunks(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [clean]
  const chunks: string[] = []
  let cur = ''
  const push = (s: string) => {
    const t = s.trim()
    if (t) chunks.push(t)
  }
  for (const s of sentences) {
    if (s.length > max) {
      push(cur)
      cur = ''
      // break an over-long sentence at commas, then at spaces
      let rest = s
      while (rest.length > max) {
        let cut = rest.lastIndexOf(', ', max)
        if (cut < max / 3) cut = rest.lastIndexOf(' ', max)
        if (cut <= 0) cut = max
        push(rest.slice(0, cut + 1))
        rest = rest.slice(cut + 1)
      }
      cur = rest
    } else if ((cur + s).length > max) {
      push(cur)
      cur = s
    } else {
      cur += s
    }
  }
  push(cur)
  return chunks
}

export function estimateSpeechMs(text: string, rate = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.round(((words / 165) * 60000) / Math.max(0.3, rate))
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel()
}

/**
 * Speak text and resolve when it has finished (or was aborted). Never rejects: a broken voice
 * must not stall a hands-free session.
 */
export async function speak(text: string, opts: SpeakOptions = {}, signal?: AbortSignal): Promise<void> {
  if (!ttsSupported()) return
  const synth = window.speechSynthesis
  const chunks = splitIntoChunks(text)
  if (!chunks.length) return
  const voice = chooseVoice(await waitForVoices(), opts.voiceURI)
  if (synth.paused) synth.resume()
  for (const chunk of chunks) {
    if (signal?.aborted) return
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(chunk)
      if (voice) {
        u.voice = voice
        u.lang = voice.lang
      } else {
        u.lang = opts.lang ?? 'en-US'
      }
      u.rate = opts.rate ?? 1
      live.add(u)
      let done = false
      let started = false
      const finish = () => {
        if (done) return
        done = true
        live.delete(u)
        clearTimeout(guard)
        clearInterval(poll)
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        synth.cancel()
        finish()
      }
      u.onstart = () => {
        started = true
      }
      u.onend = finish
      u.onerror = finish
      signal?.addEventListener('abort', onAbort)
      // Safety nets: some Android builds never fire `end`.
      const guard = setTimeout(finish, estimateSpeechMs(chunk, u.rate) * 2 + 4000)
      const poll = setInterval(() => {
        if (synth.speaking) started = true
        else if (started) finish()
      }, 250)
      synth.speak(u)
    })
  }
}
