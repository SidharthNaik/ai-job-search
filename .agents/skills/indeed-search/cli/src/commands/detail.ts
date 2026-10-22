import { htmlFetch, normalizeId, detailUrl, parseDetail, PortalError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "table" | "plain"
  experienceTarget: number
}

export async function detail(opts: DetailOpts, fetchHtml = htmlFetch) {
  const id = normalizeId(opts.id)
  if (!id) throw new PortalError("Expected a 16-character Indeed ID or a supported Indeed posting URL", "BAD_ID")
  const html = await fetchHtml(detailUrl(id))
  if (!html) throw new PortalError("Job not found", "NOT_FOUND")
  return parseDetail(html, id, opts.experienceTarget)
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const job = await detail(opts)
  if (opts.format === "json") process.stdout.write(JSON.stringify(job, null, 2) + "\n")
  else process.stdout.write([
    job.title ?? "—", `${job.company ?? "—"} · ${job.location ?? "—"}`,
    `Date: ${job.date ?? "unknown"}`, `Employment: ${job.employmentType ?? "unknown"}`,
    `Salary: ${job.salary ?? "unknown"}`, `Status: ${job.status}`,
    `Experience (${job.experience.target}+ target, local analysis): ${job.experience.classification}`,
    ...job.experience.evidence.map(e => `  ${e.minimum}${e.maximum === null ? "+" : `–${e.maximum}`} years [${e.scope}]: ${e.text}`),
    "", job.description, "", `URL: ${job.url}`,
  ].join("\n") + "\n")
  return 0
}
