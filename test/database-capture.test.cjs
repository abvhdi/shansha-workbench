const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=n=>fs.readFileSync(__dirname+'/../src/'+n,'utf8');
test('capture uses existing database conversation, preserves draft, stages source without sending',async()=>{
 let draft='我原本的草稿',created=0,released=0,opened=0;
 const input={snapshot:{phase:'idle',get draft(){return draft;}},actions:{setDraft:v=>draft=v}};
 const ctx={sessions:{create:()=>created++,retain:()=>({ready:Promise.resolve({ctx:{},session:{getSnapshot:()=>({openState:'open'})}}),release:()=>released++})},remote:{session:{rename:async()=>({ok:true})}},get:()=>({input:{for:()=>input}})};
 const v=vm.createContext({ctx,repo:{getSetting:async()=>null},setTimeout,clearTimeout,console});
 vm.runInContext(source('core.js')+'\n'+source('selection.js')+'\n'+source('bridge.js')+';globalThis.bridge=new HarnessBridge(ctx,repo)',v);
 v.bridge.nativeCall=async()=>({sessionId:'existing'});v.bridge.revealSession=id=>assert.equal(id,'existing');v.bridge.openDatabasePanel=async()=>opened++;
 await v.bridge.openDatabase({text:'客户：星海，电话123',source:{taskId:'t1'}});
 assert.equal(created,0);assert.equal(released,1);assert.equal(opened,1);assert.ok(draft.startsWith('我原本的草稿'));assert.match(draft,/星海/);assert.match(draft,/t1/);assert.match(draft,/等待我在右侧修改预览确认/);
 const first=draft;await v.bridge.openDatabase({text:'客户：星海，电话123',source:{taskId:'t1'}});assert.equal(draft,first);
});
test('selection installer scopes workbench and does not intercept password or external text',()=>{
 const listeners={},doc={addEventListener:(k,fn)=>listeners[k]=fn,removeEventListener:k=>delete listeners[k],defaultView:{addEventListener(){},removeEventListener(){}}};
 const v=vm.createContext({doc});vm.runInContext(source('selection.js')+';globalThis.off=installDatabaseSelectionMenu({},doc)',v);
 const event=target=>({target,preventDefault(){throw Error('must not intercept');}});
 listeners.contextmenu(event({closest:()=>null}));
 listeners.contextmenu(event({closest:s=>s==='.swb'?{}:s==='input,textarea'?{tagName:'INPUT',type:'password',selectionStart:0,selectionEnd:5,value:'secret'}:null}));
 v.off();assert.equal(Object.keys(listeners).length,0);
});
