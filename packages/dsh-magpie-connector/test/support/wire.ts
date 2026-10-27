export const models = { data: [
  { id: 'codex/gpt-6.1-sol', owned_by:'codex', reasoning_levels:['none','high'], native_endpoints:['/v1/responses'], modalities:{input:['text','image']}, service_tiers:[{id:'priority'}] },
  { id: 'deepseek/deepseek-flash', owned_by:'deepseek', reasoning_levels:['none','high'], native_endpoints:[] },
  { id:'claude/claude-haiku-5-5',modalities:{input:['image','text']} },
] }
export const chatText = (text='hi', usage: unknown={prompt_tokens:1000,prompt_tokens_details:{cached_tokens:600,cache_write_tokens:50},completion_tokens:20}, finish='stop') => [
 {id:'r1',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]},
 {id:'r1',choices:[{index:0,delta:{},finish_reason:finish}]}, {id:'r1',choices:[],usage}, '[DONE]',
]
export const responseText = (text='hi',usage:unknown={input_tokens:1000,input_tokens_details:{cached_tokens:600,cache_write_tokens:50},output_tokens:20},status='completed') => [
 {type:'response.created',response:{id:'r1',status:'in_progress'}},
 {type:'response.output_item.added',output_index:0,item:{type:'message',id:'msg_1',role:'assistant',content:[]}},
 {type:'response.output_text.delta',output_index:0,content_index:0,delta:text},
 {type:'response.output_item.done',output_index:0,item:{type:'message',id:'msg_1',role:'assistant',content:[{type:'output_text',text}]}},
 {type:status==='incomplete'?'response.incomplete':'response.completed',response:{id:'r1',status,output:[],usage,...(status==='incomplete'?{incomplete_details:{reason:'max_output_tokens'}}:{})}},
]
export const chatTool = () => [
 {id:'r1',choices:[{index:0,delta:{tool_calls:[{index:0,id:'c1',type:'function',function:{name:'read_file',arguments:'{ "path": "a" }'}}]},finish_reason:null}]},
 {id:'r1',choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}, '[DONE]',
]
export const responseTool = () => [
 {type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'fc_1',call_id:'c1',name:'read_file',arguments:''}},
 {type:'response.function_call_arguments.delta',output_index:0,delta:'{ "path": "a" }'},
 {type:'response.output_item.done',output_index:0,item:{type:'function_call',id:'fc_1',call_id:'c1',name:'read_file',arguments:'{ "path": "a" }'}},
 {type:'response.completed',response:{id:'r1',status:'completed',output:[]}},
]
