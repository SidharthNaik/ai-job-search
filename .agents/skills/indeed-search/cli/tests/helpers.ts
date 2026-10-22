import { join } from "path"
export const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", name)).text()
export const ID = "a7dc07c6785bcc7c"

export interface CLIResult { stdout: string, stderr: string, exitCode: number }
export async function runCLI(args: string[], scenario = "success"): Promise<CLIResult> {
  const proc = Bun.spawn([process.execPath, "run", "--preload", join(import.meta.dir, "preload.ts"), join(import.meta.dir, "../src/cli.ts"), ...args], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, INDEED_TEST_SCENARIO: scenario },
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
export function parseJSON<T = unknown>(result: CLIResult): T {
  if (result.exitCode !== 0) throw new Error(`CLI exited ${result.exitCode}: ${result.stderr}`)
  return JSON.parse(result.stdout) as T
}

export function cardsHTML(results: unknown[]) {
  return `<script>window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify({metaData:{mosaicProviderJobCardsModel:{results}}})};</script>`
}
export function detailHTML(description: string, extra: Record<string, unknown> = {}, id = ID) {
  return `<script>window._initialData=${JSON.stringify({autoOpenTwoPaneViewjobResponse:{status:"success",body:{
    jobKey:id, jobCountry:"IN", jobTitle:"Staff Engineer", ...extra,
    jobInfoWrapperModel:{jobInfoModel:{sanitizedJobDescription:description,...(extra.jobInfo as object ?? {})}},
  }}})};</script>`
}

export const fakeFetch = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  fn as unknown as typeof fetch
