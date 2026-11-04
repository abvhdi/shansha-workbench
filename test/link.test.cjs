const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('link validates existing session and continuation does not create or change its draft',async()=>{
 let releases=0,refreshed=0;const opened=[],updates=[];
 const rows={old:{id:'old',displayTitle:'之前的讨论',updatedAt:2},child:{id:'child',parentId:'old',updatedAt:3}};
 const ctx={workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'test-workspace'}]})}},sessions:{refresh:async()=>refreshed++,list:{getSnapshot:()=>({ids:['child','old'],byId:rows})},create:()=>{throw Error('不应创建新会话');},retain:id=>({ready:Promise.resolve({session:{getSnapshot:()=>({openState:id==='broken'?'error':'ready'})}}),release:()=>releases++})},uiWorkspace:{openSession:id=>opened.push(id)}};
 const repo={update:async(id,patch)=>updates.push({id,...patch})},sandbox=vm.createContext({ctx,repo});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8'),sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+'\nglobalThis.bridge=new HarnessBridge(ctx,repo);',sandbox);
 sandbox.bridge.pushWork=async()=>{};const choices=await sandbox.bridge.existingSessions();assert.equal(refreshed,1);assert.equal(choices.length,1);assert.equal(choices[0].id,'old');
 await sandbox.bridge.link({id:'task'},'old');assert.deepEqual(updates,[{id:'task',sessionId:'old'}]);
 await sandbox.bridge.open({id:'task',sessionId:'old'});assert.deepEqual(opened,['old']);
 await assert.rejects(sandbox.bridge.open({id:'task'}),/尚未关联/);
 await assert.rejects(sandbox.bridge.link({id:'task'},'broken'),/未修改关联/);assert.equal(updates.length,1);assert.equal(releases,3);
});

test('saved association overrides stale task and preparation reuses the existing conversation',async()=>{
 const opened=[];let creates=0;const repo={list:async()=>[{id:'t',sessionId:'existing'}]};
 const ctx={workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'test-workspace'}]})}},sessions:{create:async()=>{creates++;return 'new';},retain:id=>({ready:Promise.resolve({session:{getSnapshot:()=>({openState:'ready'})}}),release:()=>{}})},uiWorkspace:{openSession:id=>opened.push(id)}};
 const sandbox=vm.createContext({ctx,repo});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8'),sandbox);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+';globalThis.b=new HarnessBridge(ctx,repo);',sandbox);sandbox.b.pushWork=async()=>{};
 assert.equal(await sandbox.b.session({id:'t',sessionId:''}),'existing');await sandbox.b.open({id:'t',sessionId:'stale'});await sandbox.b.open({id:'t'});assert.deepEqual(opened,['existing','existing']);assert.equal(creates,0);
 sandbox.b.pushWork=async()=>{throw Error('同步失败');};await assert.rejects(sandbox.b.open({id:'t'}),/同步失败/);assert.equal(opened.length,2);
});
