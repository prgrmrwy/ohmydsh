import test from 'node:test'
import assert from 'node:assert/strict'
import {acceptanceStatus} from '../scripts/launcher/acceptance.mjs'

test('test_full_manifest_failure_blocks_support_claim',()=>{
 const green={contracts:true,terminalClose:true,buildFirst:true,buildSecondNoop:true,dump:true,hostReady:true,hostStop:true}
 const accepted=acceptanceStatus({linux:green,win32:green,darwin:green})
 assert.equal(accepted.complete,true)
 for(const platform of ['linux','win32','darwin'])for(const key of Object.keys(green)){
  const report={linux:green,win32:green,darwin:green,[platform]:{...green,[key]:false}}
  const status=acceptanceStatus(report)
  assert.equal(status.complete,false)
  assert.equal(status.fullWindowsSupport,false)
  assert.ok(status.missing.includes(`${platform}.${key}`))
 }
 const missing=acceptanceStatus({linux:green})
 assert.equal(missing.complete,false)
 assert.equal(missing.fullWindowsSupport,false)
})
