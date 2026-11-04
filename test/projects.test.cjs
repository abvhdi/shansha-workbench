const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
test('project navigation sorts newest first and searches without changing stored order',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('core.js')+'\nglobalThis.recent=recentProjects;',ctx);
 const projects=[{id:'old',name:'客户方案',createdAt:1},{id:'new',name:'运营项目',createdAt:10}];
 assert.equal(ctx.recent(projects)[0].id,'new');assert.equal(ctx.recent(projects,'客户')[0].id,'old');assert.equal(ctx.recent(projects,'不存在').length,0);assert.equal(projects[0].id,'old');
});
test('project grouping places old and orphaned todos in unclassified without copying them',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('core.js')+'\nglobalThis.group=projectColumns;',ctx);
 const tasks=[{id:'old'},{id:'assigned',projectId:'p'},{id:'orphan',projectId:'gone'}],columns=ctx.group(tasks,[{id:'p',name:'项目'}]);
 assert.deepEqual(Array.from(columns[0].tasks,t=>t.id),['old','orphan']);assert.equal(columns[1].tasks[0],tasks[1]);assert.equal(tasks.length,3);
});
test('database upgrade adds projects without recreating existing task or material stores',async()=>{
 let request,version;const created=[],names=new Set(['tasks','materials']);
 const db={objectStoreNames:{contains:name=>names.has(name)},createObjectStore:name=>{created.push(name);names.add(name);},close:()=>{}};
 const factory={open:(name,v)=>{version=v;request={result:db};return request;}};
 const ctx=vm.createContext({factory});vm.runInContext(read('repository.js')+'\nglobalThis.repo=new WorkbenchRepository(factory);',ctx);
 const opening=ctx.repo.open();request.onupgradeneeded();request.onsuccess();await opening;assert.equal(version,3);assert.deepEqual(created,['projects','settings']);ctx.repo.close();
});
test('moving a todo and deleting a project preserve its reminder, materials and session identity',async()=>{
 const task={id:'t',projectId:'',sessionId:'s',reminder:{nextAt:123},description:'备注'},deleted={id:'trash',projectId:'p',deletedAt:1};
 const stores={tasks:new Map([['t',task],['trash',deleted]]),projects:new Map([['p',{id:'p',name:'项目'}]])};
 const ctx=vm.createContext({});vm.runInContext(read('repository.js')+'\nglobalThis.repo=new WorkbenchRepository({});',ctx);
 ctx.repo.transaction=(names,mode,run)=>new Promise((resolve,reject)=>{
   let result,pending=0,ended=false;const maybeFinish=()=>{if(!pending&&!ended){ended=true;resolve(result);}};
   const request=value=>{pending++;const r={result:value};queueMicrotask(()=>{if(ended)return;try{r.onsuccess?.();}catch(e){ended=true;reject(e);return;}pending--;maybeFinish();});return r;};
   const tx={abort:()=>{ended=true;reject(Error('transaction aborted'));},objectStore:name=>({get:id=>request(stores[name].get(id)),getAll:()=>request([...stores[name].values()]),put:item=>stores[name].set(item.id,item),delete:id=>stores[name].delete(id)})};
   run(tx,value=>result=value);if(!pending)maybeFinish();
 });
 await ctx.repo.moveTask('t','p');assert.equal(stores.tasks.get('t').projectId,'p');assert.equal(stores.tasks.get('t').sessionId,'s');assert.equal(stores.tasks.get('t').reminder.nextAt,123);
 await assert.rejects(ctx.repo.moveTask('t','missing'));assert.equal(stores.tasks.get('t').projectId,'p');
 await ctx.repo.deleteProject('p');assert.equal(stores.tasks.get('t').projectId,'');assert.equal(stores.tasks.get('trash').projectId,'');assert.equal(stores.tasks.get('t').description,'备注');assert.equal(stores.tasks.size,2);
});


test('project tasks include both statuses and completion preserves position',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('core.js')+';globalThis.visible=projectVisibleTasks;',ctx);
 const tasks=[{id:'a',title:'方案',description:'',createdAt:1,updatedAt:1,status:'todo'},{id:'b',title:'汇报',createdAt:2,updatedAt:2,status:'done'},{id:'gone',title:'旧',createdAt:3,deletedAt:4}];
 const before=ctx.visible(tasks).map(t=>t.id).join(',');assert.equal(before,'b,a');
 tasks[0].status='done';tasks[0].updatedAt=100;assert.equal(ctx.visible(tasks).map(t=>t.id).join(','),before);
 assert.equal(ctx.visible(tasks,'方案').length,1);
});
