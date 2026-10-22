// Only preloaded by subprocess tests. No network or production endpoint override.
import { fixture } from "./helpers.js"
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input))
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /jobs")
  const scenario = process.env.INDEED_TEST_SCENARIO
  if (scenario === "blocked") return new Response("Forbidden", {status:403})
  if (scenario === "changed") return new Response("<html>new layout</html>")
  if (scenario === "empty") return new Response('window.mosaic.providerData["mosaic-provider-jobcards"]={"metaData":{"mosaicProviderJobCardsModel":{"results":[]}}};')
  if (scenario === "notfound") return new Response("", {status:404})
  return new Response(await fixture(url.searchParams.has("vjk") ? "selected-query-detail.html" : "senior-search.html"))
}) as typeof fetch
