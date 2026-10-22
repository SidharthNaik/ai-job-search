import { expect, test } from "bun:test"
import { parseJSON, runCLI, ID, fixture, cardsHTML, detailHTML } from "./helpers.js"
import { search } from "../src/commands/search.js"

const base=["search","--country","IN","-l","India","-q","Software Engineer"]
test("CLI search JSON follows portal output contract, client cap and page", async () => {
  const out=await runCLI([...base,"--limit","2","--page","2"])
  const data=parseJSON<{meta:{count:number,page:number},results:Record<string,unknown>[]}>(out)
  expect(out.stderr).toBe("")
  expect(data.meta).toMatchObject({count:2,page:2})
  for(const result of data.results) for(const key of ["id","title","company","location","date","url"])expect(key in result).toBeTrue()
})
test("CLI full detail works for raw IDs and canonical tracking URLs", async () => {
  for(const value of [ID,`https://in.indeed.com/viewjob?jk=${ID}&from=tracking`]) {
    const out=await runCLI(["detail",value])
    const data=parseJSON<{id:string,description:string}>(out)
    expect(data.id).toBe(ID)
    expect(data.description).toContain("10+ years")
  }
})
test("plain/table detail and search render readable source text", async () => {
  for(const format of ["table","plain"]) {
    expect((await runCLI([...base,"--format",format])).stdout).toContain("Porch")
    expect((await runCLI(["detail",ID,"--format",format])).stdout).toContain("10+ years")
  }
})
test.each([
  ["search"], [...base,"--country","US"], [...base,"--remote","remote"], [...base,"--jobage","14"],
  [...base,"--page","0"], [...base,"--page","11"], [...base,"--limit","0.5"], [...base,"--limit","26"],
  [...base,"--limit"], [...base,"--query="], [...base,"--format","yaml"], [...base,"--experience-target","NaN"],
  [...base,"--experience-target","0"], [...base,"unexpected"], ["detail"], ["detail","bad-id"],
  ["detail",ID,"--query","ignored"], ["detail",ID,"extra"], ["bogus"],
])("invalid arguments fail with stderr JSON: %j", async (...args:string[]) => {
  const out=await runCLI(args)
  expect(out.exitCode).toBe(1)
  expect(out.stdout).toBe("")
  expect(JSON.parse(out.stderr)).toMatchObject({error:expect.any(String),code:expect.any(String)})
})
test("blocked/changed/missing pages cannot become successful empty output", async () => {
  for(const scenario of ["blocked","changed"]) {
    const out=await runCLI(base,scenario)
    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe("")
    expect(JSON.parse(out.stderr).code).toBe(scenario==="blocked"?"ACCESS_BLOCKED":"MARKUP_CHANGED")
  }
  const missing=await runCLI(["detail",ID],"notfound")
  expect(JSON.parse(missing.stderr).code).toBe("NOT_FOUND")
  const empty=parseJSON<{meta:{count:number},results:unknown[]}>(await runCLI(base,"empty"))
  expect(empty.meta.count).toBe(0)
  expect(empty.results).toEqual([])
})
test("local experience analysis fetches only capped descriptions and retains uncertain cases", async () => {
  const second="0000000000000001", third="0000000000000002"
  const calls:string[]=[]
  const output=await search({query:"Software Engineer",location:"India",page:1,limit:2,format:"json",experienceTarget:8},async url=>{
    calls.push(url)
    if(!url.includes("vjk="))return cardsHTML([{jobkey:second},{jobkey:ID},{jobkey:third}])
    return url.includes(ID)?await fixture("selected-query-detail.html"):detailHTML("5–8 years of professional experience",{},second)
  })
  expect(output.meta.localAnalysis).toBeTrue()
  expect(output.results.map(r=>r.id)).toEqual([ID,second])
  expect(calls.length).toBe(3)
  expect(calls.some(c=>c.includes(third))).toBeFalse()
})
