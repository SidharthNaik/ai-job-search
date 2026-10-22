// Observed 2026-10-22: public /jobs HTML contains JSON assignments for cards
// and the selected posting. Never execute page scripts or fetch /viewjob.
export const BASE_URL = "https://in.indeed.com"
// Include accepted share-link origins for the repository's dynamic host discovery.
const POSTING_HOSTS = [BASE_URL, "https://www.indeed.com", "https://indeed.com"]
  .map(origin => new URL(origin).hostname)
export const USER_AGENT = "Mozilla/5.0 (compatible; indeed-cli/1.0)"

export class PortalError extends Error {
  constructor(message: string, public code: string) { super(message) }
}

export function writeError(error: unknown): void {
  process.stderr.write(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    code: error instanceof PortalError ? error.code : "INTERNAL_ERROR",
  }) + "\n")
}

export interface JobCard {
  id: string
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string
}

export function normalizeId(input: string): string | null {
  const value = input.trim()
  if (/^[a-f\d]{16}$/i.test(value)) return value.toLowerCase()
  try {
    const url = new URL(value)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null
    if (!POSTING_HOSTS.includes(url.hostname)) return null
    const key = url.pathname === "/jobs" ? "vjk" :
      ["/viewjob", "/m/viewjob", "/rc/clk", "/pagead/clk"].includes(url.pathname) ? "jk" : null
    if (!key || url.searchParams.getAll(key).length !== 1) return null
    const id = url.searchParams.get(key)!
    if (![...url.searchParams.getAll("jk"), ...url.searchParams.getAll("vjk")].every(v => v.toLowerCase() === id.toLowerCase())) return null
    return /^[a-f\d]{16}$/i.test(id) ? id.toLowerCase() : null
  } catch { return null }
}

export function canonicalUrl(id: string): string {
  if (!/^[a-f\d]{16}$/i.test(id)) throw new PortalError("Invalid Indeed job ID", "BAD_ID")
  return `${BASE_URL}/viewjob?jk=${id.toLowerCase()}`
}

export function searchUrl(query: string, location: string, page = 1): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10) {
    throw new PortalError("--page must be between 1 and 10 (robots.txt permits offsets 0–90)", "BAD_ARG")
  }
  const params = new URLSearchParams({ q: query, l: location })
  // The trailing & is significant: robots permits /*&start=10& etc., while
  // the generic /*&start= rule disallows other offsets/parameter forms.
  if (page > 1) return `${BASE_URL}/jobs?${params}&start=${(page - 1) * 10}&`
  return `${BASE_URL}/jobs?${params}`
}

export function detailUrl(id: string): string {
  canonicalUrl(id) // Validate before constructing a request.
  return `${searchUrl("Software Engineer", "India")}&vjk=${id.toLowerCase()}`
}

/** Match the custom tool's robots group, with wildcard paths and longest rule. */
export function robotsAllows(text: string, path: string): boolean {
  const groups: { agents: string[], rules: { allow: boolean, pattern: string }[] }[] = []
  let group: typeof groups[number] | undefined
  let hasRules = false
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*/, "").trim().match(/^([^:]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1].trim().toLowerCase(), value = match[2].trim()
    if (key === "user-agent") {
      if (!group || hasRules) {
        group = { agents: [], rules: [] }; groups.push(group); hasRules = false
      }
      group.agents.push(value.toLowerCase())
    } else if (group && ["allow", "disallow"].includes(key)) {
      hasRules = true
      if (value) group.rules.push({ allow: key === "allow", pattern: value })
    }
  }
  if (!groups.length) throw new PortalError("Unrecognized robots.txt; permission unconfirmed", "ROBOTS_UNAVAILABLE")
  const specificity = (agent: string) => agent === "*" ? 0 : "indeed-cli".includes(agent) ? agent.length : -1
  const best = Math.max(-1, ...groups.flatMap(g => g.agents.map(specificity)))
  let length = -1, allowed = true
  for (const g of groups.filter(g => g.agents.some(a => specificity(a) === best))) {
    for (const rule of g.rules) {
      const pattern = rule.pattern
      const end = pattern.endsWith("$")
      const source = (end ? pattern.slice(0, -1) : pattern).split("*")
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")
      if (!new RegExp(`^${source}${end ? "$" : ""}`).test(path)) continue
      const size = pattern.replace(/[*$]/g, "").length
      if (size > length || (size === length && !rule.allow)) { length = size; allowed = rule.allow }
    }
  }
  return allowed
}

interface ClientOptions {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  timeoutMs?: number
  retries?: number
}

export function createClient(options: ClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const retries = options.retries ?? 3
  let policy: Promise<string> | undefined

  async function request(input: string, resource: "robots" | "page"): Promise<string> {
    let url = new URL(input)
    let redirects = 0
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (url.origin !== BASE_URL || url.pathname !== (resource === "robots" ? "/robots.txt" : "/jobs")) {
        throw new PortalError("Redirect/request left the permitted Indeed India route", "UNSAFE_REDIRECT")
      }
      if (resource === "page") {
        const rules = await policy!
        if (!robotsAllows(rules, url.pathname + url.search)) throw new PortalError("robots.txt disallows this request", "ROBOTS_DISALLOWED")
      }
      try {
        const response = await fetchImpl(url.toString(), {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain", "Accept-Language": "en-IN,en;q=0.9" },
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          const location = response.headers.get("location")
          if (!location || ++redirects > 3) throw new PortalError("Too many or invalid redirects", "UNSAFE_REDIRECT")
          url = new URL(location, url); attempt--; continue
        }
        if (response.status === 429 || response.status >= 500) {
          await response.body?.cancel()
          if (attempt === retries) throw new PortalError(`Indeed returned HTTP ${response.status} after bounded retries`, response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR")
          const retry = response.headers.get("retry-after")
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN
          const dateDelay = retry && !Number.isFinite(seconds) ? Date.parse(retry) - Date.now() : NaN
          const retryMs = Number.isFinite(seconds) ? seconds * 1000 : dateDelay
          // Do not retry earlier than a long server-requested cooldown.
          if (retryMs > 8000) throw new PortalError("Indeed requests a longer cooldown; retry later", "RATE_LIMITED")
          await sleep(Math.max(Number.isFinite(retryMs) ? retryMs : 0, Math.min(500 * 2 ** attempt, 8000) + (options.random ?? Math.random)() * 250))
          continue
        }
        if (response.status === 404) {
          if (resource === "robots") return "User-agent: *\nAllow: /"
          return ""
        }
        if ([401, 403].includes(response.status)) throw new PortalError(`Indeed refused access (HTTP ${response.status}); do not bypass the challenge`, "ACCESS_BLOCKED")
        if (!response.ok) throw new PortalError(`Indeed returned HTTP ${response.status}`, "HTTP_ERROR")
        const body = await response.text()
        if (/<title[^>]*>\s*(?:Just a moment|Access Denied|Security Check|Sign [Ii]n)|id=["']challenge-form["']|cf-chl-/i.test(body)) {
          throw new PortalError("Indeed returned an access challenge", "ACCESS_BLOCKED")
        }
        if (resource === "robots" && /<\s*(?:html|!doctype)/i.test(body)) throw new PortalError("robots.txt returned HTML; permission unconfirmed", "ROBOTS_UNAVAILABLE")
        return body
      } catch (error) {
        if (error instanceof PortalError) throw error
        if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new PortalError("Indeed request timed out", "TIMEOUT")
        throw new PortalError("Could not reach Indeed through the configured network", "NETWORK_ERROR")
      }
    }
    throw new PortalError("Request retries exhausted", "HTTP_ERROR")
  }

  return async (url: string): Promise<string> => {
    policy ??= request(`${BASE_URL}/robots.txt`, "robots")
    await policy
    return request(url, "page")
  }
}

export const htmlFetch = createClient()

type Obj = Record<string, any>
function object(value: unknown): Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {}
}

/** Read a JSON object assignment without eval; braces in quoted text are safe. */
function assignment(html: string, anchor: RegExp): Obj {
  const match = anchor.exec(html)
  if (!match) throw new PortalError("Expected Indeed data assignment is missing", "MARKUP_CHANGED")
  const start = match.index + match[0].length
  let quoted = false, escaped = false, depth = 0
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) {
      try { return object(JSON.parse(html.slice(start, i + 1))) }
      catch { break }
    }
  }
  throw new PortalError("Indeed embedded JSON is malformed or truncated", "MARKUP_CHANGED")
}

export function readableText(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bull: "•", hellip: "…" }
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(?:p|li|div|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (full, name: string) => {
      if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? full
      const point = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ""
    })
    .split("\n").map(line => line.replace(/[\t \r\u00a0]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

function text(value: unknown): string | null { return typeof value === "string" ? readableText(value) || null : null }
function postedDate(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function parseSearch(html: string): { results: JobCard[], skipped: number } {
  const data = assignment(html, /window\.mosaic\.providerData\s*\[\s*["']mosaic-provider-jobcards["']\s*\]\s*=\s*(?=\{)/)
  const model = object(object(data.metaData).mosaicProviderJobCardsModel)
  if (!Array.isArray(model.results)) throw new PortalError("Indeed results array is missing", "MARKUP_CHANGED")
  const results: JobCard[] = [], seen = new Set<string>()
  let skipped = 0
  for (const raw of model.results) {
    const card = object(raw)
    const id = typeof card.jobkey === "string" ? normalizeId(card.jobkey) : null
    if (!id) { skipped++; continue }
    if (seen.has(id)) continue
    seen.add(id)
    results.push({
      id,
      title: text(card.title),
      company: text(card.company),
      location: text(card.formattedLocation),
      date: postedDate(card.pubDate),
      url: canonicalUrl(id),
    })
  }
  if (model.results.length && !results.length) throw new PortalError("No valid IDs in Indeed result cards", "PARSE_ERROR")
  return { results, skipped }
}

export interface ExperienceEvidence {
  text: string
  minimum: number
  maximum: number | null
  scope: "overall" | "technology" | "unspecified"
}
export interface ExperienceMatch {
  target: number
  classification: "confirmed" | "overlapping" | "conflicting" | "below_target" | "technology_only" | "uncertain" | "missing"
  evidence: ExperienceEvidence[]
}

/** Conservative local description analysis, never a native Indeed filter. */
export function matchExperience(description: string, target = 8): ExperienceMatch {
  const evidence: ExperienceEvidence[] = []
  // Sentence/line boundaries prevent a nearby salary, employer age or a Java
  // version from being joined to a requirement in a different sentence.
  const clauses = description.split(/\n|[;.!?](?:\s|$)/)
  const years = /\b(\d{1,2})(?:\s*[-–—]\s*(\d{1,2})|\s+to\s+(\d{1,2}))?\s*(\+)?\s*(?:years?|yrs?)\b/gi
  for (const raw of clauses) {
    const clause = raw.trim()
    for (const match of clause.matchAll(years)) {
      const minimum = Number(match[1]), maximum = (match[2] || match[3]) && !match[4] ? Number(match[2] || match[3]) : null
      if (minimum > 50 || (maximum !== null && (maximum < minimum || maximum > 50))) continue
      const index = match.index!
      const before = clause.slice(Math.max(0, index - 65), index)
      const after = clause.slice(index + match[0].length, index + match[0].length + 110)
      // Require an experience relation immediately around this years token.
      if (!/^\s*(?:of\s+)?(?:(?:overall|total|professional|relevant|commercial|hands-on|industry|work|software|engineering|development)\s+){0,5}experience\b/i.test(after)
        && !/\bexperience\s*(?::|of|with|in|minimum|at least|a minimum of|required|[-–])?\s*$/i.test(before)
        && !/^\s+(?:in|with|of)\s+(?:(?:professional|commercial|software|application|systems?|web)\s+){0,3}(?:development|engineering|programming)\b/i.test(after)
        && !/^\s+(?:in|with|of)\s+(?:Java\b|Python\b|C\+\+|C#|\.NET\b|React\b|Angular\b|AWS\b|SQL\b)/i.test(after)) continue
      const near = `${before} ${after}`
      if (/\b(?:combined|team|employer|company|founded|operating|in business)\b/i.test(near)) continue
      const technology = /\b(?:Java(?:Script)?|TypeScript|Python|React|Angular|Node\.?js|AWS|Azure|SQL|Kubernetes|Golang|Go)\b|C\+\+|C#|\.NET\b/i.test(near)
      const overall = /\b(?:overall|total|professional|commercial|industry|work|software (?:development|engineering)|application development)\b/i.test(near)
      const technologyRelation = /^\s*(?:of\s+)?(?:professional\s+)?experience\s+(?:in|with|using)\b/i.test(after)
        || /^\s+(?:of|in|with)\s+(?:Java\b|Python\b|C\+\+|C#|\.NET\b|React\b|Angular\b|AWS\b|SQL\b)/i.test(after)
      evidence.push({ text: clause, minimum, maximum, scope: technology && technologyRelation ? "technology" : overall ? "overall" : technology ? "technology" : "unspecified" })
    }
  }
  const overall = evidence.filter(e => e.scope === "overall")
  const relevant = evidence.filter(e => e.scope !== "technology")
  let classification: ExperienceMatch["classification"]
  if (!evidence.length) classification = "missing"
  else if (!relevant.length) classification = "technology_only"
  else if (relevant.some(e => e.minimum >= target) && relevant.some(e => e.minimum < target)) classification = "conflicting"
  else if (relevant.some(e => e.minimum >= target) && overall.length) classification = "confirmed"
  else if (relevant.some(e => e.minimum >= target)) classification = "uncertain"
  else if (relevant.some(e => e.maximum === null || e.maximum >= target)) classification = "overlapping"
  else classification = "below_target"
  return { target, classification, evidence }
}

export interface JobDetail extends JobCard {
  description: string
  employmentType: string | null
  salary: string | null
  isActive: false | null
  status: "closed" | "unknown"
  experience: ExperienceMatch
}

export function parseDetail(html: string, id: string, target = 8): JobDetail {
  const initial = assignment(html, /window\._initialData\s*=\s*(?=\{)/)
  const response = object(initial.autoOpenTwoPaneViewjobResponse)
  const body = object(response.body)
  // The first card's autoOpenTwoPaneJobKey can differ from the selected body.
  // Never return the default/first posting as though it were the requested one.
  if (typeof body.jobKey !== "string" || body.jobKey.toLowerCase() !== id.toLowerCase()) {
    throw new PortalError("Requested posting was not returned; it may be unavailable (not proof it is closed)", "DETAIL_UNAVAILABLE")
  }
  if (body.jobCountry && body.jobCountry !== "IN") throw new PortalError("Posting is outside India", "COUNTRY_MISMATCH")
  const info = object(object(body.jobInfoWrapperModel).jobInfoModel)
  const header = object(info.jobInfoHeaderModel)
  const description = text(info.sanitizedJobDescription)
  if (!description) throw new PortalError("Full posting description is missing", "MARKUP_CHANGED")
  const summary = object(info.structuredDataJobSummaryModel)
  const types = object(summary.jobTypeAndShiftSectionApp).jobType
  const expired = object(object(info.jobDescriptionSectionModel).jobDetailsSection).isJobExpired === true
  let date: string | null = null
  try { date = parseSearch(html).results.find(card => card.id === id.toLowerCase())?.date ?? null }
  catch (error) { if (!(error instanceof PortalError)) throw error }
  return {
    id: id.toLowerCase(),
    title: text(body.jobTitle) ?? text(header.jobTitle),
    company: text(header.companyName),
    location: text(header.formattedLocation) ?? text(body.jobLocation),
    date,
    url: canonicalUrl(id),
    description,
    employmentType: Array.isArray(types) ? types.map(text).filter(Boolean).join(", ") || null : null,
    salary: text(summary.salary) ?? text(object(body.salaryInfoModel).salaryText),
    isActive: expired ? false : null,
    status: expired ? "closed" : "unknown",
    experience: matchExperience(description, target),
  }
}
