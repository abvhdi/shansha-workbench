const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const ctx=vm.createContext({setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/core.js'),'utf8')+'\nglobalThis.Writer=DraftWriter;',ctx);
test('autosave merges edits and flushes before navigation',async()=>{
  const writes=[],writer=new ctx.Writer(async patch=>writes.push({...patch}));
  writer.schedule({title:'第一版'});writer.schedule({description:'备注'});writer.schedule({title:'最终版'});
  await writer.flush();assert.deepEqual(writes,[{title:'最终版',description:'备注'}]);
});
test('edits arriving during persistence are written in order',async()=>{
  const writes=[];let release;
  const gate=new Promise(resolve=>release=resolve);
  const writer=new ctx.Writer(async patch=>{writes.push({...patch});if(writes.length===1)await gate;});
  writer.schedule({description:'旧'});const flushed=writer.flush();writer.schedule({description:'新'});release();await flushed;
  assert.deepEqual(writes,[{description:'旧'},{description:'新'}]);
});
test('failed persistence retains changes for retry',async()=>{
  let fail=true;const writes=[],writer=new ctx.Writer(async patch=>{if(fail)throw Error('存储失败');writes.push({...patch});});
  writer.schedule({description:'不能丢失'});await assert.rejects(writer.flush(),/存储失败/);fail=false;await writer.flush();
  assert.deepEqual(writes,[{description:'不能丢失'}]);
});
