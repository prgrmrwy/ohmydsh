import { z } from 'zod'
import type { Selection } from './state.js'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
declare module '@deepseek-ai/dsh-session-projection/types' {
 interface SessionProjectionStateMap { autoRoutingSelection: Selection | null }
}
export const selectionProjection: ProjectionDefinition<'autoRoutingSelection'> = {
 key:'autoRoutingSelection',stateVersion:1,
 stateSchema:z.object({provider:z.string(),model:z.string(),reasoningEffort:z.enum(['low','medium','high','xhigh','max']).optional()}).transform(value => ({provider:value.provider,model:value.model,...(value.reasoningEffort ? {reasoningEffort:value.reasoningEffort} : {})})).nullable(),
 init:()=>null,
 apply:(state,event)=>event.type==='model/selection' ? event.data as Selection : state,
}
