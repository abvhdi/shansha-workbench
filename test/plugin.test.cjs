const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('opening a saved file bypasses unrelated synchronization and cached blob reads',async()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+';globalThis.Bridge=HarnessBridge;',context);
 const bridge=new context.Bridge({}, {material:()=>{throw Error('must not load blob');}});bridge.localSync=new Promise(()=>{});bridge.saveLocal=()=>{throw Error('must not save before open');};let calls=0;
 bridge.nativeCall=async(method,args)=>{calls++;assert.equal(method,'shanshaFiles/open');assert.equal(args.request.fileId,'video');return {opened:true};};assert.equal((await bridge.openMaterial({id:'video'})).opened,true);assert.equal(calls,1);
});
test('built bundle registers main panel, sidebar entry and cleans up',async()=>{
  let api;const registry=[],effects=[],removed=[];
  const context=vm.createContext({clearTimeout,window:{__ModuleLoader__:{load:row=>{assert.equal(row.id,'shansha-workbench');api=row.factory(name=>{assert.equal(name,'react');return {createElement:()=>null,memo:fn=>fn};});}}},console,indexedDB:{},BroadcastChannel:undefined,document:{addEventListener:()=>{},removeEventListener:()=>{},createElement:()=>({dataset:{},remove:()=>removed.push('style')}),head:{appendChild:()=>{}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../lib/client.js'),'utf8'),context);
  let selected;
  api.apply({effect:fn=>effects.push(fn()),slots:{inject:(name,fn)=>{fn();},register:options=>{registry.push(options);return()=>{};}},layout:{selectPanel:id=>{selected=id;}}});
  assert.equal(selected,'shansha-workbench');
  assert.ok(registry.some(r=>r.name==='main'&&r.key==='shansha-workbench'));
  assert.ok(registry.some(r=>r.name==='sidebar.panellist'&&r.label()==='待办工作台'));
  await Promise.all(effects.map(fn=>fn()));assert.deepEqual(removed,['style']);
});
test('locked composer refuses handoff and always releases reference',async()=>{
  let released=0,drafts=0;
  const ctx={sessions:{retain:()=>({ready:Promise.resolve({ctx:{},session:{getSnapshot:()=>({openState:'ready'})}}),release:()=>released++})},get:()=>({input:{for:()=>({snapshot:{phase:'submitting'}})},createDrafts:()=>{drafts++;}})};
  const context=vm.createContext({console,File:globalThis.File});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+'\nglobalThis.Bridge=HarnessBridge;',context);
  const bridge=new context.Bridge(ctx,{});
  await assert.rejects(bridge.prepare({id:'t',sessionId:'existing'},[]),/正在提交/);
  assert.equal(released,1);assert.equal(drafts,0);assert.equal(bridge.busy.size,0);
});


test('optional workspace capability getter failure is isolated',()=>{
 const context=vm.createContext({console:{warn:()=>{}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+'\nglobalThis.Bridge=HarnessBridge;',context);
 const remote={};Object.defineProperty(remote,'workspaceFiles',{get(){throw new Error('service unavailable');}});
 assert.equal(new context.Bridge({remote},{}).outputsAvailable(),false);
 assert.equal(new context.Bridge({remote:{workspaceFiles:{}}},{}).outputsAvailable(),false);
 assert.equal(new context.Bridge({remote:{workspaceFiles:{list(){},readBytes(){}}}},{}).outputsAvailable(),true);
});

test('opening a copied material saves locally and opens through the desktop API',async()=>{
 const sandbox=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+'\nglobalThis.Bridge=HarnessBridge;',sandbox);
 let opened;const repo={list:async()=>[{id:'t',sessionId:'s'}],projects:async()=>[],allMaterials:async()=>[{id:'f',taskId:'t',name:'a.md'}]};const ctx={remote:{session:{openWorkspacePath:async request=>{opened=request;return {ok:true,value:{opened:true}};}}}};
 const bridge=new sandbox.Bridge(ctx,repo);bridge.saveLocal=async()=> 'C:/work/a.md';bridge.nativeCall=async(method,args)=>{assert.equal(method,'shanshaFiles/open');assert.equal(args.request.fileId,'f');opened={path:'C:/work/a.md',action:'open'};return {opened:true};};await bridge.openMaterial({id:'f'});assert.equal(opened.path,'C:/work/a.md');assert.equal(opened.action,'open');
});

test('bridge has no duplicate methods that silently override repairs',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8'),names=[...source.matchAll(/^  (?:async )?(\w+)\(/gm)].map(m=>m[1]);assert.equal(new Set(names).size,names.length);
});

test('local sync handles only changed tasks, deletes removed files, and retries failures',async()=>{
 const context=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+';globalThis.Bridge=HarnessBridge;',context);
 let allReads=0,fail=false;const files=[{id:'a',taskId:'t',hash:'1',size:1,name:'a'},{id:'b',taskId:'u',hash:'1',size:1,name:'b'}];
 const repo={localDirtyTasks:new Set(),list:async()=>[{id:'t',title:'T'},{id:'u',title:'U'}],projects:async()=>[],allMaterials:async()=>{allReads++;return files;},materials:async id=>files.filter(f=>f.taskId===id)};
 const bridge=new context.Bridge({},repo),saved=[],calls=[];bridge.saveLocal=async m=>{if(fail)throw Error('offline');saved.push(m.id);};bridge.nativeCall=async(method,args)=>calls.push([method,args]);
 await bridge.syncLocal(repo);assert.deepEqual(saved,['a','b']);assert.equal(allReads,1);
 saved.length=0;await bridge.syncLocal(repo);assert.equal(allReads,1);assert.equal(saved.length,0);
 files[0].hash='2';repo.localDirtyTasks.add('t');fail=true;await assert.rejects(bridge.syncLocal(repo),/offline/);assert.ok(repo.localDirtyTasks.has('t'));
 fail=false;bridge.localFailures.get('a').retryAt=0;await bridge.syncLocal(repo);assert.deepEqual(saved,['a']);assert.equal(allReads,1);
 files.shift();repo.localDirtyTasks.add('t');await bridge.syncLocal(repo);assert.equal(calls.at(-1)[0],'shanshaFiles/remove');assert.equal(calls.at(-1)[1].request.ids[0],'a');
 bridge.saveLocal=async m=>{saved.push(m.id);if(m.hash==='2'){files[0].hash='3';repo.localDirtyTasks.add('u');}};
 files[0].hash='2';repo.localDirtyTasks.add('u');await bridge.syncLocal(repo);assert.equal(bridge.localSaved.get('b').signature.includes('3'),true);
});

test('a failing local file does not prevent saving later files or prune',async()=>{
 const context=vm.createContext({console});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+';globalThis.Bridge=HarnessBridge;',context);
 const repo={list:async()=>[],projects:async()=>[],allMaterials:async()=>[{id:'bad',name:'bad',taskId:'t'},{id:'good',name:'good',taskId:'t'}]};const bridge=new context.Bridge({},repo),saved=[];let pruned=false;
 bridge.saveLocal=async m=>{if(m.id==='bad')throw Error('locked');saved.push(m.id);};bridge.nativeCall=async()=>{pruned=true;};
 await assert.rejects(bridge.syncLocal(repo),/有些文件暂时没能保存/);assert.deepEqual(saved,['good']);assert.ok(pruned);assert.ok(repo.localDirtyTasks.has('t'));
});
test('hung host calls time out and abort their signal',async()=>{
 let signal;const context=vm.createContext({console,setTimeout,clearTimeout,AbortController});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+';globalThis.Bridge=HarnessBridge;',context);
 const bridge=new context.Bridge({get:()=>({rpc:{call:(_route,_method,_args,s)=>{signal=s;return new Promise(()=>{});}}})},{});bridge.rpcTimeout=15;
 await assert.rejects(bridge.nativeCall('shanshaFiles/info'),/超时/);assert.ok(signal.aborted);
});
test('output scans avoid repeated reads but revisit unchanged-size edits',async()=>{
 let now=0,reads=0,deleted=false;const context=vm.createContext({console,Date:{now:()=>now},File,Uint8Array});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+';globalThis.Bridge=HarnessBridge;',context);
 const bridge=new context.Bridge({remote:{workspaceFiles:{list:async()=>({entries:[{type:'file',name:'out.md',size:1}]}),readBytes:async()=>{reads++;return {data:new Uint8Array([65])};}}}},{getSetting:async()=>deleted,importOutput:async()=>true});
 const task={id:'t',sessionId:'s'};await bridge.importOutputMaterials(task);await bridge.importOutputMaterials(task);assert.equal(reads,1);now=30001;await bridge.importOutputMaterials(task);assert.equal(reads,2);deleted=true;now=60002;await bridge.importOutputMaterials(task);assert.equal(reads,2);
});

test('workspace reads above 32 MB use bounded ranges and reject truncated content',async()=>{
 let calls=0;const context=vm.createContext({console,Uint8Array});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+';globalThis.Bridge=HarnessBridge;',context);
 const remote={readBytes:async(_session,_path,options)=>{calls++;assert.ok(options.range.length<=1024*1024);return {data:new Uint8Array(options.range.length).fill(65)};}};const bridge=new context.Bridge({remote:{workspaceFiles:remote}},{}),size=33*1024*1024+7;
 const bytes=await bridge.readWorkspaceBytes('s','large.txt',size);assert.equal(bytes.length,size);assert.equal(calls,34);assert.equal(bytes.at(-1),65);
 remote.readBytes=async()=>({data:new Uint8Array(0)});await assert.rejects(bridge.readWorkspaceBytes('s','large.txt',size),/不完整/);
});

