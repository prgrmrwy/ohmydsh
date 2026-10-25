const { isDeepStrictEqual } = require('node:util')
const SCRIPT_FLAGS = Object.freeze(['--global=false', '--location=project', '--strict-allow-scripts=true', '--ignore-scripts=false', '--dangerously-allow-all-scripts=false'])
function validateScriptPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || Object.keys(policy).length === 0) throw new Error('Script policy must contain exact package versions')
  for (const [key, value] of Object.entries(policy)) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(key)) throw new Error(`Script policy requires exact package version: ${key}`)
    if (typeof value !== 'boolean') throw new Error('Script policy values must be boolean')
  }
  return policy
}
function scriptPolicyEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^npm_config_(?:allow_scripts(?:_.*)?|ignore_scripts|dangerously_allow_all_scripts|strict_allow_scripts|global|location|prefix|workspace|workspaces|include_workspace_root)$/i.test(key.replaceAll('-', '_'))))
}
function assertScriptPolicy(pkg, policy) {
  validateScriptPolicy(policy)
  if (!isDeepStrictEqual(pkg.allowScripts, policy)) throw new Error('Cached install script policy differs from repository policy')
}
module.exports = { validateScriptPolicy, scriptPolicyEnv, assertScriptPolicy, SCRIPT_FLAGS }
