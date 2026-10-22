import { describe, expect, test } from "bun:test"
import { canonicalUrl, normalizeId, searchUrl, detailUrl, parseSearch, parseDetail, readableText, robotsAllows } from "../src/helpers.js"
import { fixture, ID, cardsHTML, detailHTML } from "./helpers.js"

describe("observed response parsing", () => {
  test("real cards honor the portal contract and absolute source dates", async () => {
    const parsed = parseSearch(await fixture("senior-search.html"))
    expect(parsed.results.length).toBe(15)
    const job = parsed.results.find(card => card.id === ID)!
    expect(job.company).toBe("American Express")
    expect(job.title).toBe("Senior Software Engineer II")
    expect(job.date).toBe(new Date(1791954000000).toISOString())
    expect(job.url).toBe(canonicalUrl(ID))
  })
  test("malformed cards do not destroy valid international cards; optional fields are null", () => {
    const parsed = parseSearch(cardsHTML([null, {jobkey:"oops"}, {jobkey:ID,title:"वरिष्ठ अभियंता &amp; Développeur &#x1F600;"}, {jobkey:ID.toUpperCase()}]))
    expect(parsed.skipped).toBe(2)
    expect(parsed.results).toEqual([{id:ID,title:"वरिष्ठ अभियंता & Développeur 😀",company:null,location:null,date:null,url:canonicalUrl(ID)}])
  })
  test("missing title remains null; invalid timestamps do not invent a date", () => {
    expect(parseSearch(cardsHTML([{jobkey:ID,pubDate:0}])).results[0].date).toBeNull()
    expect(parseSearch(cardsHTML([{jobkey:ID,pubDate:"yesterday"}])).results[0].title).toBeNull()
  })
  test("explicit empty differs from changed, malformed and all-invalid responses", () => {
    expect(parseSearch(cardsHTML([])).results).toEqual([])
    for (const html of ["<html>changed</html>",cardsHTML([]).replace('"results":[]','"cards":[]'), 'window.mosaic.providerData["mosaic-provider-jobcards"]={"broken":', cardsHTML([{}])]) {
      expect(() => parseSearch(html)).toThrow()
    }
  })
  test("page two capture contains different IDs", async () => {
    const first = parseSearch(await fixture("search.html"))
    const second = parseSearch(await fixture("page2.html"))
    expect(first.results[0].id).not.toBe(second.results[0].id)
  })
  test("selected detail uses body ID, not first card's auto-open ID", async () => {
    const job = parseDetail(await fixture("selected-query-detail.html"),ID)
    expect(job.title).toBe("Senior Software Engineer II")
    expect(job.company).toBe("American Express")
    expect(job.description).toContain("10+ years of software engineering experience")
    expect(job.description).not.toContain("<p>")
    expect(job.employmentType).toBeTruthy()
    expect(job.experience.classification).toBe("confirmed")
    expect(job.experience.evidence[0].minimum).toBe(10)
    expect(job.isActive).toBeNull()
  })
  test("wrong ID, missing description and other-country jobs fail", async () => {
    const html = await fixture("selected-query-detail.html")
    expect(() => parseDetail(html,"0000000000000000")).toThrow("Requested posting")
    expect(() => parseDetail(detailHTML(""),ID)).toThrow("description")
    expect(() => parseDetail(detailHTML("8+ years of professional experience",{jobCountry:"US"}),ID)).toThrow("outside India")
  })
  test("only explicit source expiration is closed, and missing dates remain null", () => {
    const html = detailHTML("No longer accepting applications is text quoted by a recruiter.")
    expect(parseDetail(html,ID).isActive).toBeNull()
    expect(parseDetail(html,ID).date).toBeNull()
    const expired = detailHTML("Posting text",{jobInfo:{jobDescriptionSectionModel:{jobDetailsSection:{isJobExpired:true}}}})
    expect(parseDetail(expired,ID).isActive).toBeFalse()
    expect(parseDetail(expired,ID).status).toBe("closed")
  })
  test("JSON scanner handles braces and escaped quotes without executing scripts", () => {
    const description = '8+ years of professional experience. Text {x} "quoted" \\ path.'
    expect(parseDetail(detailHTML(description),ID).description).toBe(description)
    expect(readableText('<script>evil()</script><p>A &lt; B &amp; C</p><p>नौकरी &#x1F600;</p>')).toBe("A < B & C\nनौकरी 😀")
  })
})

describe("URL identity and permitted routes", () => {
  test("normalizes supported tracking URLs to one ID/canonical URL", () => {
    for (const url of [ID,ID.toUpperCase(),`https://in.indeed.com/viewjob?jk=${ID}&from=tracking`,`https://www.indeed.com/rc/clk?jk=${ID}&bb=tracking`,detailUrl(ID)]) {
      expect(normalizeId(url)).toBe(ID)
      expect(canonicalUrl(normalizeId(url)!)).toBe(`https://in.indeed.com/viewjob?jk=${ID}`)
    }
  })
  test("rejects lookalikes, userinfo, ports, duplicate IDs and unsupported hosts", () => {
    for (const url of ["1234", "g".repeat(16),`https://in.indeed.com.evil.test/viewjob?jk=${ID}`,`https://in.indeed.com@evil.test/viewjob?jk=${ID}`,`https://user@in.indeed.com/viewjob?jk=${ID}`,`https://in.indeed.com:444/viewjob?jk=${ID}`,`https://uk.indeed.com/viewjob?jk=${ID}`,`https://in.indeed.com/evil?jk=${ID}`,`https://in.indeed.com/viewjob?jk=${ID}&jk=${ID}`,`https://in.indeed.com/viewjob?jk=${ID}&vjk=0000000000000000`,`ftp://in.indeed.com/viewjob?jk=${ID}`]) expect(normalizeId(url)).toBeNull()
  })
  test("uses verified ten-offset pagination and country robots rules", async () => {
    const robots = await fixture("robots.txt")
    expect(robotsAllows(robots,"/viewjob?jk="+ID)).toBeFalse()
    expect(robotsAllows(robots,new URL(detailUrl(ID)).pathname+new URL(detailUrl(ID)).search)).toBeTrue()
    for (let page=1;page<=10;page++) {
      const url = new URL(searchUrl("Software Engineer","India",page))
      expect(robotsAllows(robots,url.pathname+url.search)).toBeTrue()
      if(page>1) expect(url.searchParams.get("start")).toBe(String((page-1)*10))
    }
    expect(robotsAllows(robots,"/jobs?q=x&start=100&")).toBeFalse()
    expect(() => searchUrl("x","India",11)).toThrow()
  })
  test("custom bot rules and conservative ties override default allows", () => {
    expect(robotsAllows("User-agent: *\nAllow: /\n\nUser-agent: indeed-cli\nDisallow: /jobs", "/jobs?q=x")).toBeFalse()
    expect(robotsAllows("User-agent: *\nAllow: /jobs\nDisallow: /jobs", "/jobs")).toBeFalse()
  })
})
