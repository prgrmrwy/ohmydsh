# dsh-system-clock

English · [简体中文](README.zh.md)

<!-- problem -->
When you reach DSH through an SSH tunnel from another machine or time zone, your browser's clock shows a different time from the machine DSH actually runs on. This plugin adds a live 24-hour clock of the DSH host, in the host's own time zone and with its hostname, at the bottom of the Settings panel.

![Settings in DSH: the host clock with date, time zone and host name](docs/overview.png)

**Install.** Managed through `dsh.yaml` (entry `system-clock`, `source: local`): set `enabled: true`, run `dsh build`, then restart DSH. Backlog item B019; designs in the OpenSpec changes `settings-system-clock` and `dsh-0-1-2-host-api-migration`.

## How it behaves

- Settings panel, last navigation entry **System Clock**: bold `HH:MM:SS` (24-hour, zero-padded, no AM/PM), a date line `YYYY-MM-DD` plus a weekday that follows the UI language, a time zone line such as `Asia/Shanghai (UTC+08:00)`, and a small caption `DSH host · <hostname>`.
- The host process is the source of truth. The client takes one sample over the `/dsh-system-clock` Connection RPC channel, then ticks locally every second from the measured skew, rendering with `Intl.DateTimeFormat(..., { timeZone: <host zone>, hour12: false })`. Daylight saving changes come out right without the client knowing any time zone rules.
- It resamples every 60 s and whenever the page becomes visible again, which corrects drift and host DST switches. A failed resample keeps the previous value and the clock keeps running.
- If no sample has ever succeeded, the section shows "Host clock unavailable" and retries on the same 60 s cycle. It **never** falls back to the browser's local time, which would be misleading when the browser and the host are different machines.

Wiring (re-check after DSH upgrades): the host entry `src/index.ts` registers `connection.rpc.handle('/dsh-system-clock', …)` inside `ctx.inject(['connection'])`, the same channel wiring `dsh-plugin-subscriptions` uses for `/subscriptions-auth`; without a `connection` service (headless) it registers nothing and the plugin still loads. The client `src/client/index.ts` registers the official `settings.section` (id `system-clock`, order 300, the end of the navigation); `clock-engine.ts` is the pure skew engine, `section.tsx` the React wiring, and `clock-locales.ts` the zh/en dictionary.

## Configuration

None. The plugin row carries no `config` fields and there are no environment variables. Section copy follows the UI language (zh/en). To remove it, set `enabled: false` in `dsh.yaml` and sync; no data is persisted.

## Boundaries & safety

- Read-only: the single `now` endpoint returns only the host epoch, IANA time zone, UTC offset and hostname. Nothing is written, and no credentials, sessions or files are touched.
- No external network requests; the only traffic is the browser-to-host RPC. The channel stays on the loopback-only Connection fence.
- It does not modify the official DOM or class names.
- Peer dependencies: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-client-ui-settings`, `react` (plus the renderer package for the client half).

## Development

Run from the repository root:

```sh
npm run typecheck --workspace dsh-system-clock   # host + client projects
npm run build --workspace dsh-system-clock       # tsc (host) + tsdown (client bundle)
npm test --workspace dsh-system-clock            # vitest: formatter / engine / host-time / wiring, no browser
```

The build shape matches `dsh-session-title-copy`: tsdown emits a single-file client bundle and `tsc` emits the host ESM.
