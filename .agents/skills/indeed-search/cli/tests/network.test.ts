import { describe, expect, test } from "bun:test"
import { BASE_URL, USER_AGENT, createClient, searchUrl, detailUrl } from "../src/helpers.js"
import { fakeFetch, ID } from "./helpers.js"

const robots = "User-agent: *\nAllow: /jobs\nDisallow: /viewjob"
const page = searchUrl("Software Engineer","India")
describe("bounded requests", () => {
  test("checks robots once per client, preserves honest identity and timeout", async () => {
    const calls: string[]=[]
    const client=createClient({fetchImpl:fakeFetch((url,init)=>{
      calls.push(url)
      expect(new Headers(init?.headers).get("User-Agent")).toBe(USER_AGENT)
      expect(init?.redirect).toBe("manual")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(url.endsWith("robots.txt") ? robots : "posting")
    })})
    expect(await client(page)).toBe("posting")
    await client(detailUrl(ID))
    expect(calls.filter(c=>c.endsWith("robots.txt")).length).toBe(1)
    expect(calls.some(c=>new URL(c).pathname==="/viewjob")).toBeFalse()
  })
  test("denied policy and unreadable policy never fetch pages", async () => {
    for (const policy of ["User-agent: *\nDisallow: /", "<html>policy blocked</html>", ""]) {
      const calls:string[]=[]
      const client=createClient({fetchImpl:fakeFetch(url=>{calls.push(url);return new Response(policy)})})
      await expect(client(page)).rejects.toThrow()
      expect(calls).toEqual([BASE_URL+"/robots.txt"])
    }
  })
  test("429/5xx retry with bounded backoff and then succeed", async () => {
    const delays:number[]=[]
    let pages=0
    const client=createClient({random:()=>0,sleep:async ms=>{delays.push(ms)},fetchImpl:fakeFetch(url=>{
      if(url.endsWith("robots.txt"))return new Response(robots)
      pages++
      return pages===1 ? new Response("limited",{status:429}) : pages===2 ? new Response("bad gateway",{status:502}) : new Response("ok")
    })})
    expect(await client(page)).toBe("ok")
    expect(delays).toEqual([500,1000])
    expect(pages).toBe(3)
  })
  test("persistent rate limits and server errors exhaust configured retries", async () => {
    for(const status of [429,503]) {
      let pages=0
      const client=createClient({sleep:async()=>{},fetchImpl:fakeFetch(url=>{
        if(url.endsWith("robots.txt"))return new Response(robots)
        pages++;return new Response("retry",{status})
      })})
      await expect(client(page)).rejects.toMatchObject({code:status===429?"RATE_LIMITED":"HTTP_ERROR"})
      expect(pages).toBe(4)
    }
  })
  test("long Retry-After stops instead of retrying early", async () => {
    const client=createClient({sleep:async()=>{throw new Error("must not sleep")},fetchImpl:fakeFetch(url=>
      new Response(url.endsWith("robots.txt")?robots:"retry",url.endsWith("robots.txt")?{}:{status:429,headers:{"Retry-After":"120"}}))})
    await expect(client(page)).rejects.toMatchObject({code:"RATE_LIMITED"})
  })
  test("timeouts and network failures are explicit", async () => {
    for(const [error,code] of [[new DOMException("timed out","TimeoutError"),"TIMEOUT"],[new TypeError("fetch failed"),"NETWORK_ERROR"]] as const) {
      const client=createClient({fetchImpl:fakeFetch(()=>{throw error})})
      await expect(client(page)).rejects.toMatchObject({code})
    }
  })
  test("the configured timeout aborts a pending request", async () => {
    const client=createClient({timeoutMs:10,fetchImpl:fakeFetch((_url,init)=>new Promise((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true})
    }))})
    await expect(client(page)).rejects.toMatchObject({code:"TIMEOUT"})
  })
  test("404 returns missing content, 403/challenges fail without retry", async () => {
    for(const [body,status,code] of [["",404,null],["Forbidden",403,"ACCESS_BLOCKED"],["<title>Just a moment...</title>",200,"ACCESS_BLOCKED"],["<title>Sign In - Indeed</title>",200,"ACCESS_BLOCKED"]] as const) {
      let pages=0
      const client=createClient({fetchImpl:fakeFetch(url=>{
        if(url.endsWith("robots.txt"))return new Response(robots)
        pages++;return new Response(body,{status})
      })})
      if(code)await expect(client(page)).rejects.toMatchObject({code})
      else expect(await client(page)).toBe("")
      expect(pages).toBe(1)
    }
  })
  test("unsafe redirects stop before accessing target", async () => {
    for(const location of ["https://evil.test/jobs", "/viewjob?jk="+ID, "https://secure.indeed.com/account/login"]) {
      const calls:string[]=[]
      const client=createClient({fetchImpl:fakeFetch(url=>{
        calls.push(url)
        return url.endsWith("robots.txt")?new Response(robots):new Response(null,{status:302,headers:{location}})
      })})
      await expect(client(page)).rejects.toMatchObject({code:"UNSAFE_REDIRECT"})
      expect(calls.length).toBe(2)
    }
  })
  test("safe redirects are checked against policy again", async () => {
    let pages=0
    const client=createClient({fetchImpl:fakeFetch(url=>{
      if(url.endsWith("robots.txt"))return new Response(robots+"\nDisallow: /*denied")
      pages++;return new Response(null,{status:302,headers:{location:"/jobs?denied"}})
    })})
    await expect(client(page)).rejects.toMatchObject({code:"ROBOTS_DISALLOWED"})
    expect(pages).toBe(1)
  })
})
