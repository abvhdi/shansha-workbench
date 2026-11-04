const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../src',name),'utf8');
const at=t=>Date.parse('2026-10-07T'+t+':00+08:00');
test('hourly cadence catches up without duplicate todos, acknowledgement postpones to next occurrence, completion stops reminders',async()=>{
 let now=at('10:15');class Clock extends Date{static now(){return now;}}
 const ctx=vm.createContext({Date:Clock,setTimeout,clearTimeout,BroadcastChannel:undefined});
 vm.runInContext(read('core.js')+'\nglobalThis.make=makeReminder;',ctx);
 const rule=ctx.make({kind:'interval',unit:'hours',interval:1,date:'2026-10-07',time:'11:00'});
 assert.equal(rule.nextAt,at('11:00'));
 const task={id:'h',status:'todo',reminder:rule};
 const repo={list:async()=>[task],materials:async()=>[],update:async(id,patch)=>{const value=typeof patch==='function'?patch(task):patch;if(value)Object.assign(task,value);return task;},close:()=>{}};
 ctx.repo=repo;ctx.bridge={};vm.runInContext(read('plugin.js')+'\nglobalThis.model=createModel(repo,bridge);',ctx);
 now=at('14:20');await ctx.model.checkReminders();assert.equal(task.reminder.nextAt,at('14:00'));
 await ctx.model.dismissReminders(['h']);assert.equal(task.reminder.nextAt,at('15:00'));
 await ctx.model.toggleComplete('h');assert.equal(task.status,'done');now=at('17:00');await ctx.model.checkReminders();assert.equal(task.status,'done');assert.equal(task.reminder.nextAt,at('15:00'));
 await ctx.model.dispose();
});
