export const BUILD = __BUILD__

export function buildLabel(): string {
  const d = new Date(BUILD.time)
  const when = isNaN(d.getTime())
    ? BUILD.time
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `v${BUILD.version} · ${BUILD.sha} · ${when}`
}
