const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('switching and creating sessions preserve the task and allow undo',async()=>{
 const task={id:'t',sessionId:'old',description:'备注'};let created=0;
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>Object.assign(task,patch),close:()=>{}};
 const bridge={link:async(t,id)=>{if(id==='broken')throw Error('不能打开');task.sessionId=id;},prepare:async(t,materials,options)=>{assert.equal(options.forceNew,true);created++;task.sessionId='new';}};
 const ctx=vm.createContext({repo,bridge,setTimeout,clearTimeout,BroadcastChannel:undefined});
 for(const file of ['core.js','plugin.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),ctx);
 vm.runInContext('globalThis.model=createModel(repo,bridge);',ctx);
 await ctx.model.changeSession('t','chosen');assert.equal(task.sessionId,'chosen');await ctx.model.snapshot().undo();assert.equal(task.sessionId,'old');
 await assert.rejects(ctx.model.changeSession('t','broken'),/不能打开/);assert.equal(task.sessionId,'old');
 await ctx.model.changeSession('t',null,[]);assert.equal(created,1);assert.equal(task.sessionId,'new');await ctx.model.snapshot().undo();assert.equal(task.sessionId,'old');assert.equal(task.description,'备注');await ctx.model.dispose();
});

test('start collaboration automatically links once and later clicks open the saved session',async()=>{
 const task={id:'t',title:'任务',sessionId:''};let creates=0,opens=0;
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,p)=>Object.assign(task,p),close:()=>{}};
 const bridge={prepare:async(t)=>{assert.equal(t.sessionId,'');creates++;await repo.update(t.id,{sessionId:'saved'});},open:async(t)=>{assert.equal(t.sessionId,'saved');opens++;}};
 const ctx=vm.createContext({repo,bridge,setTimeout,clearTimeout,BroadcastChannel:undefined});for(const file of ['core.js','plugin.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),ctx);vm.runInContext('globalThis.m=createModel(repo,bridge)',ctx);
 await ctx.m.startCollaboration('t',[]);assert.equal(ctx.m.snapshot().tasks[0].sessionId,'saved');await ctx.m.startCollaboration('t',[]);await ctx.m.startCollaboration('t',[]);assert.equal(creates,1);assert.equal(opens,2);await ctx.m.dispose();
});
