## Purpose

为后续的工作流路由 provider 预留一个小而封闭的实验性契约：两阶段判断由 dispatcher 持有信任（token、特征与候选校验、权威优先级），经唯一进程内入口调用；本能力不向任何会话发布工具或指导，无 provider 时保持官方行为。

## Requirements

### Requirement: Routing providers have a small experimental registration contract
The adapter SHALL expose a DSH service accepting providers with stable id, `contractVersion: 1` marked experimental until a production provider ships, declared supported stages and a decision callback. v1 is a contract-only capability: it has no production caller and no model-reachable surface in this change, and it exists so the first real provider change can plug in without reshaping the adapter. Registration SHALL return a disposer. Configuration SHALL explicitly select one provider id; no loading-order selection, voting or implicit chaining SHALL occur. Provider removal or Host disposal SHALL cancel its in-flight work and discard stale results. Jev SHALL NOT be a required dependency.

#### Scenario: Selected provider registers invokes and disposes
- **GIVEN** one configured test provider with contractVersion 1
- **WHEN** it registers, handles a supported request and then unregisters
- **THEN** the callback count is 1, its structured result is returned, and subsequent requests return `unavailable` with reason `no-active-provider`

#### Scenario: Invalid registration or missing provider never guesses
- **GIVEN** duplicate ids, unsupported contract version or an absent configured provider
- **WHEN** registration or selection occurs
- **THEN** a typed registration error or `unavailable` result is returned and zero callbacks occur on any other registered provider

### Requirement: Routing preserves two distinct bounded decision stages with dispatcher-owned trust
The contract SHALL support `change-necessity` and `workflow-selection`. Input SHALL include bounded enum/numeric/boolean features, typed eligible candidates and a cancellation signal; full conversation, code, credentials and arbitrary user text SHALL NOT be passed. Candidate descriptions SHALL come only from the bundled official schemas, or SHALL be length-bounded (2 KiB), stripped of control characters and labeled untrusted data when they originate from project-local schema discovery. The supplied change name SHALL be validated against the official change-name pattern and resolved only inside the resolved root's changes directory, with no path traversal and no symlink escape. The dispatcher SHALL issue a stage token of at least 128 random bits bound to the caller-supplied session identifier with a 10min TTL (clock injectable for tests), single-use, held in a bounded in-memory table with eviction; `workflow-selection` SHALL require a valid token from a `formal-workflow` first-stage result for the same session identifier. These token properties are unit-level properties of an in-process function whose session identifier is caller-supplied, because no model can reach the dispatcher in this change. Existing-change authority SHALL be resolved by the dispatcher through official discovery from a supplied change name; an explicit user choice is a separate enum argument documented as model-reported and non-authoritative. Workflow candidates SHALL distinguish official OpenSpec schemas (from official discovery for the resolved root/store) from external workflows (from a trusted static provider declaration plus eligibility check).

#### Scenario: Two-stage judgment represents existing routing vocabulary
- **GIVEN** locally projected features and healthy schema/external-workflow candidates
- **WHEN** a test provider recommends formal workflow and the token is then used for workflow selection
- **THEN** both results share the token, schema and external-workflow candidates carry distinct `kind` values, and zero commands or file writes are performed

#### Scenario: Forged expired reused or cross-session tokens are refused
- **GIVEN** a forged token, an expired token, an already used token, a token from another session identifier or a token from a `direct` first-stage result
- **WHEN** `workflow-selection` is requested
- **THEN** the result is `unavailable` with reason `invalid-stage-token` and the provider callback count is 0

#### Scenario: Unknown scope or candidate is rejected
- **GIVEN** incomplete official discovery, oversized/unrecognized features or a provider returning an ineligible candidate
- **WHEN** the request/result is validated
- **THEN** it yields `needs-review` or `unavailable` and never a fabricated candidate or executable default

#### Scenario: Hostile change names and candidate text are contained
- **GIVEN** a change name `../../etc` or a symlinked change directory escaping the root, and a project schema description containing control characters and 5 KiB of text
- **WHEN** the request is built
- **THEN** the change name is rejected with a typed validation error and no filesystem read outside the changes directory occurs, and the description reaches the provider truncated to 2 KiB, control-stripped and marked untrusted

### Requirement: Routing results are advisory evidence restricted to approved providers
User explicit route and dispatcher-resolved existing change identity SHALL precede judgment. The router SHALL NOT change an existing schema, weaken safety gates or directly initialize/create/apply/archive/merge. Every result SHALL carry `authority: none`. Because exposing results to the Agent would be advisory in effect, outside test fixtures selecting any active provider SHALL require a separate change with explicit user approval, and a Jev-backed provider SHALL NOT be selectable until `jev-workflow-routing` promotion to advisory is approved. This change SHALL keep Jev shadow behavior and records unchanged.

#### Scenario: Existing change bypasses routing
- **GIVEN** an existing change with a recorded schema supplied by name
- **WHEN** the routing entry is called
- **THEN** the result reports the recorded schema with `source: existing-change` and the provider callback count is 0

#### Scenario: A confident result grants no authority
- **GIVEN** a test provider returns a valid confident recommendation
- **WHEN** the dispatcher returns it
- **THEN** the result contains `authority: none`, and zero changes are created, zero workflows invoked and Jev shadow record files are byte-identical

#### Scenario: Unapproved non-test provider is not activated
- **GIVEN** a configured non-test provider without an approval record
- **WHEN** a routing request is made
- **THEN** routing returns `unavailable` with reason `provider-not-approved` and the provider callback count is 0

### Requirement: The dispatcher is reachable through one in-process entry and is not published to sessions in this change
The adapter SHALL expose the dispatcher through exactly one in-process entry function. In this change the adapter SHALL NOT register a model-facing `openspec_route` tool or routing guidance in any session, global or agent-scoped, because the header cannot prove an ordinary session: a workspace-resident Pet executor has a session header identical to an ordinary session, and no real dedicated-Pet-executor or Locus-child sample exists locally. Publishing a session tool is deferred to a separate change that supplies those real samples. Catalog discovery SHALL NOT make a routing request. Generic Bash SHALL remain outside interception claims.

#### Scenario: One entry is the only way to reach a provider
- **GIVEN** an approved test provider registered in-process
- **WHEN** a request is made through the single entry and, separately, any other exported symbol of the bundle is searched for a route to the provider
- **THEN** the provider callback count is 1 and no second exported function, tool or command reaches it

#### Scenario: Every producible session kind has exactly the baseline tool list
- **GIVEN** an approved test provider is registered and each producible session kind (ordinary, subagent child, and Pet executor or Locus child where the isolated profile can produce them) starts
- **WHEN** each session's `request/header` tools and skill catalog are produced
- **THEN** each tool list equals the adapter-disabled baseline exactly, no routing tool or guidance appears, and every session kind the profile could not produce is recorded as an explicit gap rather than passing

#### Scenario: No provider adds no conversation machinery
- **GIVEN** no approved available provider
- **WHEN** Skills/commands are consumed and arbitrary Bash is used
- **THEN** the provider callback count is 0, bodies equal `renderOfficialBody`, and the `request/header` tool list equals the adapter-disabled baseline exactly

### Requirement: Routing failures cancellation and stale results are contained
Dispatch SHALL impose a maximum 5s budget, forward cancellation and validate result shape/candidate membership. Timeout, thrown error, malformed output, stale request or unregistration SHALL return a normalized `unavailable` or `needs-review` result and never select direct or another workflow. Ordinary OpenSpec use SHALL continue. No provider error body or request payload text SHALL be persisted; only a normalized error class.

#### Scenario: Bounded uncertain response is preserved
- **GIVEN** an active provider returns `needs-review` within its budget
- **WHEN** dispatch completes
- **THEN** the returned status is `needs-review` with no candidate substituted

#### Scenario: Late failing or cancelled provider cannot mutate the route
- **GIVEN** timeout, cancellation, callback exception or provider unload during dispatch
- **WHEN** its result eventually settles
- **THEN** the returned result is `unavailable` with a normalized error class, the late output is discarded, and persisted adapter state contains no provider error text or request payload
