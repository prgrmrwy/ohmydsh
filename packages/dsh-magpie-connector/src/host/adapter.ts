import { LlmAdapter, resolveRetryPolicy, isContextWindowExceededError, isQuotaExceededError, CONTEXT_WINDOW_EXCEEDED_CODE, QUOTA_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, type GenerateOptions, type LlmFailure, type PreparedAdapterCall, type StreamChunk, type TokenUsage, type ContentBlock, type AssistantMessage as HarnessAssistantMessage, type ReplayEnvelope } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { createProvider, type Model, type Message, type Usage, type AssistantMessage, type Tool, type ToolCall } from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import * as chat from '@earendil-works/pi-ai/api/openai-completions'
import * as responses from '@earendil-works/pi-ai/api/openai-responses'
import type { MagpieRuntime, Operation } from './runtime.js'
import type { CatalogModel } from './catalog.js'
import { visibleCatalog } from './visibility.js'
import { withDefaultEffort } from './default-effort.js'
const provider = createProvider({ id:'dsh-magpie-connector',auth:{apiKey:{name:'Gateway key',resolve:async()=>undefined}},models:[],api:{'openai-completions':chat,'openai-responses':responses} })
const emptyUsage = (): Usage => ({input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}})
const record = (value:unknown):Record<string,unknown>|undefined => typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:undefined
const blockHash = (block:ContentBlock):string => createHash('sha256').update(JSON.stringify(block.type==='text'||block.type==='reasoning'?[block.type,block.text]:block.type==='tool-call'?[block.type,block.id,block.name,block.arguments]:[block.type])).digest('hex')
function parseArguments(raw:string):ToolCall['arguments'] {
  try {return (record(JSON.parse(raw))??{}) as ToolCall['arguments']} catch {return{}}
}
// Like dsh-llm-pi-ai: only block-aligned native metadata, never a second copy of content.
function replayState(message:AssistantMessage,requestedModel:string,args:Map<number,string>):ReplayEnvelope {
  return {
    response:{kind:'dsh-magpie-connector-pi',version:1,api:message.api,provider:message.provider,model:requestedModel,stopReason:message.stopReason,
      ...(message.responseId!==undefined?{responseId:message.responseId}:{}),...(message.responseModel!==undefined?{responseModel:message.responseModel}:{}),...(message.providerThinkingLevel!==undefined?{providerThinkingLevel:message.providerThinkingLevel}:{})},
    blocks:message.content.map((block,index)=>{
      if(block.type==='text')return{type:'text',hash:blockHash({type:'text',text:block.text}),...(block.textSignature!==undefined?{textSignature:block.textSignature}:{})}
      if(block.type==='thinking')return{type:'reasoning',hash:blockHash({type:'reasoning',text:block.thinking}),...(block.thinkingSignature!==undefined?{thinkingSignature:block.thinkingSignature}:{}),...(block.redacted!==undefined?{redacted:block.redacted}:{})}
      return{type:'tool-call',hash:blockHash({type:'tool-call',id:block.id as never,name:block.name,arguments:args.get(index)??JSON.stringify(block.arguments)}),...(block.thoughtSignature!==undefined?{thoughtSignature:block.thoughtSignature}:{}),...(block.namespace!==undefined?{namespace:block.namespace}:{})}
    }),
  }
}
function restoreAssistant(message:HarnessAssistantMessage,model:Model<string>):AssistantMessage {
  const content=message.content.flatMap((block):AssistantMessage['content']=>{
    if(block.type==='text')return[{type:'text',text:block.text}]
    if(block.type==='reasoning')return[{type:'thinking',thinking:block.text}]
    if(block.type==='tool-call')return[{type:'toolCall',id:block.id,name:block.name,arguments:parseArguments(block.arguments)}]
    return[]
  })
  // Same-route tool ids already belong to DSH content, even when no replay was stored.
  const fallback:AssistantMessage={role:'assistant',api:message.source.provider===model.provider&&message.source.model===model.id?model.api:'dsh-foreign',provider:message.source.provider,model:message.source.model,content:content.map(block=>block.type==='thinking'?{type:'text',text:block.thinking}:block),usage:emptyUsage(),stopReason:content.some(block=>block.type==='toolCall')?'toolUse':'stop',timestamp:0}
  const envelope=record(message.source.replayState),response=record(envelope?.response),blocks=envelope?.blocks
  if(response?.kind!=='dsh-magpie-connector-pi'||response.version!==1||typeof response.api!=='string'||!response.api||response.provider!==message.source.provider||response.model!==message.source.model||!['stop','length','toolUse'].includes(String(response.stopReason))||!Array.isArray(blocks)||blocks.length!==message.content.length)return fallback
  for(const key of ['responseId','responseModel','providerThinkingLevel'])if(response[key]!==undefined&&typeof response[key]!=='string')return fallback
  const metadata=blocks.map(record)
  for(const [index,block]of message.content.entries()){
    const meta=metadata[index]
    // A reasoning signature may contain old summary text; edits must invalidate it too.
    if(!meta||!['text','reasoning','tool-call'].includes(block.type)||meta.type!==block.type||meta.hash!==blockHash(block))return fallback
    for(const key of ['textSignature','thinkingSignature','thoughtSignature','namespace'])if(meta[key]!==undefined&&typeof meta[key]!=='string')return fallback
    if(meta.redacted!==undefined&&typeof meta.redacted!=='boolean')return fallback
  }
  return{...fallback,api:response.api,stopReason:response.stopReason as AssistantMessage['stopReason'],
    ...(typeof response.responseId==='string'?{responseId:response.responseId}:{}),...(typeof response.responseModel==='string'?{responseModel:response.responseModel}:{}),...(typeof response.providerThinkingLevel==='string'?{providerThinkingLevel:response.providerThinkingLevel}:{}),
    content:content.map((block,index)=>{
      const meta=metadata[index]!
      if(block.type==='text')return{...block,...(typeof meta.textSignature==='string'?{textSignature:meta.textSignature}:{})}
      if(block.type==='thinking')return{...block,...(typeof meta.thinkingSignature==='string'?{thinkingSignature:meta.thinkingSignature}:{}),...(typeof meta.redacted==='boolean'?{redacted:meta.redacted}:{})}
      return{...block,...(typeof meta.thoughtSignature==='string'?{thoughtSignature:meta.thoughtSignature}:{}),...(typeof meta.namespace==='string'?{namespace:meta.namespace}:{})}
    })}
}
/** Any byte from the gateway (headers, SSE events, heartbeats) proves liveness; only silence this long times out. */
export const STREAM_IDLE_TIMEOUT_MS = 300_000
/**
 * Same shape as dsh-plugin-subscriptions: Magpie fronts subscription upstreams
 * that shed load in bursts, so ten retries from 1s doubling to 60s with 20%
 * jitter. DSH's llm-retry plugin executes it for the canonical retryable codes.
 */
export const RETRY_POLICY = resolveRetryPolicy({ mode: 'normal', maxRetries: 10, backoff: { initialDelayMs: 1000, maxDelayMs: 60_000, jitterRatio: 0.2 } }, 'dsh-magpie-connector retryPolicy')
type HttpFailure = { status: number; retryAfterMs?: number }
function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')?.trim()
  if (!raw) return undefined
  const seconds = Number(raw)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}
/** Map a gateway failure onto the provider-neutral codes DSH's retry policy routes on. */
export function classifyFailure(message: string, http?: HttpFailure): LlmFailure {
  const status = http?.status
  const extra = { ...(status !== undefined ? { status } : {}), ...(http?.retryAfterMs !== undefined ? { providerRetryAfterMs: http.retryAfterMs } : {}) }
  let code: string
  if (status === 401 || status === 403) code = 'AUTH'
  else if (status === 429) code = 'RATE_LIMIT'
  else if (isContextWindowExceededError(message)) code = CONTEXT_WINDOW_EXCEEDED_CODE
  else if (isQuotaExceededError(message)) code = QUOTA_EXCEEDED_CODE
  else if (status === 408 || status === 504) code = 'TIMEOUT'
  else if (status !== undefined && status >= 500) code = 'SERVER'
  else if (status !== undefined) code = `HTTP_${status}`
  else if (message === 'MAGPIE_STREAM_TRUNCATED') code = 'TRANSPORT'
  else if (message.startsWith('MAGPIE_')) code = message
  else if (/\b5\d\d\b|server_error|overloaded|internal server error/i.test(message)) code = 'SERVER'
  else if (/\btimed?\s*out\b|timeout/i.test(message)) code = 'TIMEOUT'
  else if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b|other side closed|terminated|premature close|stream ended (?:before|without)/i.test(message)) code = 'TRANSPORT'
  else code = 'MAGPIE_GENERATION_FAILED'
  return { code, message, ...extra }
}
export function mapUsage(u: Usage): TokenUsage {
  return {inputTokens:u.input,outputTokens:u.output,...(u.cacheRead>0?{cacheReadTokens:u.cacheRead}:{}),...(u.cacheWrite>0?{cacheWriteTokens:u.cacheWrite}:{}),...(u.input>0?{totalTokens:u.input+u.cacheRead+u.cacheWrite+u.output}:{})}
}
export class MagpieAdapter extends LlmAdapter {
  constructor(readonly runtime: MagpieRuntime, readonly attachments?: Pick<AttachmentStore, 'readImage' | 'imageHostPath'>, readonly isFast = (_session: string) => false) { super() }
  override providerInfo() { return {id:'dsh-magpie-connector',name:'Magpie'} }
  override providerRetryPolicy() { return RETRY_POLICY }
  override async listModels() { const op=await this.runtime.beginOperation(); try {return structuredClone(visibleCatalog(op.gen.catalog,this.runtime.store.value.visibleModels).map(m=>withDefaultEffort(m,this.runtime.store.value.defaultEfforts)))} finally {op.release()} }
  override async resolveModel(_provider:string,id:string) {
    const op=await this.runtime.beginOperation()
    try {
      const entry=op.gen.catalog.find(m=>m.info.id===id)
      return structuredClone(entry?withDefaultEffort(entry,this.runtime.store.value.defaultEfforts):{provider:'dsh-magpie-connector',id,name:id})
    } finally {op.release()}
  }
  override async prepareCall(_provider: string, id: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const op=await this.runtime.beginOperation()
    const entry=structuredClone(op.gen.catalog.find(m=>m.info.id===id)??{info:{provider:'dsh-magpie-connector',id,name:id,inputModalities:['text']},provider:id.split('/')[0]!,efforts:[],nativeEndpoints:[],serviceTiers:[]}) as CatalogModel
    entry.info=withDefaultEffort(entry,this.runtime.store.value.defaultEfforts)
    // Prepared objects may be abandoned by SDK validation; retain only while dispatched.
    op.release()
    const untrack=this.runtime.trackPrepared(op)
    signal?.addEventListener('abort',untrack,{once:true})
    if(signal?.aborted)untrack()
    let used=false
    return {model:structuredClone(entry.info),stream:options=>{
      if(used) return this.failure('INVALID_PREPARED_CALL')
      used=true
      const capturedOptions=signal?{...options,signal:AbortSignal.any([signal,...(options.signal?[options.signal]:[])])}:options
      return this.dispatch(op,entry,capturedOptions,()=>{untrack();signal?.removeEventListener('abort',untrack)})
    }}
  }
  private async *failure(message:string):AsyncIterable<StreamChunk>{yield{type:'finish',reason:{kind:'error',failure:classifyFailure(message)}}}
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {const prepared=await this.prepareCall(options.provider,options.model);yield* prepared.stream(options)}
    catch(error){yield* this.failure(this.runtime.redact(error instanceof Error?error.message:String(error)))}
  }
  private async context(options:GenerateOptions,model:Model<string>):Promise<ReturnType<typeof normalizeContext>> {
    const messages:Message[]=[]
    for(const message of options.messages){
      if(message.role==='system'||message.role==='developer'){
        messages.push({role:'system',content:message.content.flatMap(b=>b.type==='text'?[b.text]:[]).join('\n'),timestamp:0});continue
      }
      if(message.role==='assistant'){messages.push(restoreAssistant(message,model));continue}
      const content:({type:'text';text:string}|{type:'image';data:string;mimeType:string})[]=[]
      for(const block of message.content){
        if(block.type==='text')content.push({type:'text',text:block.text})
        else if(block.type==='image'){
          if(block.offloaded){content.push({type:'text',text:`[Image ${block.attachment.name??block.attachment.attachmentId} offloaded: ${this.attachments?.imageHostPath(block.attachment)??'unavailable'}]`});continue}
          if(!model.input.includes('image'))throw new Error('MAGPIE_IMAGE_UNSUPPORTED')
          if(!this.attachments)throw new Error('MAGPIE_ATTACHMENT_UNAVAILABLE')
          const image=await this.attachments.readImage(block.attachment,options.signal)
          content.push({type:'image',mimeType:image.ref.mediaType,data:Buffer.from(image.data).toString('base64')})
        }
      }
      if(message.role==='tool')messages.push({role:'toolResult',toolCallId:message.toolCallId,toolName:'',content,isError:message.isError??false,timestamp:0})
      else messages.push({role:'user',content,timestamp:0})
    }
    return normalizeContext({messages,...(options.system?{systemPrompt:options.system}:{}),...(options.tools?{tools:options.tools as Tool[]}: {})})
  }
  private async *dispatch(op:Operation,entry:CatalogModel,options:GenerateOptions,untrack=()=>{}):AsyncIterable<StreamChunk>{
    const releaseKey=this.runtime.retainIdentity(op)
    const controller=new AbortController()
    const signal=AbortSignal.any([controller.signal,this.runtime.transport.signal.signal,...(options.signal?[options.signal]:[])])
    let timer:ReturnType<typeof setTimeout>|undefined,timedOut=false,http:HttpFailure|undefined
    const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort()},STREAM_IDLE_TIMEOUT_MS)}
    const timeout=():LlmFailure=>({code:'TIMEOUT',message:`MAGPIE_STREAM_TIMEOUT: no data from the gateway for ${STREAM_IDLE_TIMEOUT_MS/1000}s`})
    try{
      if(!op.key||!op.gen.baseUrl)throw new Error('MAGPIE_NOT_CONFIGURED')
      if(options.stop?.length)throw new Error('MAGPIE_STOP_UNSUPPORTED')
      const api=entry.nativeEndpoints.includes('/v1/responses')?'openai-responses':'openai-completions'
      const model:Model<'openai-completions'|'openai-responses'>={id:entry.info.id,name:entry.info.name,provider:'dsh-magpie-connector',api,baseUrl:op.gen.baseUrl,reasoning:entry.efforts.length>0,thinkingLevelMap:{off:null,...Object.fromEntries(entry.efforts.map(e=>[e,e]))},input:entry.info.inputModalities?.includes('image')?['text','image']:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:entry.info.context?.contextWindow??128000,maxTokens:entry.outputLimit??16384,
        compat:{supportsFinishReason:true,thinkingFormat:'openai',maxTokensField:'max_completion_tokens',...(api==='openai-responses'?{supportsStrictMode:true}:{})} as never}
      const context=await this.context(options,model)
      const fast=!!options.sessionId&&this.isFast(options.sessionId)&&entry.serviceTiers.includes('priority')
      arm()
      const gatewayFetch=this.runtime.transport.fetchFor(op)
      // One attempt per call: DSH's llm-retry owns retries (see RETRY_POLICY), so nothing is replayed here.
      const watchedFetch:typeof fetch=async(input,init)=>{
        const response=await gatewayFetch(input,init)
        arm()
        if(!response.ok){http={status:response.status,...(retryAfterMs(response)!==undefined?{retryAfterMs:retryAfterMs(response)!}:{})};return response}
        if(!response.body)return response
        const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,out){arm();out.enqueue(chunk)}}))
        return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers})
      }
      const events=provider.stream(model,context,{apiKey:op.key,fetch:watchedFetch,signal,maxRetries:0,
        ...(options.maxTokens!==undefined?{maxTokens:options.maxTokens}:{}),...(options.temperature!==undefined?{temperature:options.temperature}:{}),
        ...(options.reasoningEffort?{reasoningEffort:options.reasoningEffort}:{}),...(fast?{serviceTier:'priority',onPayload:(payload:unknown)=>{(payload as Record<string,unknown>).service_tier='priority'}}:{}),
      } as never)
      const args=new Map<number,string>()
      for await(const event of events){
        if(event.type==='text_start'||event.type==='thinking_start'||event.type==='toolcall_start')yield{type:'block-start',index:event.contentIndex,blockType:event.type==='text_start'?'text':event.type==='thinking_start'?'reasoning':'tool-call'}
        else if(event.type==='text_delta')yield{type:'text-delta',index:event.contentIndex,text:event.delta}
        else if(event.type==='thinking_delta')yield{type:'reasoning-delta',index:event.contentIndex,text:event.delta}
        else if(event.type==='toolcall_delta'){
          args.set(event.contentIndex,(args.get(event.contentIndex)??'')+event.delta)
          const tool=event.partial.content[event.contentIndex]
          if(tool?.type==='toolCall')yield{type:'tool-call-delta',index:event.contentIndex,id:tool.id as never,name:tool.name,argumentsDelta:event.delta}
        }
        else if(event.type==='text_end'||event.type==='thinking_end')yield{type:'block-end',index:event.contentIndex,block:event.type==='text_end'?{type:'text',text:event.content}:{type:'reasoning',text:event.content}}
        else if(event.type==='toolcall_end')yield{type:'block-end',index:event.contentIndex,block:{type:'tool-call',id:event.toolCall.id as never,name:event.toolCall.name,arguments:args.get(event.contentIndex)??JSON.stringify(event.toolCall.arguments)}}
        else if(event.type==='done'){
          yield{type:'usage',usage:mapUsage(event.message.usage)}
          // A clean stop with nothing in it would silently end the turn; report it so DSH can retry.
          if(event.reason==='stop'&&event.message.content.length===0){yield{type:'finish',reason:{kind:'error',failure:{code:EMPTY_RESPONSE_CODE,message:'MAGPIE_EMPTY_RESPONSE'}}};return}
          yield{type:'finish',reason:{kind:event.reason==='length'?'max-tokens':event.reason==='toolUse'?'tool-calls':'stop'},replayState:replayState(event.message,entry.info.id,args)};return
        }else if(event.type==='error'){
          yield{type:'usage',usage:mapUsage(event.error.usage)}
          const message=this.runtime.redact(event.error.errorMessage??'MAGPIE_GENERATION_FAILED')
          if(signal.aborted&&!timedOut){yield{type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message}}};return}
          yield{type:'finish',reason:{kind:'error',failure:timedOut?timeout():classifyFailure(message,http)}};return
        }
      }
      throw new Error('MAGPIE_STREAM_TRUNCATED')
    }catch(error){
      const message=this.runtime.redact(error instanceof Error?error.message:String(error))
      if(signal.aborted&&!timedOut){yield{type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message}}};return}
      yield{type:'finish',reason:{kind:'error',failure:timedOut?timeout():classifyFailure(message,http)}}
    }
    finally{clearTimeout(timer);controller.abort();releaseKey();untrack();op.release()}
  }
}
