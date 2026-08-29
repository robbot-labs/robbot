export function readAiConfigKey(raw: string | null): string {
  if (!raw) return ''

  try {
    const value = JSON.parse(raw) as Record<string, unknown>

    return typeof value.key === 'string' ? value.key : ''
  } catch {
    return ''
  }
}
