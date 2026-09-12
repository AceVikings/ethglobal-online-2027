'use strict'

function parseDecision(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const value = JSON.parse(cleaned)
  if (!value || !['ACT', 'REFUSE'].includes(value.recommendation)) {
    throw new Error('Reasoner returned an invalid recommendation')
  }
  if (typeof value.rationale !== 'string' || value.rationale.length < 1 || value.rationale.length > 500) {
    throw new Error('Reasoner returned an invalid rationale')
  }
  return { recommendation: value.recommendation, rationale: value.rationale }
}

function createChatCompletionsClient({ apiKey, baseUrl, timeoutMs, fetchImpl }) {
  const fetch = fetchImpl || globalThis.fetch
  if (typeof fetch !== 'function') throw new Error('fetch is required for the reasoning provider')
  return {
    chat: {
      completions: {
        async create(request) {
          const controller = new AbortController()
          const timeout = setTimeout(
            () => controller.abort(new Error(`Reasoning provider timed out after ${timeoutMs}ms`)),
            timeoutMs,
          )
          try {
            const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify(request),
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`Reasoning provider returned HTTP ${response.status}`)
            return response.json()
          } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason
            throw error
          } finally {
            clearTimeout(timeout)
          }
        },
      },
    },
  }
}

function createReasoner({ apiKey, model, baseUrl = 'https://api.deepseek.com', timeoutMs = 10000, client, fetchImpl }) {
  if (!apiKey) throw new Error('Reasoner apiKey is required')
  if (!model) throw new Error('Reasoner model is required')
  new URL(baseUrl)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Reasoner timeoutMs must be from 100 to 30000')
  const provider = client || createChatCompletionsClient({ apiKey, baseUrl, timeoutMs, fetchImpl })
  return async function reasonVerdict(verdict) {
    const action = verdict.authorization?.action ?? verdict.action ?? verdict.verdict
    const response = await provider.chat.completions.create({
      model,
      max_tokens: 256,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Explain a fixed regulated-token clearing decision. Numeric action 1 means APPROVE and requires ACT; numeric action 2 means DENY and requires REFUSE. A legacy CONFORMANT verdict requires ACT; every other legacy verdict requires REFUSE. You have no authority to change the decision or policy. Return JSON only: {"recommendation":"ACT|REFUSE","rationale":"one concise sentence"}.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            action,
            checks: verdict.checks,
            evidenceHash: verdict.authorization?.evidenceHash ?? verdict.evidenceHash,
            subject: verdict.subject,
            policy: verdict.policy,
          }),
        },
      ],
    })
    const text = response.choices?.[0]?.message?.content
    if (!text) throw new Error('Reasoner returned no text')
    return { ...parseDecision(text), model }
  }
}

module.exports = { parseDecision, createReasoner }
