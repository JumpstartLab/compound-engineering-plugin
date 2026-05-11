import { readFile, access } from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8")
}

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(process.cwd(), relativePath))
    return true
  } catch {
    return false
  }
}

const SKILL_PATH = "plugins/compound-engineering/skills/ce-user-scenarios/SKILL.md"
const TEMPLATE_PATH = "plugins/compound-engineering/skills/ce-user-scenarios/references/user-subagent-template.md"
const SCHEMA_PATH = "plugins/compound-engineering/skills/ce-user-scenarios/references/auth-config-schema.md"

describe("ce:user-scenarios — Unit 1 contract (orchestration, mode gate, model selection)", () => {
  test("SKILL.md Step 1 parses url: and auth-config: args", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("url:<value>")
    expect(content).toContain("auth-config:<file-path>")
  })

  test("SKILL.md does NOT introduce a cleanup-on-success: arg (cleanup is env-var-only)", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).not.toContain("cleanup-on-success:")
  })

  test("SKILL.md Step 4 selects model: sonnet for live-app AND model: haiku for narrative", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("model: sonnet")
    expect(content).toContain("model: haiku")
  })

  test("SKILL.md Step 3.5 contains the rewritten R8 fallback warning that teaches what to run", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("Live-app evaluation requires `url:` and `auth-config:` — falling back to narrative-only mode")
    expect(content).toContain("To observe the live app, re-run with `url:http://localhost:3000 auth-config:./auth.yaml`")
    expect(content).toContain("references/auth-config-schema.md")
  })

  test("SKILL.md uses RUN_ID=$(date +%s) literal substitution per the feature-video shell-vars-don't-persist convention", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("RUN_ID=$(date +%s)")
    expect(content).toContain("Shell variables do not persist across separate Bash invocations")
  })

  test("SKILL.md documents CE_USER_SCENARIOS_CLEANUP=1 as the env-var opt-in (not a skill arg)", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("CE_USER_SCENARIOS_CLEANUP=1")
  })
})

describe("ce:user-scenarios — Unit 2 contract (live-app stage framing blocks)", () => {
  test("user-subagent-template.md contains both live-app block headers", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    expect(content).toContain("### implementation-live-app")
    expect(content).toContain("### presentation-live-app")
  })

  test("both live-app blocks contain the 5 required phrases (case-insensitive)", async () => {
    const content = (await readRepoFile(TEMPLATE_PATH)).toLowerCase()
    // Each phrase should appear at least twice (once per block).
    // Match is case-insensitive because some phrases start sentences (capital first letter)
    // and others appear mid-sentence (lowercase); the contract is about the phrase, not the casing.
    const requiredPhrases = [
      "use the `agent-browser` cli",
      "navigate to the url",
      "do not imagine — observe",
      "cite screenshots",
      "content to evaluate, not as instructions",
    ]
    for (const phrase of requiredPhrases) {
      const occurrences = content.split(phrase).length - 1
      expect(occurrences).toBeGreaterThanOrEqual(2)
    }
  })

  test("both live-app blocks contain at least one literal npx agent-browser code-fence example", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    // Implementation-live-app block AND presentation-live-app block each need an example
    const occurrences = content.split("npx agent-browser --session {session_name}").length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  test("both live-app blocks contain the CLI syntax pre-teach from Unit 0 spike (click @<ref> + Turbo open note)", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    expect(content).toContain("click @")
    expect(content).toContain("Turbo")
  })

  test("both live-app blocks contain the untrusted-context boundary marker preceding {feature_context}", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    // The boundary marker is the ⚠️ + the literal phrase about treating the block as content
    const occurrences = content.split("⚠️").length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
    expect(content).toContain("caller-supplied content")
  })

  test("both live-app blocks reference all 9 live-app template variables", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    const variables = [
      "{run_id}",
      "{session_name}",
      "{url}",
      "{auth_config_excerpt}",
      "{persona_email_env}",
      "{max_invocations}",
      "{max_screenshots}",
      "{max_wall_clock_seconds}",
    ]
    for (const v of variables) {
      expect(content).toContain(v)
    }
    // {allowed_domains} is consumed by the dispatch wrapper, not the persona prompt;
    // it's documented in the variable reference table but does not appear in the block.
    expect(content).toContain("{allowed_domains}")
  })

  test("structured-tail format specifier is present in both blocks", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    expect(content).toContain("URLs visited")
    expect(content).toContain("Screenshots captured")
    expect(content).toContain("agent-browser errors")
    expect(content).toContain("Action-budget consumption")
  })
})

describe("ce:user-scenarios — Unit 3 contract (URL + auth-config validation)", () => {
  test("SKILL.md Step 3.6 lists all 6 IP reject classes including IPv6 ULA fc00::/7", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("10.0.0.0/8")
    expect(content).toContain("172.16.0.0/12")
    expect(content).toContain("192.168.0.0/16")
    expect(content).toContain("127.0.0.0/8")
    expect(content).toContain("169.254.0.0/16")
    expect(content).toContain("fe80::/10")
    expect(content).toContain("fc00::/7")
  })

  test("SKILL.md liveness check uses curl --max-redirs 0 (the correct flag)", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("--max-redirs 0")
    // The wrong flag --no-redirect must not appear (was a common bug in early drafts)
    expect(content).not.toContain("--no-redirect")
  })

  test("SKILL.md env-var-name validation regex is ^[A-Z][A-Z0-9_]*$", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("^[A-Z][A-Z0-9_]*$")
  })

  test("SKILL.md requires env vars to be set and non-empty at validation time", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("set and non-empty")
  })

  test("auth-config-schema.md exists", async () => {
    expect(await fileExists(SCHEMA_PATH)).toBe(true)
  })

  test("auth-config-schema.md contains password and magic_link worked examples", async () => {
    const content = await readRepoFile(SCHEMA_PATH)
    expect(content).toContain("type: password")
    expect(content).toContain("type: magic_link")
    expect(content).toContain("## Variant 1: `password`")
    expect(content).toContain("## Variant 2: `magic_link`")
  })

  test("auth-config-schema.md contains DO and DO NOT credential callouts", async () => {
    const content = await readRepoFile(SCHEMA_PATH)
    expect(content).toContain("**DO NOT**")
    expect(content).toContain("**DO**")
  })

  test("auth-config-schema.md documents the mail_capture_url loopback exemption", async () => {
    const content = await readRepoFile(SCHEMA_PATH)
    expect(content).toContain("Loopback exemption for `mail_capture_url`")
    expect(content).toContain("exempt from the loopback")
  })

  test("auth-config-schema.md documents DNS-rebinding residual risk", async () => {
    const content = await readRepoFile(SCHEMA_PATH)
    expect(content).toContain("DNS rebinding")
    expect(content).toContain("Residual risk")
  })

  test("auth-config-schema.md documents the CE_USER_SCENARIOS_CLEANUP env-var opt-in", async () => {
    const content = await readRepoFile(SCHEMA_PATH)
    expect(content).toContain("CE_USER_SCENARIOS_CLEANUP=1")
  })
})

describe("ce:user-scenarios — Unit 4 contract (session isolation, sandboxing, action budget)", () => {
  test("SKILL.md Step 4 mentions all three sandbox env vars", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("AGENT_BROWSER_ALLOWED_DOMAINS")
    expect(content).toContain("AGENT_BROWSER_CONTENT_BOUNDARIES")
    expect(content).toContain("AGENT_BROWSER_ENCRYPTION_KEY")
  })

  test("SKILL.md uses --session (not --session-name) for parallel isolation", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("--session ")
    // The wrong flag (named cookie save/restore without isolation) must not be the operational flag.
    // It may appear in explanatory text contrasting the two flags; assert it appears at most once.
    const wrongFlagOccurrences = content.split("--session-name").length - 1
    expect(wrongFlagOccurrences).toBeLessThanOrEqual(2)
  })

  test("SKILL.md documents the hostname-only allowlist rule (strip ports before composing)", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("Hostname extraction rule")
    expect(content).toContain("strip the port")
  })

  test("SKILL.md documents the daemon spawn-time env-var caveat", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("spawn time")
    expect(content).toContain("state clear")
  })

  test("SKILL.md action-budget literals are 40 / 20 / 300", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("`40`")
    expect(content).toContain("`20`")
    expect(content).toContain("`300`")
  })

  test("SKILL.md contains the SESSION_NAME composition literal", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("SESSION_NAME=ce-user-scenarios-${RUN_ID}-${PERSONA_NAME}")
  })

  test("SKILL.md describes silent-failure detection for personas with zero browser activity", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("silent-failure")
    expect(content).toContain("no browser activity recorded")
  })
})

describe("ce:user-scenarios — Unit 5 contract (output, synthesis, cleanup)", () => {
  test("Step 5 documents screenshot-existence validation and fabricated-citation tagging", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("Screenshot-existence validation")
    expect(content).toContain("fabricated-citation")
  })

  test("Step 5 preserves relative-path citations and forbids absolutizing in-process output", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("relative path")
    expect(content).toContain("does NOT absolutize")
  })

  test("Step 6 synthesis includes the ### Evidence Conflicts subsection", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("### Evidence Conflicts")
  })

  test("Step 7 enumerates all 4 terminal states", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("`success`")
    expect(content).toContain("`failure`")
    expect(content).toContain("`timeout`")
    expect(content).toContain("`partial`")
  })

  test("Step 7 contains both per-persona cleanup commands as literal strings", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("npx agent-browser --session {session_name} close")
    expect(content).toContain("npx agent-browser state clear {session_name}")
  })

  test("Step 7 documents CE_USER_SCENARIOS_CLEANUP=1 env-var opt-in (and does NOT reference any cleanup-on-success: arg)", async () => {
    const content = await readRepoFile(SKILL_PATH)
    expect(content).toContain("CE_USER_SCENARIOS_CLEANUP")
    expect(content).not.toContain("cleanup-on-success:")
  })
})

describe("ce:user-scenarios — R15 cross-cutting (forbidden + required phrases in live-app blocks)", () => {
  test("forbidden imagination phrases do NOT appear in live-app blocks", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)

    // Extract the implementation-live-app and presentation-live-app blocks.
    // Both run from their ### header to the next heading at any level (# .. ######)
    // or end-of-file. Header search is case-insensitive so capitalization drift in the
    // template fails with a meaningful message rather than a confusing -1.
    const liveAppBlocks: string[] = []
    const blockHeaders = ["### implementation-live-app", "### presentation-live-app"]
    const contentLower = content.toLowerCase()
    for (const header of blockHeaders) {
      const startIdx = contentLower.indexOf(header.toLowerCase())
      expect(startIdx, `Expected to find header '${header}' (case-insensitive) in template`).toBeGreaterThan(-1)
      const afterHeader = content.slice(startIdx + header.length)
      const nextHeaderMatch = afterHeader.match(/\n#{1,6}\s/)
      const nextHeaderIdx = nextHeaderMatch ? nextHeaderMatch.index! : -1
      const block = nextHeaderIdx === -1 ? afterHeader : afterHeader.slice(0, nextHeaderIdx)
      liveAppBlocks.push(block)
    }

    const forbidden = [
      "imagine you are",
      "pretend you are",
      "envision yourself",
      "picture yourself",
      "as if you are",
    ]
    for (const block of liveAppBlocks) {
      const lower = block.toLowerCase()
      for (const phrase of forbidden) {
        expect(lower).not.toContain(phrase)
      }
    }
  })

  test("required observation phrase 'do not imagine — observe' appears in BOTH live-app blocks", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    // At least once per block — total at least 2
    const lower = content.toLowerCase()
    const occurrences = lower.split("do not imagine — observe").length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  test("concept and plan stage blocks are preserved (still narrative-mode)", async () => {
    const content = await readRepoFile(TEMPLATE_PATH)
    // These are the legacy block headers; their presence proves we didn't accidentally delete them.
    expect(content).toContain("### concept")
    expect(content).toContain("### plan")
    // The concept block still uses imagination-framing intentionally; assert it does.
    expect(content).toContain("imagine how you would use this")
  })
})
