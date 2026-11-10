const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../src/task-link-cards.js','utf8');
test('session header opens only live linked tasks without model or chat calls',async()=>{
 let opened=[],state={tasks:[{id:'a',title:'报价',sessionId:'s'},{id:'deleted',sessionId:'s',deletedAt:1},{id:'note',sessionId:'s',kind:'record'},{id:'other',sessionId:'x'}]};
 const model={snapshot:()=>state,subscribe(){},refresh:async()=>{},openTaskFromChat:async id=>opened.push(id)};
 const v=vm.createContext({React:{useSyncExternalStore:(_s,get)=>get(),useState:init=>[init,()=>{}],useEffect(){}},h:(tag,props,...children)=>({tag,props,children})});vm.runInContext(source+';globalThis.Header=LinkedTaskHeader;globalThis.install=installLinkedTaskHeader',v);
 const row=v.Header({sessionId:'s',model});assert.equal(row.children[0].tag,'button');await row.children[0].props.onClick();assert.deepEqual(opened,['a']);assert.equal(v.Header({sessionId:'x-missing',model}),null);
 state.tasks.push({id:'b',title:'合同',sessionId:'s'});assert.equal(v.Header({sessionId:'s',model}).children[0].tag,'details');state.tasks=[];assert.equal(v.Header({sessionId:'s',model}),null);
 let registered;v.install({slots:{inject:(_n,fn)=>fn(),register:(opts,component)=>{registered={opts,component};}}},model);assert.equal(registered.opts.name,'conversation.session.header.actions');assert.equal(registered.opts.inject().model,model);
});
