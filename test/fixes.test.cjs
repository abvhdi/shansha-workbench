const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
test('附件同步逐条隔离：单条待办失败不影响其它待办',async()=>{
 const tasks=[{id:'a',sessionId:'s1',status:'todo',updatedAt:1},{id:'b',sessionId:'s2',status:'todo',updatedAt:1}];
 const seen=[];
 const repo={list:async()=>tasks,materials:async()=>[],update:async()=>{},close:()=>{}};
 const bridge={importDraftMaterials:async task=>{seen.push(task.id);if(task.id==='a')throw new Error('会话损坏');return 0;}};
 const ctx=vm.createContext({repo,bridge,setTimeout,clearTimeout,BroadcastChannel:undefined,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 await ctx.model.syncMaterials();
 assert.deepEqual(seen,['a','b']);
 assert.match(ctx.model.snapshot().message||'',/聊天附件同步失败/);
 await ctx.model.dispose();
});
test('未保存的修改写入本地抢救记录，并在下次启动按时间戳恢复',async()=>{
 const store=new Map();
 const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const task={id:'t',title:'旧标题',description:'',status:'todo',updatedAt:1};
 let fail=true;
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>{if(fail)throw new Error('存储已满');Object.assign(task,patch,{updatedAt:Date.now()});},close:()=>{}};
 const ctx=vm.createContext({repo,bridge:{},setTimeout,clearTimeout,BroadcastChannel:undefined,localStorage,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 ctx.model.saveDraft('t',{title:'新标题'});
 await assert.rejects(ctx.model.flushDraft('t'));
 const rescued=JSON.parse(store.get('shansha-workbench-rescue-v1')||'[]');
 assert.equal(rescued.length,1);assert.equal(rescued[0].taskId,'t');assert.equal(rescued[0].patch.title,'新标题');
 assert.ok((ctx.model.snapshot().saves.t||{}).status==='error');
 task.updatedAt=1;fail=false;
 assert.equal(await ctx.model.recoverRescue(),1);
 assert.equal(task.title,'新标题');assert.equal(store.has('shansha-workbench-rescue-v1'),false);
 await ctx.model.dispose();
});
test('启动时清理旧回收站遗留，删除待办不再有回收站',async()=>{
 const tasks=[{id:'t',sessionId:'s',status:'todo',deletedAt:1,title:'x',updatedAt:1}];
 let purged=null,forgot=null;
 let kept=null;const repo={list:async()=>tasks,materials:async()=>[],update:async()=>{},purgeTasks:async(ids,keep)=>{purged=ids;kept=!!keep;for(const id of ids){const i=tasks.findIndex(t=>t.id===id);if(i>=0)tasks.splice(i,1);}return ids.length;},close:()=>{}};
 const bridge={importDraftMaterials:async()=>0,forgetTasks:ids=>{forgot=ids;}};
 const ctx=vm.createContext({repo,bridge,setTimeout,clearTimeout,BroadcastChannel:undefined,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 assert.equal(await ctx.model.cleanLegacyTrash(),1);
 assert.deepEqual(Array.from(purged),['t']);assert.deepEqual(Array.from(forgot),['t']);
 assert.equal(kept,true);assert.equal(tasks.length,0);
 assert.match(ctx.model.snapshot().message||'',/回收站已取消/);
 await ctx.model.dispose();
});
test('prepare 落库失败时回滚草稿标记，之后仍能重新准备',async()=>{
 let updates=0;
 const task={id:'t',sessionId:'s',title:'事项',description:'',status:'todo',handoffs:[]};
 const input={snapshot:{draft:'用户原有草稿',phase:'plain',attachmentIds:[]},actions:{addAttachments:ids=>{input.snapshot.attachmentIds.push(...ids);return true;},setDraft:text=>{input.snapshot.draft=text;}}};
 const binding={ctx:{},session:{getSnapshot:()=>({openState:'ready'})}};
 const ctx={sessions:{retain:()=>({ready:Promise.resolve(binding),release:()=>{}})},uiWorkspace:{openSession:()=>{}},get:()=>({input:{for:()=>input},createDrafts:()=>[{id:'draft-1'}],releaseDraftAttachments:()=>{}})};
 const repo={update:async(id,patch)=>{updates++;if(updates===1)throw new Error('落库失败');Object.assign(task,patch);},list:async()=>[task]};
 const sandbox=vm.createContext({console,File:globalThis.File});
 vm.runInContext(read('core.js')+'\n'+read('bridge.js')+'\nglobalThis.Bridge=HarnessBridge;',sandbox);
 const bridge=new sandbox.Bridge(ctx,repo);
 const materials=[{id:'m',name:'a.txt',type:'text/plain',blob:new Blob(['x']),createdAt:1}];
 await assert.rejects(bridge.prepare(task,materials),/落库失败/);
 assert.equal(input.snapshot.draft,'用户原有草稿');
 assert.equal(bridge.busy.size,0);
 await bridge.prepare(task,materials);
 assert.ok(input.snapshot.draft.startsWith('用户原有草稿'));
 assert.equal(input.snapshot.draft,'用户原有草稿');
 assert.equal(task.status,'ready');assert.equal(task.handoffs.length,1);
});

test('无关的 updatedAt 变化不会让未保存的修改被丢弃',async()=>{
 const store=new Map();
 const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const task={id:'t',title:'旧标题',description:'',status:'todo',updatedAt:1};
 let fail=true;
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>{if(fail)throw new Error('存储已满');Object.assign(task,patch,{updatedAt:Date.now()});},close:()=>{}};
 const ctx=vm.createContext({repo,bridge:{},setTimeout,clearTimeout,BroadcastChannel:undefined,localStorage,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 ctx.model.saveDraft('t',{title:'新标题'});
 await assert.rejects(ctx.model.flushDraft('t'));
 task.updatedAt=Date.now()+100000;
 fail=false;
 assert.equal(await ctx.model.recoverRescue(),1);
 assert.equal(task.title,'新标题');
 await ctx.model.dispose();
});
test('落库成功后清除抢救记录，非法标题不进入抢救记录',async()=>{
 const store=new Map();
 const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const task={id:'t',title:'原',description:'',status:'todo',updatedAt:1};
 let fail=true;
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>{if(fail)throw new Error('存储已满');Object.assign(task,patch,{updatedAt:Date.now()});},close:()=>{}};
 const ctx=vm.createContext({repo,bridge:{},setTimeout,clearTimeout,BroadcastChannel:undefined,localStorage,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 ctx.model.saveDraft('t',{title:'   '});
 await assert.rejects(ctx.model.flushDraft('t'));
 assert.equal(store.has('shansha-workbench-rescue-v1'),false);
 ctx.model.saveDraft('t',{title:'新标题'});
 await assert.rejects(ctx.model.flushDraft('t'));
 assert.equal(JSON.parse(store.get('shansha-workbench-rescue-v1')).length,1);
 fail=false;
 await ctx.model.flushDraft('t');
 assert.equal(store.has('shansha-workbench-rescue-v1'),false);
 assert.equal(task.title,'新标题');
 await ctx.model.dispose();
});

test('抢救记录只接受白名单字段，过期条目会被丢弃',async()=>{
 const store=new Map();
 const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const task={id:'t',title:'原',description:'',status:'todo',updatedAt:1};
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>Object.assign(task,patch),close:()=>{}};
 const ctx=vm.createContext({repo,bridge:{},setTimeout,clearTimeout,BroadcastChannel:undefined,localStorage,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);globalThis.rescuePatch=rescuePatch;',ctx);
 ctx.rescuePatch('t',{title:'合法',status:'done',deletedAt:123},Date.now());
 const saved=JSON.parse(store.get('shansha-workbench-rescue-v1'));
 assert.deepEqual(Object.keys(saved[0].patch),['title']);
 assert.equal(await ctx.model.recoverRescue(),1);
 assert.equal(task.title,'合法');assert.equal(task.status,'todo');assert.equal(task.deletedAt,undefined);
 ctx.rescuePatch('t',{title:'过期'},Date.now()-8*86400000);
 assert.equal(await ctx.model.recoverRescue(),0);
 assert.equal(task.title,'合法');
 assert.equal(store.has('shansha-workbench-rescue-v1'),false);
 await ctx.model.dispose();
});

test('保留的文件可以从文件工坊单独删除',async()=>{
 let deleted=null;
 const repo={list:async()=>[],materials:async()=>[],deleteMaterial:async id=>{deleted=id;},close:()=>{}};
 const ctx=vm.createContext({repo,bridge:{},setTimeout,clearTimeout,BroadcastChannel:undefined,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 await ctx.model.deleteFile('m1');
 assert.equal(deleted,'m1');
 assert.match(ctx.model.snapshot().message||'',/已从本机删除/);
 await ctx.model.dispose();
});

test('保存标题不再整库重读，材料计数一次遍历得出',async()=>{
 const task={id:'t',title:'旧',description:'',status:'todo',updatedAt:1};
 let listCalls=0,allCalls=0;
 const repo={list:async()=>{listCalls++;return [task];},allMaterials:async()=>{allCalls++;return [{id:'m1',taskId:'t'},{id:'m2',taskId:'t'},{id:'m3',taskId:'u'}];},projects:async()=>[],update:async(id,patch)=>{Object.assign(task,patch,{updatedAt:Date.now()});return {...task};},close:()=>{}};
 const ctx=vm.createContext({repo,bridge:{},setTimeout,clearTimeout,BroadcastChannel:undefined,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 await ctx.model.refresh();
 assert.equal(ctx.model.snapshot().materialCounts.t,2);
 const listBefore=listCalls,allBefore=allCalls;
 ctx.model.saveDraft('t',{title:'新'});
 await ctx.model.flushDraft('t');
 assert.equal(ctx.model.snapshot().tasks[0].title,'新');
 assert.equal(listCalls,listBefore);
 assert.equal(allCalls,allBefore);
 await ctx.model.dispose();
});
test('导出备份分片组装，仍是可解析的完整备份',async()=>{
 const materials=[{id:'m1',taskId:'t',name:'a.txt',size:3,type:'text/plain',blob:new Blob(['abc'],{type:'text/plain'})},{id:'m2',taskId:'t',name:'b.txt',size:3,type:'text/plain',blob:new Blob(['xyz'],{type:'text/plain'})}];
 const repo={backup:async()=>({tasks:[{id:'t',title:'事项'}],projects:[],materials})};
 let captured=null,downloaded=null,progress=0;
 class FakeFileReader{readAsDataURL(blob){blob.text().then(text=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(text).toString('base64');this.onload();});}}
 const sandbox=vm.createContext({repo,Blob,FileReader:FakeFileReader,Buffer,console,setTimeout:fn=>globalThis.setTimeout(fn,0),React:{memo:fn=>fn},
   URL:{createObjectURL:blob=>{captured=blob;return 'blob:fake';},revokeObjectURL:()=>{}},
   document:{createElement:()=>({set href(value){},set download(value){downloaded=value;},click:()=>{}})}});
 vm.runInContext(read('core.js')+'\n'+read('ui.js')+'\nglobalThis.exportBackup=exportBackup;',sandbox);
 const count=await sandbox.exportBackup(repo,()=>{progress++;});
 assert.equal(count,2);assert.ok(progress>=1);
 const parsed=JSON.parse(await captured.text());
 assert.equal(parsed.version,2);assert.equal(parsed.format,'shansha-workbench');
 assert.equal(parsed.tasks[0].title,'事项');
 assert.equal(parsed.materials.length,2);
 assert.ok(parsed.materials[0].dataUrl.startsWith('data:text/plain;base64,'));
 assert.equal(parsed.materials[1].name,'b.txt');
 assert.ok(String(downloaded).startsWith('珊莎工作台备份-'));
});

test('导出进度提示不会清掉会话撤销入口',async()=>{
 const task={id:'t',sessionId:'s',status:'todo',title:'x',updatedAt:1};
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>{Object.assign(task,patch);},close:()=>{}};
 const bridge={importDraftMaterials:async()=>0,link:async({id},sessionId)=>{task.sessionId=sessionId;}};
 const ctx=vm.createContext({repo,bridge,setTimeout,clearTimeout,BroadcastChannel:undefined,console});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 await ctx.model.unlinkSession('t');
 assert.ok(ctx.model.snapshot().undo);
 ctx.model.notice('正在导出备份…',true);
 assert.ok(ctx.model.snapshot().undo);
 ctx.model.notice('普通提示');
 assert.equal(ctx.model.snapshot().undo,null);
 await ctx.model.dispose();
});

test('待办提示词里约定了产出目录',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('core.js')+'\nglobalThis.p=taskPrompt;globalThis.D=OUTPUT_DIR;',ctx);
 const text=ctx.p({title:'整理方案',description:''},[]);
 assert.ok(text.includes(ctx.D));
 assert.ok(text.includes('整理方案'));
});
test('AI 产出从会话工作目录回流成材料',async()=>{
 const task={id:'t',sessionId:'s',status:'todo',title:'x',updatedAt:1};
 const imported=[];const listed=[];
 const repo={importOutput:async(taskId,file)=>{imported.push({taskId,name:file.name,bytes:await file.text()});return true;}};
 const remote={workspaceFiles:{
   list:async(sessionId,dir)=>{listed.push({sessionId,dir});return {entries:[{name:'周报.md',type:'file',size:12},{name:'子目录',type:'directory'}]};},
   readBytes:async()=>({data:new TextEncoder().encode('本周周报内容')})
 }};
 const ctx={sessions:{retain:()=>({ready:Promise.resolve({ctx:{},session:{getSnapshot:()=>({openState:'ready'})}}),release:()=>{}})},get:()=>({}),uiWorkspace:{openSession:()=>{}},remote};
 const sandbox=vm.createContext({ctx,repo,File,TextEncoder,console});
 vm.runInContext(read('core.js')+'\n'+read('bridge.js')+'\nglobalThis.bridge=new HarnessBridge(ctx,repo);globalThis.D=OUTPUT_DIR;',sandbox);
 assert.equal(await sandbox.bridge.importOutputMaterials(task),1);
 assert.equal(listed.length,1);assert.equal(listed[0].sessionId,'s');assert.equal(listed[0].dir,sandbox.D+'/t');
 assert.equal(imported.length,1);assert.equal(imported[0].name,'周报.md');assert.equal(imported[0].taskId,'t');
 assert.equal(imported[0].bytes,'本周周报内容');
});
test('没有产出目录、没有工作目录接口、或产出过大时安静跳过',async()=>{
 const task={id:'t',sessionId:'s'};let reads=0;
 const repo={importOutput:async()=>true};
 const missing={workspaceFiles:{list:async()=>{throw Object.assign(new Error('no entry'),{code:'workspace-file/not-found'});},readBytes:async()=>{reads++;return {data:new Uint8Array()};}}};
 const noApi={};
 const tooBig={workspaceFiles:{list:async()=>({entries:[{name:'大.dat',type:'file',size:60*1024*1024}]}),readBytes:async()=>{reads++;return {data:new Uint8Array()};}}};
 for(const remote of [missing,noApi,tooBig]){
   const ctx={sessions:{retain:()=>({ready:Promise.resolve({ctx:{},session:{getSnapshot:()=>({openState:'ready'})}}),release:()=>{}}),refresh:async()=>{}},get:()=>({}),uiWorkspace:{openSession:()=>{}},remote};
   const sandbox=vm.createContext({ctx,repo,File,TextEncoder,console});
   vm.runInContext(read('core.js')+'\n'+read('bridge.js')+'\nglobalThis.bridge=new HarnessBridge(ctx,repo);',sandbox);
   assert.equal(await sandbox.bridge.importOutputMaterials(task),0);
   assert.equal(sandbox.bridge.outputsAvailable(),!!(remote&&remote.workspaceFiles));
 }
 assert.equal(reads,0);
});
