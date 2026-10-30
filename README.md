# yqztk-capabilities

**Verifiable, private, deterministic compute primitives — zero dependencies.**

35 capabilities, exposed two ways: as an ES module library, and as an **MCP server** (38 tools) that any MCP-capable AI agent can call.

---

## Why this exists

When an AI agent does a calculation, two things are usually true: nobody can reproduce how it got the number, and the input data had to be handed to a third-party service to get there.

That is fine for "what's 15% of 80". It is not fine for a loan schedule a bank will reconcile, a PII redaction a compliance officer will sign off, or anything under GDPR/HIPAA where the data is not allowed to leave the machine.

This package is the other half: **the calculation runs locally, deterministically, and the result can be checked by hand.**

Three guarantees every capability in this package honours:

| Guarantee | What it means in practice |
|---|---|
| **Deterministic** | Same input → same output. No `Math.random`, no implicit clock reads, no environment dependence. |
| **Private** | Zero network access. Nothing leaves the calling process. There is no telemetry, no phone-home, no "anonymous usage statistics". |
| **Auditable** | Failure boundaries are explicit (throws instead of returning a wrong-looking number), and the dependency tree is empty so the audit surface is the source you can read. |

Two implementation rules follow from that:

- Anything random requires an **explicit seed** (`src/lib/prng.mjs`), never `Math.random`.
- Anything time-based requires an **explicit `now`**, never the system clock.

---

## Install

```bash
npm install yqztk-capabilities
```

Requires Node.js 18+. No build step, no peer dependencies, no transitive tree.

## Use as a library

```js
import { maskPII, buildSchedule, calcMortgage } from 'yqztk-capabilities';

// Redact PII before a text goes anywhere near a third-party model
const res = maskPII('Call john.doe@example.com or +1 415 555 0132');
// res.output → 'Call j*******@e***.com or 141-***-0132'   (default strategy: partial)
// res.detections → [
//   { type: 'email', value: 'john.doe@example.com', start: 5,  end: 25, replacement: 'j*******@e***.com' },
//   { type: 'phone', value: '+1 415 555 0132',      start: 29, end: 44, replacement: '141-***-0132' }
// ]
// Nothing leaves the process, and the caller gets a machine-readable audit record of what was found
// and where — which is the difference between "redacted" and "redacted and provable".

// A repayment schedule with integer-cent arithmetic and a final-period adjustment,
// so the closing balance is exactly zero instead of "0.0000001"
const { monthlyPayment, schedule, totals, identities } = buildSchedule({
  principal: 200000,
  annualRatePercent: 6.5,
  months: 360,
});
// identities: { principalClosed: true, interestMatches: true, balanceZero: true }
```

The `identities` object is the point: every schedule self-reports whether it satisfies
`Σ principal = principal`, `Σ interest = payments − principal`, and `closing balance = 0`.
If you are writing a test for your own wrapper, assert on those three flags.

## Use as an MCP server

The MCP server speaks JSON-RPC over stdio and has no dependency on the official SDK — it implements `initialize`, `tools/list`, `tools/call` and `ping` directly, and supports protocol versions `2025-06-18`, `2025-03-26` and `2024-11-05`.

```bash
npx -y yqztk-capabilities          # start the server on stdio
npx -y yqztk-capabilities --list   # print all 38 tools and exit
```

Register it with any MCP client (Claude Desktop, Cursor, or your own agent loop):

```json
{
  "mcpServers": {
    "yqztk": {
      "command": "npx",
      "args": ["-y", "yqztk-capabilities"]
    }
  }
}
```

Why hand-write the protocol instead of using `@modelcontextprotocol/sdk`: the SDK would add a
transitive dependency tree, which defeats the auditability guarantee above. The stdio transport is
"one JSON-RPC message per line" — the implementation is smaller than the maintenance cost of the
dependency. The protocol logic is also separated from stdin/stdout (`src/mcp/server.mjs` is pure
functions), so it is unit-tested rather than manually exercised.

---

## What's inside

35 capabilities across 12 domains, 38 MCP tools. Highlights:

| Domain | Capability | MCP tools |
|---|---|---|
| Privacy | PII masking (email, phone, card, IBAN, SSN, IDs) with configurable strategies | `mask_pii` |
| Finance | Amortization schedules (integer cents, final-period adjustment, identity self-report) | `build_amortization_schedule`, `monthly_payment`, `calc_mortgage`, `calc_car_payment`, `simulate_loan_payoff`, `calc_commission_split` |
| Security | Password strength assessment and generation (seeded) | `assess_password`, `generate_password` |
| Text | Readability (Flesch, Flesch-Kincaid, Gunning Fog), keyword density, caption limits, lorem generation | `analyze_readability`, `analyze_keyword_density`, `count_social_caption`, `generate_lorem` |
| Health | BMI, BAC estimate, body measurements | `compute_bmi`, `estimate_bac`, `analyze_body_measurements` |
| Weather | Beaufort scale, apparent temperature / heat index / wind chill | `beaufort_wind_scale`, `calc_apparent_temperature` |
| Time | Date difference, date shifting, countdown formatting, reading time | `diff_dates`, `shift_date`, `format_countdown`, `calc_reading_time` |
| Units & craft | Color format conversion, crochet hooks, model paint, nail polish mixing, hair color | `convert_color`, `convert_crochet_hook`, `mix_model_paint`, `mix_nail_polish`, `plan_hair_color` |
| Media | Aspect ratio, print size, audio file size estimate | `convert_aspect_ratio`, `calc_print_size`, `estimate_audio_file_size` |
| Business | Polling margin, meeting cost, tip splitting | `calc_polling_margin`, `calc_meeting_cost`, `split_tip` |
| Gaming | Escape-room puzzle generation (seeded), mana-curve analysis | `generate_escape_room_puzzle`, `analyze_mana_curve` |
| Outdoors / scheduling | Hiking time estimate, spaced-repetition scheduling | `estimate_hiking_time`, `schedule_scripture_review`, `calc_aquarium_stock` |

Run `npx -y yqztk-capabilities --list` for the authoritative list.

## Tests

```bash
npm test     # 361 assertions, node:test, no test framework dependency
```

The suite is the specification: each capability asserts on its own contract (including the
"throws rather than returns silently" failure boundaries, seeded determinism, and the three
schedule identities). It is also the fastest way to see how a capability is meant to be called.

A discipline test additionally enforces the package-level rules: no `Math.random`, no bare `Date.now()`,
no `node:fs`/`node:http` imports, no non-empty `dependencies`.

---

## Scope and limitations (read before shipping this in production)

- These are **primitives, not advice**. The finance capabilities model nominal rates; they do not include
  fees, insurance, tax treatment, or jurisdiction-specific rules. The health capabilities are estimates,
  not diagnostics.
- **No currency conversion.** There are no exchange rates here on purpose: a rate is a network fact, and
  this package has no network access.
- **Nominal-rate amortization only** — equal total payments (annuity). Bullet loans, grace periods,
  early-repayment recalculation and daily-interest conventions are out of scope.
- Where a capability needs "today" or a random value, you must pass it in. That is deliberate.

## License

MIT. See [LICENSE](./LICENSE).

中文说明见 [README.zh.md](./README.zh.md)。
