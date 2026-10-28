---
name: indeed-search
version: 1.0.0
description: >
  Search Indeed India for jobs and retrieve full postings. Use for India job
  search, Software Engineer, Senior, Lead and Staff roles, Bengaluru, Hyderabad,
  Pune and remote India vacancies. Trigger phrases: Indeed jobs, India jobs,
  naukri khojo, भारत में नौकरी, नौकरी खोजें, सॉफ्टवेयर इंजीनियर की नौकरी.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/indeed-search/cli/src/cli.ts *)
---

# Indeed India Search

Search public Indeed India listings and retrieve full descriptions using Bun,
with zero runtime dependencies, no login and no API key. India is the only
validated market. The data source is the public `/jobs` HTML and its embedded
JSON, including the selected-posting pane (`vjk`), not a partner API.

## Personal use only

Keep volume low; no commercial or bulk collection. Indeed's terms restrict
automated access and condition crawling permission on robots.txt. The CLI uses
an honest `indeed-cli/1.0` identity, checks robots.txt on every invocation, and
stops on a denial, login wall, access challenge or unsafe redirect. It never
fetches `/viewjob`, which the India host disallowed for custom bots on 22 October
2026. See [url-reference.md](url-reference.md) for the observed permitted route.

## Commands

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts search --country IN --location India -q "Software Engineer" [flags]
bun run .agents/skills/indeed-search/cli/src/cli.ts detail <id|url> [flags]
```

| Flag | Behavior |
| --- | --- |
| `--country IN` | Required for search; default IN for detail. Other markets rejected. |
| `--location` / `-l` | Required search location, e.g. India or Bengaluru. |
| `--query` / `-q` | Required keywords. Search Senior, Lead and Staff variants separately. |
| `--page` | 1–10, default 1; observed offset increment 10, despite 15 cards in captures. |
| `--limit` / `-n` | Client cap 1–25, default 5; one page only, no automatic crawling. |
| `--experience-target` | Local full-description analysis, 1–50 years; detail defaults to 8. |
| `--format` | `json` (default), `table` or `plain`. |

`--jobage` and `--remote` are **unsupported** and rejected. `/scrape` must apply
its usual date window client-side and leave missing dates unknown. A title such
as Senior or Staff does not establish a numeric experience requirement.

## India examples

```bash
bun run .agents/skills/indeed-search/cli/src/cli.ts search --country IN -l India -q "Software Engineer" --limit 5 --format table
bun run .agents/skills/indeed-search/cli/src/cli.ts search --country IN -l India -q "Senior Software Engineer" --limit 3 --experience-target 8
bun run .agents/skills/indeed-search/cli/src/cli.ts search --country IN -l Bengaluru -q "Lead Software Engineer" --format table
bun run .agents/skills/indeed-search/cli/src/cli.ts search --country IN -l Hyderabad -q "Staff Software Engineer" --page 2
bun run .agents/skills/indeed-search/cli/src/cli.ts detail a7dc07c6785bcc7c --format plain
```

## Experience evidence

`--experience-target 8` is local analysis, **not a native numeric filter** and
not a claim that the candidate has exactly eight years. For search it fetches
one full description per capped result, sequentially, and orders confirmed
matches first without hiding uncertain or below-target cases. Reduce `--limit`
to keep requests low. Any failed detail makes the operation fail explicitly.

Detail output includes the actual minimum, maximum (null for no stated upper
bound), original experience clause and scope (`overall`, `technology`, or
`unspecified`). Overall requirements starting at the target or higher are
`confirmed`; a 10+ requirement remains 10+, not eight. Ranges overlapping the
target, conflicting clauses, technology-only experience, unspecified scope,
missing requirements and requirements below the target have separate labels.
This conservative heuristic can miss wording; read the preserved description
before scoring fit. Do not score technology years as overall career experience.

## Output and workflow handoff

| Format | Use |
| --- | --- |
| `json` | Search `{meta: {count, page, skipped}, results: [...]}`; detail is one object. |
| `table` | Human scanning, including experience evidence when requested. |
| `plain` | Readable posting text. |

Each search result includes `id`, `title`, `company`, `location`, `date`, and
canonical `url`; unavailable values are null. Errors are stderr JSON
`{error, code}`, exit 1, with no successful empty output on blocked/changed pages.
`meta.skipped` counts malformed cards; all-invalid cards fail. An explicit empty
results array is a successful empty search.

The existing `/scrape` discovery and `/rank`/`/apply` detail routing discover this
skill automatically. Use the canonical returned URLs for deduplication. `/apply`
prepares application materials; it does not submit applications.

## Notes

- Absolute card `pubDate` timestamps become ISO dates. Relative ages such as
  "30+ days ago" are never converted into invented dates. Detail uses a matching
  card's date when available, otherwise null.
- A requested ID must match the selected response body's `jobKey`. The first
  card's `autoOpenTwoPaneJobKey` can differ and is never trusted as the detail ID.
- `isActive: false` / `status: closed` require the source's explicit
  `isJobExpired: true`. Otherwise `isActive` is null and status is unknown;
  missing content or a challenge does not establish expiration.
- Search pagination is limited to offsets allowed by the current robots policy.
  Default retries: three for 429/5xx, jittered backoff, 15-second attempt timeout.
  A server cooldown over eight seconds stops with a retry-later error.
- No paid provider or partner credentials are used. The official partner API
  would require a separate access/onboarding decision, not a silent fallback.
