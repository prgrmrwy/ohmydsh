// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, fakeApi, flush, inputValue, ok, settingsView } from './client-support/fake-api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('Access inputs are optional passwords, submit only typed values and clear after save', async () => {
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const access={clientId:{configured:true,writable:true},clientSecret:{configured:true,writable:true}}
 const fake=fakeApi({'GET settings':()=>ok(settingsView({access})), 'GET cards':()=>ok({status:'ok',cards:[]}), 'POST settings':()=>ok(settingsView({access}))})
 try {
  await act(async()=>root.render(h(MagpieSettings,{api:fake.api})));await flush()
  const inputs=Array.from(host.querySelectorAll('label')).filter(l=>l.textContent?.startsWith('Access ')).map(l=>l.querySelector('input')!)
  expect(inputs).toHaveLength(2);for(const i of inputs){expect(i.type).toBe('password');expect(i.value).toBe('')}
  act(()=>{inputValue(inputs[0]!, 'typed-id');inputValue(inputs[1]!, 'typed-secret')})
  await act(async()=>buttonByText(host,'保存')!.click());await flush()
  expect(fake.calls.find(c=>c.method==='POST'&&c.path==='settings')?.body).toEqual({accessClientId:'typed-id',accessClientSecret:'typed-secret'})
  expect(inputs.map(i=>i.value)).toEqual(['','']);expect(host.textContent).not.toContain('typed-secret')
  const mode=host.querySelector('select[aria-label="接入方式"]') as HTMLSelectElement
  expect(mode.value).toBe('cloudflare');expect(host.querySelector('[data-advanced]')?.hasAttribute('open')).toBe(true)
  act(()=>{mode.value='direct';mode.dispatchEvent(new Event('change',{bubbles:true}))})
  expect(Array.from(host.querySelectorAll('label')).filter(l=>l.textContent?.startsWith('Access '))).toHaveLength(0)
  expect(host.textContent).toContain('保存后将清除')
  await act(async()=>buttonByText(host,'保存')!.click());await flush()
  expect(fake.calls.filter(c=>c.method==='POST').at(-1)?.body).toEqual({accessClientId:null,accessClientSecret:null})
 }finally{act(()=>root.unmount());host.remove()}
})

test('environment-owned Access fields cannot be edited or cleared',async()=>{
 const host=document.createElement('div');const root=createRoot(host)
 const fake=fakeApi({'GET settings':()=>ok(settingsView({access:{clientId:{configured:true,writable:false},clientSecret:{configured:true,writable:true}}})), 'GET cards':()=>ok({status:'ok',cards:[]})})
 try{
  await act(async()=>root.render(h(MagpieSettings,{api:fake.api})));await flush()
  const label=Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Access Client ID'))!
  expect(label.querySelector('input')!.disabled).toBe(true)
  expect((host.querySelector('select[aria-label="接入方式"]') as HTMLSelectElement).disabled).toBe(true)
 }finally{act(()=>root.unmount())}
})

test('direct is the default mode: no Access fields until Cloudflare Access is chosen', async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  const fake=fakeApi({'GET settings':()=>ok(settingsView()), 'GET cards':()=>ok({status:'ok',cards:[]}), 'POST settings':()=>ok(settingsView())})
  try{
    await act(async()=>root.render(h(MagpieSettings,{api:fake.api})));await flush()
    const mode=host.querySelector('select[aria-label="接入方式"]') as HTMLSelectElement
    expect(mode.value).toBe('direct');expect(Array.from(mode.options).map(o=>o.textContent)).toEqual(['直连','Cloudflare Access'])
    expect(host.querySelectorAll('input[type=password]')).toHaveLength(1)
    expect(buttonByText(host,'保存')!.disabled).toBe(true)
    act(()=>{mode.value='cloudflare';mode.dispatchEvent(new Event('change',{bubbles:true}))})
    const inputs=Array.from(host.querySelectorAll('label')).filter(l=>l.textContent?.startsWith('Access ')).map(l=>l.querySelector('input')!)
    expect(inputs).toHaveLength(2)
    act(()=>{inputValue(inputs[0]!,'id');inputValue(inputs[1]!,'secret')})
    await act(async()=>buttonByText(host,'保存')!.click());await flush()
    expect(fake.calls.find(c=>c.method==='POST')?.body).toEqual({accessClientId:'id',accessClientSecret:'secret'})
  }finally{act(()=>root.unmount());host.remove()}
})
