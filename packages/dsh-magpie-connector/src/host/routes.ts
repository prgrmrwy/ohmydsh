import type { MagpieRuntime } from './runtime.js'
import { isVisible, validateVisibility } from './visibility.js'
import { updateDefaultEffort } from './default-effort.js'
import { CardsController } from './cards.js'
import { SpeedController } from './speed.js'
import { LatencyController } from './latency.js'
export class SettingsController {
  private pending: Promise<void> = Promise.resolve()
  constructor(readonly runtime:MagpieRuntime) {}
  async handle(body?:unknown):Promise<Response> {
    if (body === undefined) return this.execute()
    const result = this.pending.then(() => this.execute(body))
    this.pending = result.then(() => {}, () => {})
    return result
  }
  private async execute(body?:unknown):Promise<Response> {
    const runtime=this.runtime
    if(body!==undefined) {
      try {
        if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['lines','resync','visibleModels','defaultEffort'].includes(k))) throw new Error('Invalid settings')
        const input=body as Record<string,unknown>
        // Validate the entire union before credentials, disk writes or synchronization.
        if('lines' in input) { if(!Array.isArray(input.lines)) throw new Error('Invalid lines'); if(input.lines.length<1||input.lines.length>5) throw new Error('Invalid lines') }
        if('key' in input && input.key!==null && (typeof input.key!=='string' || !input.key || input.key.length>512 || /\s/.test(input.key))) throw new Error('Invalid API key')
        if('resync' in input && input.resync!==true) throw new Error('Invalid resync')
        const visibleModels='visibleModels' in input ? validateVisibility(input.visibleModels) : undefined
        const defaultEfforts='defaultEffort' in input ? updateDefaultEffort(runtime.store.value.defaultEfforts,input.defaultEffort,runtime.current.catalog) : undefined
        const connection=Object.fromEntries(Object.entries(input).filter(([k])=>['lines','resync'].includes(k)))
        if(Object.keys(connection).length) {const result=await runtime.settings(connection);if(!result.ok)return result}
        if(visibleModels!==undefined || defaultEfforts!==undefined) {
          runtime.savePreferences({ ...(visibleModels===undefined?{}:{visibleModels}), ...(defaultEfforts===undefined?{}:{defaultEfforts}) })
          runtime.publish()
        }
      } catch(error) {return Response.json({error:runtime.redact(error instanceof Error?error.message:String(error))},{status:400})}
    }
    const response=await runtime.settings()
    const view=await response.json() as Record<string,unknown>
    view.groups=[...new Set(runtime.current.catalog.map(m=>m.provider))].map(provider=>({provider,models:runtime.current.catalog.filter(m=>m.provider===provider).map(m=>({id:m.info.id,name:m.info.name,efforts:m.efforts,visible:isVisible(m,runtime.store.value.visibleModels)}))}))
    return Response.json(runtime.redactJson(view))
  }
}
export interface FetchRegistration {
 path:string;methods:('GET'|'POST')[];requestBody:'buffered';fetch:(request:Request)=>Promise<Response>
}
export interface FetchRegistry {register(route:FetchRegistration):()=>void}
/** Register on the injected connection.fetch; caller owns the returned disposer. */
export function registerRoutes(fetch:FetchRegistry,runtime:MagpieRuntime,speed=new SpeedController(),cards=new CardsController(runtime),latency=new LatencyController(()=>runtime.config())) {
 const settings=new SettingsController(runtime)
 const handlers={
  settings:async(request:Request,body:unknown)=>settings.handle(request.method==='POST'?body:undefined),
  cards:async(request:Request,body:unknown)=>request.method==='POST'?cards.refresh(body):cards.get(),
  speed:async(request:Request,body:unknown)=>{
   const session=request.method==='GET'?new URL(request.url).searchParams.get('session'):(body as {session?:unknown}|null)?.session
   if(request.method==='POST') {
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['session','tier'].includes(k))) throw new Error('Invalid speed request')
    speed.set(session,(body as {tier?:unknown}).tier)
   }
   return Response.json(speed.get(session,runtime.current.catalog))
  },
  lineCheck:async(_request:Request,body:unknown)=>runtime.lineCheck(body),
  latency:async(request:Request)=>latency.read(new URL(request.url).searchParams.get('line') ?? undefined),
 }
 /** GET-only latency diagnostics; every other resource keeps the GET/POST surface. */
 const resources=['settings','cards','speed','latency'] as const
 const methodsOf=(resource:typeof resources[number]):('GET'|'POST')[]=>resource==='latency'?['GET']:['GET','POST']
 const disposers:(()=>void)[]=[]
 try {
  for(const resource of resources) disposers.push(fetch.register({path:`/api/dsh-magpie-connector/${resource}`,methods:methodsOf(resource),requestBody:'buffered',fetch:async request=>{
   try {const body=request.method==='POST'?await request.json():undefined;return await handlers[resource](request,body)}
   catch(error) {return Response.json({error:runtime.redact(error instanceof Error?error.message:String(error))},{status:400})}
  }}))
  disposers.push(fetch.register({path:'/api/dsh-magpie-connector/line-check',methods:['POST'],requestBody:'buffered',fetch:async request=>{
   try {return await handlers.lineCheck(request,await request.json())}
   catch(error) {return Response.json({error:runtime.redact(error instanceof Error?error.message:String(error))},{status:400})}
  }}))
 } catch(error) {for(const dispose of disposers.reverse())dispose();throw error}
 let disposed=false
 return {settings,cards,speed,latency,dispose:()=>{if(disposed)return;disposed=true;latency.dispose();for(const dispose of disposers.reverse())dispose()}}
}
