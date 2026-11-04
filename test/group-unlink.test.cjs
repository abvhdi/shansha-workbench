const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
test('activity groups follow local calendar boundaries and omit empty groups',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('core.js')+'\nglobalThis.group=groupTasksByActivity;',ctx);
 const at=(day,hour=12)=>new Date(2026,9,day,hour).getTime();
 const groups=ctx.group([{id:'today',updatedAt:at(6,0)},{id:'yesterday',updatedAt:at(5,23)},{id:'week',updatedAt:at(1)},{id:'older',updatedAt:new Date(2026,8,29).getTime()}],at(6));
 assert.deepEqual(Array.from(groups,g=>g.label),['今天','近 7 天','更早']);assert.equal(groups[1].tasks.length,2);
 assert.equal(ctx.group([],at(6)).length,0);
});
test('unlink stops material sync, preserves records, and undo restores association',async()=>{
 const task={id:'t',sessionId:'s',description:'原备注'},materials=[{id:'m',name:'材料'}];let imports=0;
 const repo={list:async()=>[task],materials:async()=>materials,update:async(id,patch)=>Object.assign(task,patch),close:()=>{}};
 const bridge={importDraftMaterials:async()=>{imports++;return 0;},link:async({id},sessionId)=>repo.update(id,{sessionId})};
 const ctx=vm.createContext({repo,bridge,setTimeout,clearTimeout,BroadcastChannel:undefined});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 await ctx.model.unlinkSession('t');assert.equal(task.sessionId,'');assert.equal(task.description,'原备注');assert.equal(materials.length,1);
 await ctx.model.syncMaterials();assert.equal(imports,0);
 await ctx.model.snapshot().undo();assert.equal(task.sessionId,'s');await ctx.model.dispose();
});
test('删除待办即从本机移除；选择保留文件时材料留下不再同步',async()=>{
 const tasks=[{id:'t',sessionId:'s',status:'todo',title:'测试',description:'',updatedAt:1}];let imports=0,purged=null,kept=null;
 const repo={list:async()=>tasks,materials:async()=>[],update:async(id,patch)=>Object.assign(tasks.find(t=>t.id===id)||{},patch),purgeTasks:async(ids,keep)=>{purged=ids;kept=!!keep;for(const id of ids){const i=tasks.findIndex(t=>t.id===id);if(i>=0)tasks.splice(i,1);}return ids.length;},close:()=>{}};
 const bridge={importDraftMaterials:async()=>{imports++;return 0;},forgetTasks:()=>{}};
 const ctx=vm.createContext({repo,bridge,setTimeout,clearTimeout,BroadcastChannel:undefined});
 vm.runInContext(read('core.js')+'\n'+read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);globalThis.filter=filterTasks;',ctx);
 await ctx.model.deleteTask('t');
 assert.deepEqual(Array.from(purged),['t']);assert.equal(kept,false);assert.equal(tasks.length,0);
 assert.equal(ctx.filter(tasks,'active','').length,0);
 assert.equal(ctx.model.snapshot().undo,null);
 await ctx.model.syncMaterials();assert.equal(imports,0);
 tasks.push({id:'u',sessionId:'s',status:'todo',title:'保留文件',description:'',updatedAt:1});
 await ctx.model.deleteTask('u',{keepMaterials:true});
 assert.equal(kept,true);assert.equal(tasks.length,0);
 await ctx.model.dispose();
});
