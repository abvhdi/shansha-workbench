const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../src/'+n+'.js'),'utf8');
test('natural reminder validation leaves missing time empty and rejects invalid model dates',()=>{
 const c=vm.createContext({});vm.runInContext(read('core')+';globalThis.api={hasNaturalReminder,validateNaturalTask};',c);const a=c.api;
 assert.equal(a.hasNaturalReminder('整理客户资料'),false);assert.equal(a.hasNaturalReminder('整理周报'),false);assert.equal(a.hasNaturalReminder('周四去报价'),true);
 assert.equal(a.validateNaturalTask({title:'去报价',hasReminder:true,date:'2026-10-29',time:null}).time,'');
 assert.throws(()=>a.validateNaturalTask({title:'去报价',hasReminder:true,date:'2026-02-30',time:'15:00'}),/日期/);
 assert.throws(()=>a.validateNaturalTask({title:'去报价',hasReminder:true,time:'25:00'}),/时间/);
 assert.throws(()=>a.validateNaturalTask({title:'去报价',hasReminder:true,unsupported:true}),/一次提醒/);
});
test('quick entry saves plain text without AI; dated input waits for an explicit time and confirmation',async()=>{
 let hooks=[],index=0,calls=0,added=[];const model={repo:{add:async t=>added.push(t),getSetting:async()=>0},refresh:async()=>{},bridge:{nativeCall:async()=>{calls++;return {title:'去报价',hasReminder:true,date:'2099-10-29',time:null};}}};
 const React={memo:f=>f,useState:v=>{const i=index++;if(!(i in hooks))hooks[i]=v;return [hooks[i],next=>hooks[i]=next];},useRef:()=>({current:null})};
 const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)}),c=vm.createContext({React,h,crypto:{randomUUID:()=>String(added.length+1)}});vm.runInContext(read('core')+'\n'+read('ui')+';globalThis.Quick=QuickTaskCreate;',c);
 const render=()=>{index=0;return c.Quick({model,onCreated:()=>{}});},find=(root,predicate)=>{if(!root||typeof root!=='object')return;return predicate(root)?root:root.children?.map(x=>find(x,predicate)).find(Boolean);},event={preventDefault(){}};
 let tree=render();find(tree,n=>n.props['aria-label']==='新待办标题').props.onChange({target:{value:'整理资料'}});tree=render();await find(tree,n=>n.tag==='form').props.onSubmit(event);assert.equal(calls,0);assert.equal(added[0].title,'整理资料');
 tree=render();find(tree,n=>n.props['aria-label']==='新待办标题').props.onChange({target:{value:'周四去报价'}});tree=render();await find(tree,n=>n.tag==='form').props.onSubmit(event);assert.equal(calls,1);assert.equal(added.length,1);
 tree=render();const time=find(tree,n=>n.props.type==='time');assert.equal(time.props.value,'');assert.equal(time.props.required,true);time.props.onChange({target:{value:'15:00'}});tree=render();await find(tree,n=>n.props['aria-label']==='确认待办和提醒').props.onSubmit(event);assert.equal(added.length,2);assert.equal(added[1].title,'去报价');assert.equal(added[1].reminder.time,'15:00');
});
