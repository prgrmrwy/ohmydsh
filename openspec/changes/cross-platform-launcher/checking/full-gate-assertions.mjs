export function assertSecondBuildNoop(result) {
  const stdout = result.stdout || ''
  if (result.status !== 0 || !stdout.includes('[sync] no changes — deployment already matches manifest') || /\[sync\] done — \d+ change\(s\) applied/.test(stdout)) {
    throw new Error('second build is not proven idempotent: expected sync no-changes report')
  }
}
