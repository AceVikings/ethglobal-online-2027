# Brand — AI Clearing Desk

_Status: active_

AI Clearing Desk uses a minimalist editorial system: cinematic and spacious at the entry point, then precise and information-dense where held trades, paid decisions, and settlement evidence matter. The experience should feel calm, high-end, and exact about both execution and release.

## Palette

- Canvas: `#f6f4ef`
- Raised surface: `#ffffff`
- Loading fallback: `hsl(201, 100%, 13%)`
- Primary text: `#0f172a`
- Secondary text: `hsl(215, 25%, 32%)`
- Primary action: `#000000` with `#ffffff` text
- Success: `#26734d` — reserved for a finalized `EXECUTED` hold.
- Adverse: `#ff5c5c` — denied, released, expired, and failed states.
- Hairline: `rgba(15, 23, 42, 0.16)`

## Typography

- Headlines: Instrument Serif, regular weight, tightly tracked.
- Body and interface controls: Inter, regular to medium weight.
- Identifiers, timestamps, metrics, and table rows: Geist Mono.
- Use tabular numerals for values that need to align.

## Shape and interaction

- Primary buttons are black, fully rounded pills with subtle hover scale.
- Status chips are pills: fully rounded.
- Cards use a one-pixel hairline border and no decorative shadow.
- Focus uses a visible navy ring. Green marks final ATS execution only. Approval remains neutral until settlement reaches finality. Red marks denied, released, expired, and failed states.
- Hero content enters with an 800ms fade-and-rise sequence, staggered by 200ms and disabled for reduced-motion users.

## Voice

Short, exact, and operational. Prefer “Hold released · no units transferred” to a generic refusal. Keep the deterministic decision authoritative, label DeepSeek explanations as non-authoritative, and never imply approval is final settlement.
