# Indeed India: observed source contract

Observed **22 October 2026** from the updated managed runtime with inherited
proxy/CA settings and `Mozilla/5.0 (compatible; indeed-cli/1.0)`. No cookies,
login, browser impersonation or paid service was needed.

## Access and endpoints

- Policy: `https://in.indeed.com/robots.txt` (HTTP 200).
- Terms: `https://in.indeed.com/legal?hl=en&co=IN` (HTTP 200). Terms condition
  automated crawling on robots.txt; no commercial/bulk use is intended.
- Search: `https://in.indeed.com/jobs?q=Software+Engineer&l=India` (HTTP 200).
- Pagination: `https://in.indeed.com/jobs?q=Software+Engineer&l=India&start=10&`
  (HTTP 200, model `pageNumber: 2`). Captures contained 15 cards even though the
  native next-link increment is 10. Do not infer page size from card count.
- Full detail: public search page's selected pane,
  `https://in.indeed.com/jobs?q=Software+Engineer&l=India&vjk=a7dc07c6785bcc7c`.
  The `q` and `l` search context is necessary: `/jobs?vjk=...` alone returned a
  page without a selected-posting response. The adapter always supplies context.
- Canonical identity link: `https://in.indeed.com/viewjob?jk=<16-hex-id>`.
  This is an output/deduplication URL only; the CLI does **not fetch it**.

The custom tool matches `User-agent: *`. That group permits `/jobs`, but
disallows `/viewjob`, `/rc/`, `/pagead/`, `/graphql`, and generic `&start=`.
Specific longer allow rules permit `&start=0&` through `&start=90&` in increments
of ten. Preserve the trailing ampersand and limit pages to 1–10. Recognized
retrieval-agent groups have different rules; never claim their identity for
this CLI. The CLI checks current policy before pages and redirects, so a policy
change stops access instead of using this snapshot as permanent permission.

| Parameter | Verified meaning |
| --- | --- |
| `q` | Keywords; broad Software Engineer plus Senior/Lead/Staff variants. |
| `l` | Location string; India-wide search tested. |
| `start` | Offset 10 for page 2 tested; remaining allowed offsets use same pattern. |
| `vjk` | Selects a posting's full embedded detail by job key. |

No native numeric experience filter, recency filter or workplace filter has
been validated. Those flags are not guessed or passed through.

## Search response

Read (never execute) the JSON object assigned to
`window.mosaic.providerData["mosaic-provider-jobcards"]`.
Cards live in `metaData.mosaicProviderJobCardsModel.results`:

| Source | Portal field |
| --- | --- |
| `jobkey` | `id`, 16 hexadecimal characters |
| `title` | `title` |
| `company` | `company` |
| `formattedLocation` | `location` |
| `pubDate` | `date`, epoch milliseconds converted to ISO |
| constructed from `jobkey` | canonical `url`, strips all tracking variants |

Missing optional fields become null; invalid IDs are counted and skipped per
card. Missing assignment/array, truncated JSON and all-invalid cards fail
explicitly. Only a recognized results array containing zero cards is empty.

## Selected detail response

Read the JSON object assigned to `window._initialData`:

```
autoOpenTwoPaneViewjobResponse.body
  jobKey, jobCountry, jobTitle, jobLocation
  jobInfoWrapperModel.jobInfoModel
    sanitizedJobDescription
    jobInfoHeaderModel.{companyName, formattedLocation, jobTitle}
    structuredDataJobSummaryModel.{salary, jobTypeAndShiftSectionApp.jobType}
    jobDescriptionSectionModel.jobDetailsSection.isJobExpired
```

Check **body.jobKey** against the requested ID; `autoOpenTwoPaneJobKey` remained
the first card's ID even while the body correctly described another selected
posting. A mismatch is `DETAIL_UNAVAILABLE`, never another successful job or
proof of closure. Missing description is `MARKUP_CHANGED`. `datePublished` was
null in observed detail bodies; only a matching card supplies a verified date.

The observed American Express Senior Software Engineer II posting
`a7dc07c6785bcc7c` explicitly stated "10+ years of software engineering
experience". This supports an 8+ target with an actual minimum of ten.
Senior titles alone were insufficient: the Infios Team Lead description asked
for five years. Search snippets are not used as full-description evidence.

## Fixtures and maintenance

`cli/tests/fixtures/` contains reduced actual response captures, preserving
the real JSON assignments and field nesting. Each HTML fixture names its source
URL and capture date. All cookies, CSRF/session identifiers, advertising and
unrelated scripts were removed. `robots.txt` is the policy captured on the same
date. Synthetic malformed/empty/challenge variations live in tests, not as
misrepresented live captures. Routine CI makes no network requests.
