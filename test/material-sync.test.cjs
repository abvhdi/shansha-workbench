const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('material sync stages files without sending or replacing text and imports each draft once',async()=>{
 let releases=0,imports=0,cleaned=0;const attached=[];
 const input={snapshot:{phase:'plain',draft:'正在写的消息',attachmentIds:['chat-file']},actions:{addAttachments:ids=>{attached.push(...ids);return true;}}};
 const conversation={input:{for:()=>input},createDrafts:(id,files)=>{assert.equal(id,'s');assert.equal(files[0].name,'data.txt');return [{id:'from-task'}];},releaseDraftAttachments:()=>cleaned++,resolveDraftAttachments:()=>[{id:'chat-file',file:new File(['聊天附件'],'chat.txt')}]};
 const ctx={sessions:{retain:()=>({ready:Promise.resolve({ctx:{},session:{getSnapshot:()=>({openState:'ready'})}}),release:()=>releases++})},get:()=>conversation};
 const repo={importMaterial:async()=>{imports++;return true;}},sandbox=vm.createContext({ctx,repo,File});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8'),sandbox);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+'\nglobalThis.bridge=new HarnessBridge(ctx,repo);',sandbox);
 const task={id:'t',sessionId:'s'};
 await sandbox.bridge.stageMaterials(task,[{name:'data.txt',type:'text/plain',createdAt:1,blob:new Blob(['数据'])}]);
 assert.deepEqual(attached,['from-task']);assert.equal(input.snapshot.draft,'正在写的消息');assert.equal(cleaned,0);
 assert.equal(await sandbox.bridge.importDraftMaterials(task),1);assert.equal(await sandbox.bridge.importDraftMaterials(task),0);assert.equal(imports,1);
 input.snapshot.phase='submitting';await assert.rejects(sandbox.bridge.stageMaterials(task,[{name:'data.txt',blob:new Blob()}]),/正在提交/);assert.equal(releases,4);
});
