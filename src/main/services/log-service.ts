import { appendFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SECRET_KEYS = /^(token|password|authorization)$/i
const redactString = (value: string): string => {
  let result = value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi, '$1[REDACTED]@')
  const home = homedir()
  if (home) result = result.split(home).join('~')
  const username = process.env.USER ?? process.env.USERNAME
  if (username) result = result.replaceAll(username, '<user>')
  return result
}
const redact = (value: unknown): unknown => {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item)]))
  }
  return value
}

export class LogService {
  private readonly directory: string
  private readonly maxFiles = 10
  private readonly maxBytes = 2 * 1024 * 1024
  constructor(userData: string) { this.directory = join(userData, 'logs') }

  async write(level: string, message: string, context?: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const file = join(this.directory, `xc-skills-${new Date().toISOString().slice(0, 10)}.jsonl`)
    let line = JSON.stringify(redact({ timestamp: new Date().toISOString(), level, message, context })) + '\n'
    if (Buffer.byteLength(line) > this.maxBytes) line = `${line.slice(0, this.maxBytes - 1)}\n`
    let bytes = 0
    try { bytes = (await stat(file)).size } catch { /* new file */ }
    if (bytes + Buffer.byteLength(line) > this.maxBytes) {
      await rename(file, `${file}.${Date.now()}`).catch(() => undefined)
    }
    await appendFile(file, line, 'utf8')
    await this.prune()
  }
  async log(event: string, context?: Record<string, unknown>): Promise<void> { return this.write('info', event, context) }
  async info(message: string, context?: unknown): Promise<void> { return this.write('info', message, context) }
  async error(message: string, context?: unknown): Promise<void> { return this.write('error', message, context) }

  private async prune(): Promise<void> {
    const entries = (await readdir(this.directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.startsWith('xc-skills-'))
    const files = await Promise.all(entries.map(async (entry) => ({ name: entry.name, mtime: (await stat(join(this.directory, entry.name))).mtimeMs })))
    files.sort((a, b) => b.mtime - a.mtime)
    await Promise.all(files.slice(this.maxFiles).map((entry) => rm(join(this.directory, entry.name), { force: true })))
  }
}
