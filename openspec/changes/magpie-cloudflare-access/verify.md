# Access integration verification

## Scope and baseline

Started from clean shared main containing AMD3. Only dsh-magpie host/client identity paths and tests modified, plus this independent change; no AUTO/Pet compat, manifest/lock, production settings or Host restart. Mainline scope recorded in collaboration item access-followup-scope (seq12); read-only review requested seq13.

## Executed evidence

- npm run typecheck: passed.
- npm test (package): 34 files, 230 tests passed after persistent-quarantine fix (14 host Access, 2 restart/disk failure and 2 UI tests included).
- npm run build: passed; existing tsdown deprecation/format warnings remain.
- openspec validate magpie-cloudflare-access --strict: passed.
- git diff --check and repository check:artifacts: passed.
- New cases cover all five endpoint headers, LAN omission, read-only preflight, invalid pair/HTTPS, credential rotations/delayed resolution, prepared operations, reflected secret redaction, partial write quarantine, real adapter Chat/Responses SSE and UI submit/clear/read-only states.
- Regression caught during development: empty credential tuple was hashed to nonempty fingerprint, clearing manually seeded unconfigured catalog. Fixed by keeping empty fingerprint when every credential absent; all 18 display-group tests pass.

## Real built-plugin public smoke

Built runtime/adapter/cards imported in a separate Node process, using in-memory read-only credential provider populated via SSH stdin. No credential values printed, saved into ordinary settings or passed on CLI arguments. Existing DSH connection untouched.

- Catalog: 13 models, no sync error.
- Cards: HTTP 200.
- Codex gpt-6.1-sol effort low: streaming text pong, finish stop.
- Separate tool request: echo_value tool-call block received; DSH-shaped assistant/tool messages replayed; continuation The tool returned pong, finish stop.

This is real plugin wire evidence, not a GUI settings/save or company-network acceptance. Access headers reached Cloudflare through actual transport. Existing Cloudflare infrastructure tests previously verified no-Access403, missing-gateway401 and admin404.

## Limits / remaining

- Await mainline owner's read-only review; not yet deployed into daily Host or GUI accepted.
- Credentials service has no multi-ref transaction. Preflight rejects all invalid/read-only input before writes; actual storage failure returns500, preserves old URL, invalidates generation and quarantines new admission until all attempted fields explicitly retried. The initial process-local quarantine was rejected in review. User-approved fix now persists non-secret attempted field names before credential writes; restart rebuilds quarantine and rejects incomplete retry, clearing it only after full success. Real temporary-file restart regression and marker-persistence failure test pass. This is not atomic credential rollback.
- Claude weekly429 and an earlier OpenCode Go nonstreaming forced-tool180s timeout remain infrastructure observations, not fixed here.
- Company network must be tested by user after deployment/private credential installation.
