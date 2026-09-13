import { mkdir, readFile, rename, writeFile, chmod, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export interface StoredAuth { token: string; serviceUrl: string }

export function defaultAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(root, 'conformance-desk', 'auth.json')
}

export async function saveAuth(auth: StoredAuth, path = defaultAuthPath()): Promise<void> {
  if (!auth.token || !auth.serviceUrl) throw new Error('token and service URL are required')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(auth)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

export async function loadAuth(env: NodeJS.ProcessEnv = process.env, path = defaultAuthPath(env)): Promise<StoredAuth> {
  if (env.CONFORMANCE_ACCESS_TOKEN) return {
    token: env.CONFORMANCE_ACCESS_TOKEN,
    serviceUrl: env.CONFORMANCE_SERVICE_URL ?? 'http://127.0.0.1:4020',
  }
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<StoredAuth>
    if (!value.token || !value.serviceUrl) throw new Error('stored authentication is incomplete')
    return { token: value.token, serviceUrl: value.serviceUrl }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('not authenticated; pipe a token to `conformance-desk auth token`')
    throw error
  }
}

export async function clearAuth(path = defaultAuthPath()): Promise<void> {
  try { await unlink(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
