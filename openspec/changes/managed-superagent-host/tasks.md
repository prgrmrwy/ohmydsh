## 1. Implementation

- [x] 1.1 `scripts/launcher/process.mjs`: `validProfile`, `isDshHostProcess` (+ `isDshWebProcess` web alias), profile through `classifyPort`/`verifyEntry`/`probePort`/`stopServer`, macOS ps tail accepts any profile token
- [x] 1.2 `scripts/launcher/main.mjs`: `guardManagedProfile` before side effects; profile on all probes, guarded stop, `preparePetStop`; Host argv `[profile, …]`; no-pet-stop patch only for web; `autoUpdate` only for web; `verifyStopProtocol` only for web; `profile=` in startup record
- [x] 1.3 `scripts/launcher/args.mjs` help line

## 2. Tests

- [x] 2.1 `tests/launcher-managed-profile.test.mjs`: ownership by profile, invalid profile, port requirement, maintenance refusal, preview/name/profile-dir/stop/restart refusal with zero side effects, read-only history, real stub start (argv, no patch, no autoUpdate/sync, `profile=superagent` record, reuse, stop/restart refused without signals, web stop does not adopt it, explicit maintenance stop), and web regression (web argv + no-pet-stop patch + autoUpdate checked)
- [x] 2.2 Negative check: original `main.mjs` fails 2.1 cases 3/4/5/7/8, and a stubbed `process.mjs` fails cases 1/2/5/7
- [x] 2.3 Existing launcher tests stay green (no assertion relaxed)

## 3. Docs

- [x] 3.1 `scripts/launcher/README.md` and `README.zh.md`: managed non-web profile section

## 4. Verification

- [x] 4.1 `npm test`
- [x] 4.2 `npm run check:artifacts`
- [x] 4.3 `node scripts/sync.mjs` twice (second run reports no change; `dsh.yaml` untouched)
- [x] 4.4 `openspec validate managed-superagent-host --strict`
- [ ] 4.5 Live acceptance on the deployment side after merging to main: `DSH_PROFILE=superagent dsh -p 3082` inside a `dsh-superagent-*.scope`, `dsh history` shows `profile=superagent`, SA survives a 3080 restart
