const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('linked task internal context follows current association without embedding task body',async()=>{
 const contexts=[],definitions=[];
 const agent={id:'session',ctx:{get:()=>({register:value=>definitions.push(value)}),inject:(_keys,fn)=>fn({get:()=>({context:value=>contexts.push(value)})})}};
 const store={workState:{tasks:[{id:'a',sessionId:'session',description:'private task body'}]}};
 const scope=vm.createContext({console});
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
 vm.runInContext(source+';globalThis.install=installTaskTools;',scope);
 scope.install({on:()=>{},get:()=>({list:()=>[agent]})},store);
 await store.onWorkSession();
 assert.equal(contexts.length,1);assert.equal(definitions.length,4);
 assert.match(contexts[0].text(),/read_shansha_task/);assert.match(contexts[0].text(),/"a"/);
 assert.ok(!contexts[0].text().includes('private task body'));
 store.workState={tasks:[{id:'b',sessionId:'session'},{id:'a',sessionId:'session',deletedAt:1}]};
 assert.match(contexts[0].text(),/"b"/);assert.ok(!contexts[0].text().includes('"a"'));
 store.workState.tasks[0].sessionId='other';assert.equal(contexts[0].text(),'');
});
