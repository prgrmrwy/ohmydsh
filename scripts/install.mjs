#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const action=process.argv[2]??'install'
const directory=process.env.DSH_BIN_DIR||path.join(os.homedir(),'.local/bin')
const link=path.resolve(directory,'dsh')
const target=path.join(repo,'bin/dsh.mjs')
try {
 if(process.platform==='win32') throw new Error('Use npm link (or npm unlink --global ohmydsh) on Windows; this legacy-link compatibility command is POSIX-only')
 if(!['install','uninstall'].includes(action)||process.argv.length>3) throw new Error('Usage: node scripts/install.mjs [install|uninstall]')
 let existing
 try{existing=fs.lstatSync(link)}catch(e){if(e.code!=='ENOENT')throw e}
 if(existing){
  const oldTarget=existing.isSymbolicLink()?path.resolve(path.dirname(link),fs.readlinkSync(link)):''
  const owned=[target,path.join(repo,'bin/dsh')].includes(oldTarget)
  if(!owned)throw new Error('Refusing to replace/remove an unknown dsh command; choose another DSH_BIN_DIR or resolve the conflict manually')
  if(action==='uninstall'){fs.unlinkSync(link);console.log('Removed owned legacy dsh link');process.exit(0)}
  if(oldTarget===target){console.log('Owned dsh link is current');process.exit(0)}
  fs.unlinkSync(link)
 }
 if(action==='install'){fs.mkdirSync(directory,{recursive:true});fs.symlinkSync(path.relative(directory,target),link);console.log('Installed legacy dsh link. Prefer root npm ci followed by npm link for cross-platform installation.')}else console.log('No legacy dsh link installed')
}catch(e){console.error('error: '+e.message);process.exitCode=1}
