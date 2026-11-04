const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
test('workshop scopes files by project and task, searches names and excludes deleted tasks',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('core.js')+'\nglobalThis.files=workshopFiles;',ctx);
 const tasks=[{id:'a',title:'方案',projectId:'p'},{id:'b',title:'其他'},{id:'c',title:'已删',deletedAt:1}],projects=[{id:'p',name:'客户项目'}],materials=[{id:'x',taskId:'a',name:'报价.xlsx',createdAt:2},{id:'y',taskId:'b',name:'说明.txt',createdAt:1},{id:'z',taskId:'c',name:'报价.xlsx'}];
 assert.equal(ctx.files(materials,tasks,projects).length,2);assert.equal(ctx.files(materials,tasks,projects,{projectId:'p'},'报价')[0].taskTitle,'方案');assert.equal(ctx.files(materials,tasks,projects,{taskId:'b'})[0].id,'y');assert.equal(ctx.files(materials,tasks,projects,{projectId:'__none'})[0].id,'y');
});
test('fixed workshop session persists, includes only selected bytes, preserves draft and skips duplicate preparation',async()=>{
 let sessionId,creates=0,releases=0,opens=0;const attachments=[];
 const metadata=[{id:'f',name:'资料.txt',taskId:'t',projectName:'项目',taskTitle:'任务',size:4}],material={...metadata[0],blob:new Blob(['内容']),type:'text/plain',createdAt:1};
 const input={snapshot:{phase:'plain',draft:'原消息',attachmentIds:[]},actions:{setDraft:text=>input.snapshot.draft=text,addAttachments:ids=>{attachments.push(...ids);return true;}}};
 const repo={allMaterials:async()=>[material],getSetting:async()=>sessionId,setSetting:async(key,id)=>sessionId=id};
 const conversation={input:{for:()=>input},createDrafts:(id,files)=>{assert.equal(files.length,1);assert.equal(files[0].name,'资料.txt');return [{id:'attachment'}];},releaseDraftAttachments:()=>{throw Error('不应清理已附加的文件');}};
 const ctx={workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'test-workspace'}]})}},sessions:{create:async()=>{creates++;return 'fixed';},retain:()=>({ready:Promise.resolve({ctx:{},session:{getSnapshot:()=>({openState:'ready'})}}),release:()=>releases++})},remote:{session:{rename:async()=>({ok:true})}},get:()=>conversation,uiWorkspace:{openSession:()=>opens++}};
 const sandbox=vm.createContext({ctx,repo,File,TextEncoder,crypto:require('node:crypto').webcrypto,console});vm.runInContext(read('core.js')+'\n'+read('bridge.js')+'\nglobalThis.bridge=new HarnessBridge(ctx,repo);',sandbox);
 await sandbox.bridge.openWorkshop('选中的文件',metadata,['f']);assert.ok(input.snapshot.draft.startsWith('原消息'));assert.ok(input.snapshot.draft.includes('不要自动改名'));const before=input.snapshot.draft;
 await sandbox.bridge.openWorkshop('选中的文件',metadata,['f']);assert.equal(input.snapshot.draft,before);assert.equal(attachments.length,1);
 vm.runInContext('globalThis.bridge=new HarnessBridge(ctx,repo);',sandbox);await sandbox.bridge.openWorkshop('全部文件',metadata,[]);assert.equal(creates,1);assert.ok(input.snapshot.draft.includes('没有附带原文件'));assert.equal(releases,3);assert.equal(opens,3);
});

test('保留的文件在文件工坊里仍可见，并标记来源已删除',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('core.js')+'\nglobalThis.files=workshopFiles;',ctx);
 const tasks=[{id:'a',title:'方案',projectId:'p'}],projects=[{id:'p',name:'客户项目'}],materials=[{id:'x',taskId:'a',name:'报价.xlsx',createdAt:2},{id:'z',taskId:'gone',name:'保留.txt',createdAt:1}];
 const all=ctx.files(materials,tasks,projects);
 assert.equal(all.length,2);
 const orphan=all.find(f=>f.id==='z');
 assert.equal(orphan.taskTitle,'已删除的待办');assert.equal(orphan.taskMissing,true);
 assert.equal(ctx.files(materials,tasks,projects,{projectId:'p'}).length,1);
 assert.equal(ctx.files(materials,tasks,projects,{taskId:'gone'}).length,0);
});

test('project collaboration selects its own files and has a separate persistent session key',async()=>{
 const sandbox=vm.createContext({console});vm.runInContext(read('core.js')+'\n'+read('bridge.js')+'\nglobalThis.Bridge=HarnessBridge;globalThis.dir=taskOutputDir;',sandbox);
 const bridge=new sandbox.Bridge({}, {allMaterials:async()=>[{id:'f',taskId:'t',name:'a.md',createdAt:1},{id:'other',taskId:'x',name:'b.md',createdAt:1}]});let args;bridge.openWorkshop=async(...values)=>{args=values;};
 await bridge.openProject({id:'p',name:'项目'},[{id:'t',projectId:'p',title:'事项'},{id:'x',projectId:'q'}],[{id:'p',name:'项目'}]);
 assert.equal(args[1].length,1);assert.equal(args[2][0],'f');assert.equal(args[3].settingKey,'projectSession:p');assert.notEqual(sandbox.dir({id:'t'}),sandbox.dir({id:'x'}));
});
