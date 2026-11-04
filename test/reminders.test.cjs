const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
const stamp=value=>Date.parse(value+'+08:00');
function setup(extra={}){const ctx=vm.createContext({...extra});vm.runInContext(read('core.js')+'\nglobalThis.api={makeReminder,nextReminder,completionPatch,reminderDate,reminderDisplay};',ctx);return ctx;}
test('one-time reminders validate dates and reject past times',()=>{
 const {api}=setup(),now=stamp('2026-10-07T10:00:00');
 assert.throws(()=>api.makeReminder({kind:'once',date:'2026-10-07',time:'09:00'},now),/未来/);
 assert.throws(()=>api.makeReminder({kind:'once',date:'2026-02-30',time:'09:00'},now),/有效日期/);
 assert.equal(api.makeReminder({kind:'once',date:'2026-10-08',time:'09:00'},now).nextAt,stamp('2026-10-08T09:00:00'));
 assert.equal(api.reminderDate(stamp('2026-10-08T00:01:00')),'2026-10-08');
});
test('weekly recurrence respects multiple weekdays, anchor, and week boundaries',()=>{
 const {api}=setup(),rule=api.makeReminder({kind:'weekly',date:'2026-10-07',time:'09:00',days:[1,4]},stamp('2026-10-07T10:00:00'));
 assert.equal(rule.nextAt,stamp('2026-10-08T09:00:00'));
 assert.equal(api.nextReminder(rule,rule.nextAt),stamp('2026-10-12T09:00:00'));
 assert.throws(()=>api.makeReminder({kind:'weekly',date:'2026-10-07',time:'09:00',days:[]}),/选择一个星期/);
});
test('fixed interval keeps its original calendar cadence across months and late completion',()=>{
 const {api}=setup(),rule=api.makeReminder({kind:'interval',date:'2026-10-30',time:'09:00',interval:3},stamp('2026-10-30T08:00:00'));
 assert.equal(api.nextReminder(rule,rule.nextAt),stamp('2026-11-02T09:00:00'));
 const task={status:'todo',reminder:rule,sessionId:'s'},patch=api.completionPatch(task,stamp('2026-11-03T12:00:00'));
 assert.equal(patch.reminder.nextAt,stamp('2026-11-05T09:00:00'));assert.equal(patch.status,'done');assert.equal(patch.completions.length,1);assert.equal(task.sessionId,'s');
 assert.throws(()=>api.makeReminder({kind:'interval',date:'2026-10-30',time:'09:00',interval:0}),/1 到 365/);
});
test('restart wakes the completed recurring task but does not duplicate or reschedule unfinished work',async()=>{
 const now=stamp('2026-10-08T10:00:00');class FixedDate extends Date{static now(){return now;}}
 const ctx=setup({Date:FixedDate,setTimeout,clearTimeout,BroadcastChannel:undefined});
 const recurring={kind:'weekly',date:'2026-10-07',time:'09:00',days:[4],nextAt:stamp('2026-10-08T09:00:00'),notifiedAt:null};
 const tasks=[{id:'done',status:'done',sessionId:'s',reminder:{...recurring}},{id:'late',status:'todo',reminder:{...recurring}},{id:'once',status:'done',reminder:{...recurring,kind:'once'}},{id:'deleted',status:'done',deletedAt:1,reminder:{...recurring}}];
 const repo={list:async()=>tasks,materials:async()=>[],update:async(id,patch)=>{const task=tasks.find(t=>t.id===id),value=typeof patch==='function'?patch(task):patch;if(value)Object.assign(task,value);return task;},close:()=>{}};
 ctx.repo=repo;ctx.bridge={};vm.runInContext(read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 await ctx.model.checkReminders();assert.equal(tasks.length,4);assert.equal(tasks[0].status,'todo');assert.equal(tasks[0].sessionId,'s');assert.equal(tasks[1].reminder.nextAt,recurring.nextAt);assert.equal(tasks[2].status,'done');assert.equal(tasks[3].status,'done');
 await ctx.model.dismissReminders(['late']);assert.equal(tasks[1].reminder.notifiedAt,recurring.nextAt);
 await ctx.model.toggleComplete('late');assert.equal(tasks[1].status,'done');assert.equal(tasks[1].reminder.nextAt,stamp('2026-10-15T09:00:00'));assert.equal(tasks[1].completions.length,1);await ctx.model.dispose();
});
