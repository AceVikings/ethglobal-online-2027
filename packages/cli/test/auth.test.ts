import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearAuth, loadAuth, saveAuth } from '../src/auth.ts'

test('auth storage is owner-only and environment tokens take precedence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desk-cli-auth-'))
  const path = join(root, 'nested', 'auth.json')
  await saveAuth({ token: 'stored-token', serviceUrl: 'https://stored.test' }, path)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.deepEqual(await loadAuth({}, path), { token: 'stored-token', serviceUrl: 'https://stored.test' })
  assert.deepEqual(await loadAuth({ CONFORMANCE_ACCESS_TOKEN: 'env-token', CONFORMANCE_SERVICE_URL: 'https://env.test' }, path), {
    token: 'env-token', serviceUrl: 'https://env.test',
  })
  await clearAuth(path)
  await assert.rejects(() => loadAuth({}, path), /not authenticated/)
})
