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

function createAnthropicReasoner({ apiKey, model, client }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')
  if (!model) throw new Error('ANTHROPIC_MODEL is required')
  const anthropic = client || new (require('@anthropic-ai/sdk'))({ apiKey })
  return async function reasonVerdict(verdict) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 256,
      temperature: 0,
      system: 'You are a regulated-token caretaker. A signed CONFORMANT verdict requires ACT; every other verdict requires REFUSE. Never loosen caller policy. Return JSON only: {"recommendation":"ACT|REFUSE","rationale":"one concise sentence"}.',
      messages: [{
        role: 'user',
        content: JSON.stringify({ verdict: verdict.verdict, checks: verdict.checks, subject: verdict.subject, policy: verdict.policy }),
      }],
    })
    const text = response.content?.find((item) => item.type === 'text')?.text
    if (!text) throw new Error('Reasoner returned no text')
    return { ...parseDecision(text), model }
  }
}

module.exports = { parseDecision, createAnthropicReasoner }
