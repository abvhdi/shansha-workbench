const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('AI steps preview waits for confirmation and appends to latest checklist',async()=>{
 let hooks=[],index=0,current={id:'t',title:'整理访谈',description:'提炼客户要求',steps:[]},calls=0;
 const React={memo:f=>f,useEffect:()=>{},useState:v=>{const i=index++;if(!(i in hooks))hooks[i]=v;return [hooks[i],v=>hooks[i]=v];}},h=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)});
 const model={drafts:new Map(),flushDraft:async()=>{},refresh:async()=>{},repo:{list:async()=>[current],update:async(id,fn)=>current={...current,...fn(current)}},bridge:{nativeCall:async(method,args)=>{calls++;assert.equal(method,'shanshaFiles/suggestTaskSteps');assert.equal(args.request.description,'提炼客户要求');return {steps:['阅读访谈','整理结论']};}}};
 const c=vm.createContext({React,h,crypto:require('node:crypto')});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/ui.js'),'utf8')+';globalThis.Steps=StepChecklist',c);
 const render=()=>{index=0;return c.Steps({task:current,model});},find=(n,text)=>n&&typeof n==='object'?(n.tag==='button'&&n.children.includes(text)?n:n.children?.map(x=>find(x,text)).find(Boolean)):null;
 await find(render(),'AI 生成').props.onClick();assert.equal(calls,1);assert.equal(current.steps.length,0);
 current.steps=[{id:'manual',text:'阅读访谈',done:true}];await find(render(),'加入清单').props.onClick();assert.equal(current.steps.length,2);assert.equal(current.steps[0].done,true);assert.equal(current.steps[1].text,'整理结论');assert.equal(find(render(),'加入清单'),undefined);
});
