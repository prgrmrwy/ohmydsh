## Purpose

Defines the zydsh repository layout, the master manifest contract, and the sync behavior that materializes enabled customizations into a DSH deployment.

## ADDED Requirements

### Requirement: Master manifest declares DSH version and customizations
The repository SHALL contain a root `dsh.yaml` manifest. The manifest SHALL declare the pinned DSH version and a list of customizations, where each entry specifies `id`, `type`, and `enabled`, and SHALL specify `version` for `package` and `preset` types.

#### Scenario: Read manifest
- **WHEN** a user reads `dsh.yaml`
- **THEN** every customization's id, type, version (where required), and enabled state are explicit

#### Scenario: Missing manifest
- **WHEN** sync runs and `dsh.yaml` is absent
- **THEN** sync exits with an error naming the missing manifest and how to create it

### Requirement: Customization units follow the community bundle standard
A `package` customization SHALL be a self-contained directory whose `package.json` declares a `dsh.bundle` manifest and whose composition rows live in its own `cordis.patch.yml`, so it installs via `dsh plugin add`. A `preset` customization SHALL be a directory containing a `cordis.yml`. A `patch` customization SHALL be a YAML patch-list fragment. A `skill` customization SHALL provide its skill definition under its own directory.

#### Scenario: Add a package customization
- **WHEN** a package customization is added under `packages/<name>/`
- **THEN** the directory contains a `package.json` with `dsh.bundle` and a `cordis.patch.yml`, and `dsh plugin add` succeeds

#### Scenario: Add a preset customization
- **WHEN** a preset customization is added under `presets/<id>/`
- **THEN** the directory contains a `cordis.yml` and the preset is mountable by the DSH roster

### Requirement: Sync materializes enabled customizations idempotently
The sync tool SHALL materialize every enabled customization into the DSH deployment (`~/.dsh`), and SHALL be idempotent: running it twice on an unchanged repository produces no changes on the second run.

#### Scenario: Repeat sync is a no-op
- **WHEN** sync runs twice without repository changes
- **THEN** the second run reports no changes

#### Scenario: Disabled customization is absent from deployment
- **WHEN** a customization has `enabled: false`
- **THEN** sync leaves no trace of it in the deployment surface

#### Scenario: Enabled customization is materialized
- **WHEN** a customization has `enabled: true`
- **THEN** its package is installed, its patch rows are merged, or its preset is linked, according to its type

### Requirement: Toggling is reversible without deleting repository content
Changing a customization's `enabled` value and re-running sync SHALL add or remove it from the deployment while its files remain in the repository.

#### Scenario: Disable then re-enable
- **WHEN** a customization is disabled and later re-enabled, with sync after each change
- **THEN** the deployment first loses and then regains exactly that customization, and the repository copy is unchanged throughout

### Requirement: Generated deployment files are marked and merged in order
Files sync generates (including the profile patch layer) SHALL carry a generated marker stating the repository is the source of truth, and patch rows from multiple enabled customizations SHALL be merged in manifest order.

#### Scenario: Two enabled patch customizations
- **WHEN** two patch customizations are enabled
- **THEN** the generated patch layer contains both fragments in manifest order under a generated marker header

### Requirement: Customizations carry independent versions
Every `package` customization SHALL have a `version` in its `package.json`, and every `preset` customization SHALL have a `VERSION` file, so the manifest can reference each customization independently.

#### Scenario: Version bump of one customization
- **WHEN** one customization's version is bumped and the manifest updated
- **THEN** other customizations' versions are unaffected
