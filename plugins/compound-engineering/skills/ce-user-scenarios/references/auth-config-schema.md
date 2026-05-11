# auth-config.yaml — Schema and Worked Examples

The `ce:user-scenarios` skill accepts an `auth-config:<file-path>` argument in live-app mode (when `stage:implementation` or `stage:presentation` is combined with `url:<value>`). This file tells the skill how each persona authenticates against the application being evaluated.

The file is a **YAML discriminated union** keyed on the top-level `type:` field. v1 supports two variants: `password` and `magic_link`.

**DO NOT** write credential literals into this file. Every identity field (`email_env`, `password_env`) names an environment variable. The skill reads the variable's value at run time. Secrets stay in your shell config, your secrets manager, or your CI's secret store — never in a YAML file that might be committed.

**DO** keep this file gitignored when it lives alongside an application. The KickScout convention is to gitignore `auth.yaml` in the project root and document the required env vars in the project's README.

## Variant 1: `password`

```yaml
type: password
sign_in_url: http://localhost:3000/sign_in
post_login_url: http://localhost:3000/dashboard
email_env: KS_PERSONA_EMAIL
password_env: KS_PERSONA_PASSWORD
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | literal `password` | Discriminator |
| `sign_in_url` | yes | URL field | Scheme http/https; resolved IP NOT in reject list |
| `post_login_url` | yes | URL field | Where the persona expects to land after a successful sign-in. Used to verify auth completed before evaluating the feature |
| `email_env` | yes | env-var-name field | Name of the env var holding this persona's email. Must match `^[A-Z][A-Z0-9_]*$` AND be set non-empty in the calling environment |
| `password_env` | yes | env-var-name field | Same rules as `email_env`. The skill never logs the resolved value |

## Variant 2: `magic_link`

```yaml
type: magic_link
sign_in_url: http://localhost:3000/magic_session
mail_capture_url: http://localhost:3000/letter_opener
mail_link_recipient_selector: ".letter[data-recipient*='%EMAIL%']"
post_login_url: http://localhost:3000/dashboard
email_env: KS_PERSONA_EMAIL
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | literal `magic_link` | Discriminator |
| `sign_in_url` | yes | URL field | Where the persona submits the email to request a magic link |
| `mail_capture_url` | yes | URL field (loopback-exempt) | Where the persona reads the captured email. Conventionally a dev-mail server like letter_opener_web on `localhost:3001` or the same app's `/letter_opener` mount. **This field is exempt from the loopback-IP reject** because dev-mail capture is local by convention |
| `mail_link_recipient_selector` | yes | non-empty string | CSS or accessibility selector that locates the persona's specific email in the mail capture inbox, given the persona's email value. May contain a literal `%EMAIL%` placeholder which the persona resolves to the value of `email_env` before using. **Validation is structural-only** — the skill checks the string is non-empty but does not verify the selector resolves against a real mail-capture DOM. A wrong selector silently mis-routes the magic-link click to another persona's email under high-concurrency load; pair this field with a Unit 7 full-smoke run against your actual dev-mail UI before relying on it in production evaluation. |
| `post_login_url` | yes | URL field | Same purpose as in the password variant |
| `email_env` | yes | env-var-name field | Same rules as in the password variant |

### Per-persona env-var derivation

`email_env` (and `password_env`, where present) is a **template name containing the literal token `PERSONA`**. At dispatch time, the skill substitutes the uppercased persona filename for `PERSONA` to produce a per-persona env-var name. Caller must export all derived names before invoking the skill.

| Template `email_env` | Persona file | Derived env-var name |
|---|---|---|
| `KS_PERSONA_EMAIL` | `betty.md` | `KS_BETTY_EMAIL` |
| `KS_PERSONA_EMAIL` | `chuck.md` | `KS_CHUCK_EMAIL` |
| `KS_PERSONA_EMAIL` | `dorry.md` | `KS_DORRY_EMAIL` |
| `KS_PERSONA_EMAIL` | `mark.md` | `KS_MARK_EMAIL` |
| `KS_PERSONA_EMAIL` | `nancy.md` | `KS_NANCY_EMAIL` |

The template MUST contain the literal token `PERSONA` (uppercase, no underscores) — otherwise the skill cannot produce per-persona names and aborts with a named error. Per-persona unique emails are how the skill avoids inbox-ambiguity in the magic-link flow; collapsing all personas onto a single email breaks the `mail_link_recipient_selector` match.

Step 3.6 validates each derived name independently: each must match `^[A-Z][A-Z0-9_]*$` AND the referenced env var must be set and non-empty. Validation aborts with the specific persona name when an expected variable is missing (e.g., `KS_CHUCK_EMAIL is not set; required for persona chuck`).

## Validation rules at a glance

The skill validates this file in Step 3.6 of SKILL.md. Briefly:

- The `type:` field must be `password` or `magic_link`. Other values are rejected.
- URL fields must use `http` or `https` scheme and resolve to a non-private, non-loopback, non-link-local, non-IPv6-ULA (`fc00::/7`) IP — **except** `mail_capture_url`, which is loopback-exempt. See `SKILL.md` Step 3.6 for the complete reject list.
- Env-var-name fields must match `^[A-Z][A-Z0-9_]*$` AND the referenced env var must be set and non-empty in the calling environment.
- The whole file is parsed once; partial validation does not proceed.

## Loopback exemption for `mail_capture_url`

`mail_capture_url` is the one field that may resolve to a loopback or RFC-1918 address. The exemption is field-specific and load-bearing: dev-mail capture tools (letter_opener_web, mailcatcher, mailpit) are conventionally local-only. Validating them against the same SSRF reject list as `sign_in_url` would block every realistic dev workflow.

Trust scope: in v1, the caller writes the auth-config file themselves and points to their own dev-mail service. If a future change exposes auth-config authorship to less-trusted callers (e.g., received over the wire), this exemption should be tightened — at minimum, document the threat model and require that `mail_capture_url`'s host match a known dev-mail-server allowlist.

## Residual risk: DNS rebinding

The URL field validation resolves hostnames to IPs at validation time and checks the resolved IP against the reject list. This protects against the static case (a hostname that always points to a private IP) but not against DNS rebinding, where the hostname returns a public IP at validation time and a private IP at navigation time.

Full mitigation requires OS-level controls outside this skill's scope:
- An outbound firewall rule blocking the daemon's process group from private IP ranges
- DNS pinning at the resolver (the daemon's DNS resolver caches the validation-time IP for the duration of the session)
- Running the persona browser inside a network namespace with no route to private addresses

The skill documents this as a known limitation. Callers running live-app mode against untrusted feature descriptions should layer one of the above OS-level controls before relying on `AGENT_BROWSER_ALLOWED_DOMAINS` as a complete sandbox.

## Advanced: scratch-directory retention

The skill writes per-run scratch artifacts (screenshots, intermediate logs, structured tails) to `.context/compound-engineering/ce-user-scenarios/<run-id>/<persona-name>/`. Default behavior is **retain** so synthesis citations stay resolvable for inspection.

Set `CE_USER_SCENARIOS_CLEANUP=1` in your environment to opt into scratch-directory cleanup. When set AND the run reaches a `success` terminal state, the skill removes the per-run directory after synthesis completes. Failure, timeout, and partial-completion states never clean up regardless of the env var, because their artifacts are the only diagnostic evidence available.

This is an env-var opt-in rather than a first-class skill argument by design. Power users who consistently want cleanup can set it once in their shell rc; the default behavior is safe and inspectable.

## Related

- `SKILL.md` Step 3.6 — validation logic that consumes this file
- `SKILL.md` Step 4 — how the persona dispatch wires `email_env` and the structural fields into the persona prompt
- `docs/spikes/2026-05-10-user-scenarios-direct-drive.md` — empirical evidence that the magic-link flow works against KickScout's letter_opener_web mount, and that `AGENT_BROWSER_ALLOWED_DOMAINS` enforces hostname-only allowlisting
