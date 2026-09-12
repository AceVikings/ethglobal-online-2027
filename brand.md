# Brand — Conformance Desk

_Status: active_

Conformance Desk is a dark, developer-centric verification interface. It should feel like a credible middle-office tool: dense where the data matters, restrained everywhere else, and explicit about both approvals and refusals.

## Palette

- Canvas: `#000000`
- Raised surface: `#0a0a0a`
- Chip surface: `#1f1f1f`
- Primary text: `#ededed`
- Secondary text: `#999999`
- Active accent: `#52a8ff`
- Success: `#62c073`
- Refusal: `#ff5c5c`
- Hairline: `rgba(255, 255, 255, 0.145)`

## Typography

- Headlines and editorial copy: Inter, medium weight, tight tracking.
- Identifiers, timestamps, metrics, and table rows: Geist Mono.
- Use tabular numerals for values that need to align.

## Shape and interaction

- Primary buttons are square: zero border radius.
- Status chips are pills: fully rounded.
- Cards use a one-pixel hairline border and no decorative shadow.
- Focus uses a visible blue ring.
- Blue marks active selection. Green marks a conformant result. Red is reserved for refusals.

## Voice

Short, exact, and operational. Prefer “Operation blocked” to “Something went wrong.” Never hide a failed check or imply a transaction exists when no transaction was submitted.
