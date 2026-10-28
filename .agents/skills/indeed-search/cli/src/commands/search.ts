import { htmlFetch, parseSearch, parseDetail, detailUrl, searchUrl, type JobCard, type JobDetail } from "../helpers.js"

export interface SearchOpts {
  query: string
  location: string
  page: number
  limit: number
  format: "json" | "table" | "plain"
  experienceTarget?: number
}

export async function search(opts: SearchOpts, fetchHtml = htmlFetch) {
  const parsed = parseSearch(await fetchHtml(searchUrl(opts.query, opts.location, opts.page)))
  let results: (JobCard | JobDetail)[] = parsed.results.slice(0, opts.limit)
  if (opts.experienceTarget !== undefined) {
    // Sequential, bounded by --limit, one full-description request per card.
    // Any failed detail fails the operation instead of silently excluding it.
    const enriched: JobDetail[] = []
    for (const card of results) {
      const detail = parseDetail(await fetchHtml(detailUrl(card.id)), card.id, opts.experienceTarget)
      enriched.push({ ...detail, date: detail.date ?? card.date })
    }
    const priority = { confirmed: 0, conflicting: 1, overlapping: 2, uncertain: 3, technology_only: 4, missing: 5, below_target: 6 }
    results = enriched.sort((a, b) => priority[a.experience.classification] - priority[b.experience.classification])
  }
  return {
    meta: { count: results.length, page: opts.page, skipped: parsed.skipped,
      ...(opts.experienceTarget !== undefined ? { experienceTarget: opts.experienceTarget, experienceSource: "full_description", localAnalysis: true } : {}) },
    results,
  }
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  const output = await search(opts)
  if (opts.format === "json") process.stdout.write(JSON.stringify(output, null, 2) + "\n")
  else {
    const rows = output.results.map(job => {
      const evidence = "experience" in job ? `\n  Experience (${job.experience.target}+ target): ${job.experience.classification}\n` +
        job.experience.evidence.map(e => `    ${e.minimum}${e.maximum === null ? "+" : `–${e.maximum}`} years [${e.scope}]: ${e.text}`).join("\n") : ""
      return opts.format === "table" ?
        `${job.id}  ${(job.title ?? "—").padEnd(45)}  ${job.company ?? "—"}  ${job.location ?? "—"}  ${job.date ?? "—"}${evidence}` :
        `${job.title ?? "—"}\n  ${job.company ?? "—"} · ${job.location ?? "—"} · ${job.date ?? "—"}\n  ${job.url}${evidence}`
    })
    process.stdout.write((rows.length ? rows.join("\n\n") : "No results.") + "\n")
    if (output.meta.skipped) process.stderr.write(`Skipped ${output.meta.skipped} malformed cards (see meta.skipped in JSON).\n`)
  }
  return 0
}
