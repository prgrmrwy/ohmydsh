# P3 historical fixture dependency closure repair

## Root cause and RED

After package-manager resolution became a real dependency of sync/dsh-cli, eight historical test fixture builders still copied an explicit helper allowlist without `scripts/lib/package-manager.cjs`. The product source remained correct; copied subprocess roots were incomplete.

Reproduction:

```sh
node --test tests/sync-agent-instructions.test.mjs
```

Result: exit 1; 8 tests failed. First failure was `ERR_MODULE_NOT_FOUND` for the fixture's `repo/scripts/lib/package-manager.cjs`, imported by the copied `scripts/lib/dsh-cli.mjs`. Other expected safety diagnostics were masked by the same import error.

## Smallest repair

Added one explicit helper copy/allowlist entry in each of:

- sync-agent-instructions
- sync-customization-enabled-env
- sync-profile-scaffold
- sync-local-package
- sync-build-freshness
- sync-compat-provenance
- sync-deployment-integrity
- sync-deploy-refresh

All test assertions and product files are unchanged. No delayed import, optional dependency fallback, additional skips or broad fixture refactor was introduced. Lead separately owns the repo-facade copy-extension filter.

## Fresh GREEN

```sh
node --test tests/sync-agent-instructions.test.mjs tests/sync-customization-enabled-env.test.mjs tests/sync-profile-scaffold.test.mjs tests/sync-local-package.test.mjs tests/sync-build-freshness.test.mjs tests/sync-compat-provenance.test.mjs tests/sync-deployment-integrity.test.mjs tests/sync-deploy-refresh.test.mjs
```

Result: exit 0; **45 tests passed, 0 failed, 0 skipped, 0 todo**. `git diff --check` passed immediately afterward. This is Linux fixture regression evidence; it is not a native Windows/macOS or public manifest gate result.
