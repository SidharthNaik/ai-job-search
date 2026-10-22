#!/usr/bin/env bun
import { runSearch } from "./commands/search.js"
import { runDetail } from "./commands/detail.js"
import { PortalError, writeError } from "./helpers.js"

const HELP = `indeed-cli — Indeed India search and full posting detail

USAGE
  bun run src/cli.ts search --country IN --location India -q "Software Engineer" [flags]
  bun run src/cli.ts detail <id|url> [--country IN] [flags]

FLAGS
  --country <code>          IN only; required for search, default IN for detail.
  --location, -l <text>     Required for search; India, Bengaluru, Hyderabad, etc.
  --query, -q <text>        Required for search; include Senior, Lead or Staff variants.
  --page <n>               Search page 1–10 (offsets 0–90); default 1.
  --limit, -n <n>          Search cap 1–25, before detail enrichment; default 5.
  --experience-target <n>  Local description analysis for a target minimum (1–50).
                          Search: fetch each capped result's full description, rank
                          confirmed matches first; keep uncertain/below-target cases.
                          Detail: default 8. This is NOT a native Indeed filter.
  --format <fmt>           json (default) | table | plain.
  --help, -h               Show help.

Recency (--jobage) and workplace (--remote) filters are unsupported; no flag
is silently ignored. Dates remain null unless the source supplies an absolute
timestamp. Public /jobs route only, no login, partner API, or paid service.
Personal use only; keep volume low and obey current robots.txt and terms.
`

export function parseArgs(argv: string[]) {
  const command = argv[0]
  if (!command || ["--help", "-h"].includes(command)) return null
  if (!["search", "detail"].includes(command)) throw new PortalError(`Unknown command: ${command}`, "BAD_CMD")
  const flags: Record<string, string> = {}
  const positional: string[] = []
  const aliases: Record<string, string> = { q: "query", l: "location", n: "limit", h: "help" }
  const allowed = new Set(command === "search" ?
    ["country", "location", "query", "page", "limit", "experience-target", "format"] :
    ["country", "experience-target", "format"])
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("-")) { positional.push(arg); continue }
    const parts = arg.replace(/^-+/, "").split("=")
    const key = aliases[parts[0]] ?? parts[0]
    if (key === "help") return null
    if (!allowed.has(key)) throw new PortalError(`Unsupported flag --${key}; see --help`, "UNKNOWN_FLAG")
    if (key in flags) throw new PortalError(`Duplicate flag --${key}`, "BAD_ARG")
    const value = parts.length > 1 ? parts.slice(1).join("=") : argv[++i]
    if (!value?.trim() || value.startsWith("-")) throw new PortalError(`--${key} requires a value`, "BAD_ARG")
    flags[key] = value.trim()
  }
  const format = flags.format ?? "json"
  if (!["json", "table", "plain"].includes(format)) throw new PortalError("--format must be json|table|plain", "BAD_ARG")
  if ((flags.country ?? (command === "detail" ? "IN" : "")) !== "IN") throw new PortalError("--country IN is required; only India is supported", "BAD_ARG")
  const integer = (name: string, fallback: number, max: number) => {
    const value = flags[name] === undefined ? fallback : Number(flags[name])
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new PortalError(`--${name} must be a whole number between 1 and ${max}`, "BAD_ARG")
    return value
  }
  if (command === "search") {
    if (positional.length) throw new PortalError("search does not accept positional arguments", "BAD_ARG")
    if (!flags.location || !flags.query) throw new PortalError("search requires --query/-q and --location/-l", "BAD_ARG")
    return { command, query: flags.query, location: flags.location, page: integer("page", 1, 10), limit: integer("limit", 5, 25),
      experienceTarget: flags["experience-target"] === undefined ? undefined : integer("experience-target", 8, 50), format: format as "json" | "table" | "plain" }
  }
  if (positional.length !== 1) throw new PortalError("detail requires one <id|url>", "NO_ID")
  return { command, id: positional[0], experienceTarget: integer("experience-target", 8, 50), format: format as "json" | "table" | "plain" }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseArgs(argv)
    if (!args) { process.stdout.write(HELP); return 0 }
    if (args.command === "search") return await runSearch(args as Parameters<typeof runSearch>[0])
    return await runDetail(args as Parameters<typeof runDetail>[0])
  } catch (error) { writeError(error); return 1 }
}

if (import.meta.main) process.exit(await main())
