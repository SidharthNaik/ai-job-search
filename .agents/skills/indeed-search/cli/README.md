# indeed-cli

Zero-runtime-dependency Bun/TypeScript CLI for **Indeed India**. Reads public
`/jobs` HTML JSON assignments for search and selected-posting detail. No login,
API key or paid provider. See [the skill](../SKILL.md) for access restrictions,
experience interpretation and workflow use, and [source reference](../url-reference.md)
for observed fields and fixture provenance.

```bash
bun run src/cli.ts search --country IN -l India -q "Software Engineer" --limit 5
bun run src/cli.ts search --country IN -l India -q "Senior Software Engineer" --limit 3 --experience-target 8 --format table
bun run src/cli.ts detail a7dc07c6785bcc7c --format plain
```

Only India is supported. Required search flags are country, location and query.
Page is 1–10; limit is 1–25 (default 5). Formats: json, table, plain. Unsupported
recency/workplace flags fail. Experience analysis is local, fetches capped full
descriptions and retains ambiguous cases; it is not an Indeed search filter.
`--help` documents every flag. Missing source data remains null. Errors are JSON
on stderr, exit 1; successful search JSON has `{meta: {count, page}, results}`.

The embedded JSON can be read with a balanced-object scanner and `JSON.parse`,
so a DOM/parser runtime dependency is unnecessary. Page JavaScript is never
executed. Text conversion preserves Unicode, paragraphs and common entities.

```bash
bun install
bun run typecheck
bun run test
```

Tests use sanitized captures and mocks only. For an on-demand live check, run
the commands above, check populated IDs/titles/companies, then select one returned
ID for detail and read its experience clauses. Keep volume low. A 403/challenge,
robots denial, changed markup or failed detail is an error, never empty success.

The request layer checks current robots policy, follows at most three safe
redirects on the same host/path, uses 15-second timeouts and at most three
429/5xx retries with jitter. It honors short Retry-After values and stops on
long cooldowns. `/viewjob` is never requested. A source expiration flag is the
only reason to emit `isActive: false`; other statuses remain unknown.

## Live validation — 22 October 2026

The implemented CLI returned ten India results for `Senior Software Engineer`.
One returned ID, `a7dc07c6785bcc7c`, resolved through `detail` to American Express,
Senior Software Engineer II, with the same ID/title/company/canonical URL and
a readable full description requiring **10+ years of software engineering
experience**. Its actual minimum remains ten; this is an 8+ target match, not
a claim that eight years meets a ten-year minimum. The detail date was absent
from the matching response and correctly remained null.

A one-result live search with `--experience-target 8` also successfully fetched
and analyzed its full description. Its five-year requirement was retained as
an overlapping case, rather than being called an explicit 8+ match. A further
returned Insight Software posting stated **6–8+ years** and was also identified
as overlapping. Search keywords/titles alone were insufficient numeric evidence.

Validation: CLI TypeScript check and 71 offline tests passed; 72 repository
regressions covering portal output, host routing, skill lint, permission guards,
installation and the portal generator passed. Skill lint and security guard
commands also passed. Only after search, detail and tests passed was the skill
enabled. No live requests are part of routine tests or CI.
