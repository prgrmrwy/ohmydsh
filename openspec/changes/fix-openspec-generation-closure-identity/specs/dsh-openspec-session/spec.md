## ADDED Requirements

### Requirement: Generation content is independent of the host dependency layout
The adapter SHALL name every dependency package copied into a generation by that package's own resolved identity — its name and version plus a suffix derived from its direct dependencies' identities — and MUST NOT derive any generation-content name from a host filesystem path, so that installing the same dependency versions under a different physical layout (nested copies versus copies hoisted to a parent root) yields byte-identical generation content. The generation identity SHALL cover the resolved dependency closure, so that a changed closure materializes and activates a new generation instead of colliding with an existing one, while an unchanged closure reuses the existing generation unchanged. A failure while preparing the generation or registering the adapter's startup contributions SHALL be reported to the host logger once, at error level, with a stable bounded diagnostic code and without error body text, SHALL leave no partial Skill provider, command or routing service registered, and MUST NOT be silent. Reporting SHALL NOT escalate the failure into a Host-wide startup failure.

#### Scenario: Relocated identical versions reuse the generation
- **GIVEN** a materialized generation whose dependency versions are reachable through nested copies, and those same versions materialized again at different physical paths (for example hoisted to the parent root)
- **WHEN** materialization runs for the same generation identity
- **THEN** the existing generation directory is reused without `generation-identity-collision`, its bytes stay identical, and every closure directory name contains no host path fragment

#### Scenario: A changed closure supersedes instead of colliding
- **GIVEN** a materialized generation and a dependency identity change that leaves the official version and the adapter's own Skill bodies unchanged
- **WHEN** the adapter derives its generation identity
- **THEN** the derived identity differs from the materialized one, materialization activates the new generation without `generation-identity-collision`, and the prior generation directory is byte-identical

#### Scenario: Startup failure is reported and fails closed
- **GIVEN** a startup contribution failure (for example an active generation that cannot be loaded)
- **WHEN** the plugin mounts
- **THEN** the host logger receives exactly one message carrying a stable diagnostic code and no error text, and no command, Skill provider or routing service is registered
