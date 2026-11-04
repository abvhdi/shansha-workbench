const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const context=vm.createContext({console,File:globalThis.File});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\nglobalThis.api={newTask,filterTasks,validateFiles,taskPrompt};',context);
const api=context.api;
test('reject empty titles and retain unclassified notes',()=>{
  assert.throws(()=>api.newTask('  ','x',1));
  const task=api.newTask(' 汇报 ','x',1);
  assert.equal(task.title,'汇报');assert.equal(task.status,'todo');
});
test('completed tasks are separate and search includes notes',()=>{
  const tasks=[{id:'a',title:'方案',description:'预算',status:'doing',updatedAt:1},{id:'b',title:'汇报',description:'',status:'done',updatedAt:2}];
  assert.equal(api.filterTasks(tasks,'active','预算')[0].id,'a');
  assert.equal(api.filterTasks(tasks,'done','')[0].id,'b');
});
test('file limits reject oversized intake before persistence',()=>{
  assert.throws(()=>api.validateFiles([{name:'large.xlsx',size:51*1024*1024}]));
  assert.throws(()=>api.validateFiles(Array.from({length:5},()=>({name:'a',size:50*1024*1024}))));
});
test('prompt preserves literal task and notes',()=>{
  const text=api.taskPrompt({title:'整理客户方案',description:'需要先确认预算'},[{name:'数据.xlsx'}]);
  assert.ok(text.includes('整理客户方案'));assert.ok(text.includes('需要先确认预算'));assert.ok(text.includes('数据.xlsx'));
});
test('handoff creates one session, preserves existing draft, and does not send a prompt',async()=>{
  let creates=0,opens=0,releases=0,sends=0;
  const task={...api.newTask('整理材料','t',1),description:'目标说明'};
  const repo={update:async(id,patch)=>Object.assign(task,patch)};
  const input={snapshot:{draft:'用户原有草稿',phase:'plain',attachmentIds:[]},actions:{addAttachments:ids=>{input.snapshot.attachmentIds.push(...ids);return true;},setDraft:text=>{input.snapshot.draft=text;}}};
  const binding={ctx:{},session:{getSnapshot:()=>({openState:'ready'}),prompt:()=>{sends++;}}};
  const ctx={workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'test-workspace'}]})}},sessions:{create:async()=>{creates++;return 'session-1';},retain:()=>({ready:Promise.resolve(binding),release:()=>{releases++;}})},remote:{session:{rename:async()=>({ok:true})}},uiWorkspace:{openSession:()=>{opens++;}},get:()=>({input:{for:()=>input},createDrafts:()=>[{id:'draft-1'}],releaseDraftAttachments:()=>{}})};
  context.repo=repo;context.ctx=ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+'\nglobalThis.bridge=new HarnessBridge(ctx,repo);',context);
  await context.bridge.prepare(task,[{id:'m',name:'data.txt',type:'text/plain',blob:new Blob(['test']),createdAt:1}]);
  assert.equal(creates,1);assert.equal(task.sessionId,'session-1');assert.equal(task.status,'ready');assert.equal(task.handoffs.length,1);
  assert.equal(input.snapshot.draft,'用户原有草稿');assert.equal(sends,0);
  await context.bridge.prepare(task,[]);
  assert.equal(creates,1);assert.equal(task.handoffs.length,1);assert.equal(opens,2);assert.equal(releases,2);
});
