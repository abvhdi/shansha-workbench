const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('answer tail finds latest coordinator query in exact completed turn, including nested calls; ignores other turns, failures and records',()=>{
 const v=vm.createContext({});vm.runInContext(fs.readFileSync(__dirname+'/../src/task-link-cards.js','utf8')+';globalThis.find=taskQueryResultInTurn;globalThis.install=installTaskAnswerLinks',v);
 const result=(seq,coordinator=true)=>({kind:'tool-result',seq,call:{name:'query_shansha_work'},content:[{type:'text',text:JSON.stringify({access:{isCoordinator:coordinator},tasks:[{id:'a',title:'报价'}]})}]});
 const first=result(2),last=result(8),foreign=result(100),failed={...result(10),isError:true};const nodes=new Map([['a',{kind:'tool-call',data:{root:first}}],['b',{kind:'tool-call',data:{root:{subCalls:[last,failed,result(12,false)]}}}],['other',{kind:'tool-call',data:{root:foreign}}]]);const snapshot={nodes,locations:{getTurn:n=>{assert.equal(n,1);return ['a','b'];}}};
 assert.equal(v.find(snapshot,{turn:1,end:{}}),last);assert.equal(v.find(snapshot,{turn:1}),null);nodes.clear();assert.equal(v.find(snapshot,{turn:1,end:{}}),null);let slot;v.install({slots:{inject:(_n,f)=>f(),register:o=>{slot=o;}}},{});assert.equal(slot.name,'conversation.chat.turnTail');
});
