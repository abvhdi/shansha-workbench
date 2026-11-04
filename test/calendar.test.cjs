const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\nglobalThis.api={calendarMonth,shiftCalendarMonth,calendarVisibleTasks,filterTasks};',ctx);
test('calendar uses Shanghai reminder dates and keeps unscheduled tasks accessible',()=>{
 const tasks=[{id:'midnight',reminder:{nextAt:Date.parse('2026-10-07T16:01:00Z')}},{id:'plain'}];
 const grid=ctx.api.calendarMonth('2026-10',tasks);assert.equal(grid.days.length,42);assert.equal(grid.days[0].date,'2026-09-28');assert.equal(grid.days.find(d=>d.date==='2026-10-08').tasks[0].id,'midnight');assert.equal(grid.unscheduled[0].id,'plain');
 assert.equal(ctx.api.shiftCalendarMonth('2026-12',1),'2027-01');assert.equal(ctx.api.shiftCalendarMonth('2026-01',-1),'2025-12');
});
test('calendar shows the next cycle of completed recurring tasks and hides deleted tasks',()=>{
 const base={title:'周会',description:'',updatedAt:1,status:'done'},tasks=[{...base,id:'week',reminder:{kind:'weekly'}},{...base,id:'hour',reminder:{kind:'interval',unit:'hours'}},{...base,id:'deleted',deletedAt:1,reminder:{kind:'weekly'}}];
 assert.deepEqual(Array.from(ctx.api.calendarVisibleTasks(tasks,'active',''),t=>t.id),['week']);assert.equal(ctx.api.calendarVisibleTasks(tasks,'active','找不到').length,0);
});

test('calendar only includes reminders while ordinary unscheduled tasks stay in the todo list',()=>{
 const tasks=[{id:'plain',title:'先记下来',description:'',status:'todo'},{id:'alarm',title:'周会',description:'',status:'todo',reminder:{kind:'once',nextAt:1}},{id:'finished',title:'已完成记录',description:'',status:'done'}];assert.deepEqual(Array.from(ctx.api.calendarVisibleTasks(tasks,'active',''),t=>t.id),['alarm']);assert.equal(ctx.api.calendarVisibleTasks(tasks,'done','').length,0);assert.equal(ctx.api.calendarVisibleTasks(tasks,'active','先记').length,0);assert.deepEqual(Array.from(ctx.api.filterTasks(tasks,'active',''),t=>t.id).sort(),['alarm','plain']);
});
