const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name+'.js'),'utf8');
test('manual order preserves hidden tasks and appends new tasks without resetting saved positions',()=>{
 const c=vm.createContext({});vm.runInContext(read('core')+';globalThis.order=manualTaskOrder;globalThis.move=moveOrderedTask;globalThis.due=isTaskOverdue;',c);
 const tasks=[{id:'a',createdAt:1},{id:'b',createdAt:2},{id:'c',createdAt:3}];assert.equal(c.order(tasks,['a','b','c']).map(t=>t.id).join(','),'a,b,c');assert.equal(c.move(['a','b','c'],'c','a').join(','),'c,a,b');assert.equal(c.move(['a','b','c'],'a',null).join(','),'b,c,a');assert.equal(c.move(['a','b','c'],'a','a').join(','),'a,b,c');assert.equal(c.order([...tasks,{id:'new',createdAt:4}],['c','a','b']).map(t=>t.id).join(','),'c,a,b,new');
 assert.equal(c.due({status:'todo',reminder:{nextAt:1,notifiedAt:1}},2),true);assert.equal(c.due({status:'done',reminder:{nextAt:1}},2),false);
});
test('postponing changes the next alert without replacing a weekly recurrence or task completion state',async()=>{
 const now=Date.parse('2026-10-14T10:00:00+08:00');class Clock extends Date{static now(){return now;}}
 const task={id:'t',title:'周会',status:'todo',reminder:{kind:'weekly',date:'2026-10-12',time:'09:00',days:[1],nextAt:now-1,notifiedAt:now-1}};
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>{Object.assign(task,typeof patch==='function'?patch(task):patch);return task;},close:()=>{}};
 const c=vm.createContext({Date:Clock,setTimeout,clearTimeout,repo});vm.runInContext(read('core')+'\n'+read('plugin')+';globalThis.model=createModel(repo,{});',c);
 await c.model.postponeReminder('t','2026-10-15','15:30');assert.equal(task.reminder.nextAt,Date.parse('2026-10-15T15:30:00+08:00'));assert.equal(task.reminder.kind,'weekly');assert.equal(task.reminder.time,'09:00');assert.equal(task.reminder.days[0],1);assert.equal(task.reminder.notifiedAt,null);assert.equal(task.status,'todo');await assert.rejects(c.model.postponeReminder('t','2026-10-13','09:00'),/之后/);await c.model.dispose();
});
