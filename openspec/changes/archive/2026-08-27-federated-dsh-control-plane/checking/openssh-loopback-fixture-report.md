# M0 system OpenSSH loopback fixture report

## Result

Task 1.11: **PASS** on macOS system OpenSSH `10.0p2`.

The fixture uses `/usr/bin/ssh`, `/usr/sbin/sshd` and `/usr/bin/ssh-keygen`. It creates an unprivileged loopback sshd with temporary host/client Ed25519 keys, `authorized_keys`, `known_hosts` and SSH config under a test temp directory. It does not read or modify the user's real `~/.ssh`, agent, keys or known_hosts.

## Command contract

`scripts/federation-openssh.mjs` constructs strict argv arrays:

```text
identity probe:
  ssh -F <config> -o BatchMode=yes -o ConnectTimeout=5 -- <alias> true

tunnel:
  ssh -F <config> -N
      -o BatchMode=yes
      -o ExitOnForwardFailure=yes
      -o ServerAliveInterval=15
      -o ServerAliveCountMax=3
      -L 127.0.0.1:<local>:127.0.0.1:<remote>
      -- <alias>
```

Alias syntax is validated before argv construction and option termination precedes the alias. User/hostname/key/ProxyJump resolution remains owned by system OpenSSH config.

## Executable evidence

`tests/federation-openssh.test.mjs` proves:

1. a configured alias resolves and authenticates with `BatchMode=yes` and no prompts;
2. an option-shaped alias is rejected before spawn;
3. an absent known_hosts entry fails with host-key verification error and no interactive acceptance;
4. `ssh -G` preserves alias HostName/User and `ProxyJump fixture-jump` resolution;
5. a real loopback `-L` tunnel forwards bytes to a controlled loopback echo service;
6. only `127.0.0.1` addresses are used on both forwarding ends;
7. terminating the exact owned child closes its local listener while the fixture sshd remains running;
8. an occupied local listener makes ssh exit non-zero because `ExitOnForwardFailure=yes` is present;
9. keepalive options are in the actual tunnel argv.

`ExitOnForwardFailure` evidence is intentionally limited to initial local listener setup. It does not prove that a later remote destination/channel or DSH protocol is available; production readiness must refuse endpoint publication until the carrier's DSH probe succeeds.

The production Tunnel Manager still needs process ownership records, bounded stderr/redaction, state/backoff and candidate-port bind-conflict retries in M1. Stock OpenSSH cannot portably adopt a listener FD reserved by Node, so M1 proves the safety property as “no bind race can produce false readiness,” not literal uninterrupted socket handoff. Cleanup guarantees cover normal disposal and catchable signals; uncatchable termination requires conservative restart behavior rather than guessed process killing.
