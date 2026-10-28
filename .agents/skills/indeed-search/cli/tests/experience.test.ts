import { expect, test } from "bun:test"
import { matchExperience } from "../src/helpers.js"

test.each([
  ["8+ years of professional software development experience", "confirmed", 8, null, "overall"],
  ["8–12 years of professional experience", "confirmed", 8, 12, "overall"],
  ["8-12 years in software development", "confirmed", 8, 12, "overall"],
  ["8 to 12 years of industry experience", "confirmed", 8, 12, "overall"],
  ["10+ years of software engineering experience", "confirmed", 10, null, "overall"],
  ["5–8 years of professional experience", "overlapping", 5, 8, "overall"],
  ["6-8+ years of software engineering experience", "overlapping", 6, null, "overall"],
  ["3–5 years of professional experience", "below_target", 3, 5, "overall"],
  ["8+ years of experience with Java", "technology_only", 8, null, "technology"],
  ["8+ years of professional experience with Java", "technology_only", 8, null, "technology"],
  ["8+ years in Java development", "technology_only", 8, null, "technology"],
  ["8+ years of C# experience", "technology_only", 8, null, "technology"],
  ["Experience: 8–12 years", "uncertain", 8, 12, "unspecified"],
] as const)("%s → %s", (description, classification, minimum, maximum, scope) => {
  const match = matchExperience(description)
  expect(match.classification).toBe(classification)
  expect(match.evidence[0]).toEqual({text:description,minimum,maximum,scope})
})

test("conflicting clauses remain visible even when one scope is unspecified", () => {
  for (const text of [
    "8+ years of professional experience. Qualifications: 5–8 years of professional experience.",
    "8+ years of software development experience\n5–8 years of experience",
  ]) {
    const result = matchExperience(text)
    expect(result.classification).toBe("conflicting")
    expect(result.evidence.length).toBe(2)
  }
})
test("overall and technology requirements are separate, not conflicting", () => {
  const result=matchExperience("8+ years of professional software development experience. 3+ years of experience with Python.")
  expect(result.classification).toBe("confirmed")
  expect(result.evidence.map(e=>e.scope)).toEqual(["overall","technology"])
})
test.each([
  "Java 8, salary ₹80,00,000, leading a team of 12.",
  "Our company is 12 years old. Work with Java 8.",
  "Our founders have a combined experience of 18 years.",
  "Team size: 8. Experience with software development preferred.",
  "Graduated in 2018; work with Java 8 and SQL Server 2012.",
  "A 12-year-old business with 8 engineers.",
  "20+ years in business. Programming experience is welcome.",
  "Develop software and learn quickly.",
])("unrelated numbers/missing requirement: %s", text => {
  expect(matchExperience(text).classification).toBe("missing")
})
test("preserves actual minimum instead of treating target as candidate years", () => {
  const result = matchExperience("12+ years of software engineering experience",8)
  expect(result.target).toBe(8)
  expect(result.evidence[0].minimum).toBe(12)
})
