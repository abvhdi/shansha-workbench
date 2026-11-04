const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
test('native store writes checked bytes, replaces one copy, migrates and keeps foreign conflicts',async()=>{
 const home=await fsp.mkdtemp(path.join(os.tmpdir(),'shansha-native-test-'));await fsp.mkdir(path.join(home,'.dsh'));
 const source=fs.readFileSync(path.join(__dirname,'../lib/index.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+'\nglobalThis.Files=makeFiles(TypertRemoteService,Remote);';
 const ctx=vm.createContext({fs:fsp,path,os:{homedir:()=>home},crypto,Buffer,Uint8Array,TypertRemoteService:class{},Remote:()=>{}});vm.runInContext(source,ctx);
 const store=new ctx.Files({});const info=await store.info();assert.ok(info.root.endsWith('珊莎工作台文件'));
 async function write(text){const bytes=Buffer.from(text),hash=crypto.createHash('sha256').update(bytes).digest('hex');const opened=await store.begin({id:'f',size:bytes.length,hash,project:'项目-p',task:'待办-t',name:'结果.txt'});if(opened.unchanged)return opened;await store.chunk({token:opened.token,data:bytes.toString('base64')});return store.commit({token:opened.token});}
 const first=await write('A');assert.equal(await fsp.readFile(first.path,'utf8'),'A');assert.equal((await write('A')).unchanged,true);const second=await write('B');assert.equal(first.path,second.path);assert.equal(await fsp.readFile(second.path,'utf8'),'B');
 const saved=(await store.load()).files.f;assert.ok(saved.backupName);assert.equal(await fsp.readFile(path.join(home,'Documents','珊莎工作台备份','材料',saved.backupName),'utf8'),'B');
 const original=path.join(home,'original.txt');await fsp.writeFile(original,'changed');
 await assert.rejects(store.removeOriginal({fileId:'missing',sourcePath:original}),/尚未保存/);
 await assert.rejects(store.removeOriginal({fileId:'f',sourcePath:original}),/内容已变化/);assert.equal(await fsp.readFile(original,'utf8'),'changed');
 await fsp.writeFile(original,'B');assert.equal((await store.removeOriginal({fileId:'f',sourcePath:original})).removed,true);await assert.rejects(fsp.access(original));assert.equal(await fsp.readFile(second.path,'utf8'),'B');
 assert.equal((await store.removeOriginal({fileId:'f',sourcePath:second.path})).removed,false);
 const next=path.join(home,'new-root');await store.change({root:next});assert.equal((await store.info()).root,next);assert.equal(await fsp.readFile(path.join(next,'项目-p','待办-t','结果.txt'),'utf8'),'B');await assert.rejects(fsp.access(first.path));
 const conflict=path.join(next,'项目-p','待办-t','外部.txt');await fsp.writeFile(conflict,'external');const bytes=Buffer.from('new'),hash=crypto.createHash('sha256').update(bytes).digest('hex');const alternate=await store.begin({id:'x',size:bytes.length,hash,project:'项目-p',task:'待办-t',name:'外部.txt'});await store.chunk({token:alternate.token,data:bytes.toString('base64')});const result=await store.commit({token:alternate.token});assert.equal(await fsp.readFile(conflict,'utf8'),'external');assert.ok(result.path.endsWith('外部（2）.txt'));assert.equal(await fsp.readFile(result.path,'utf8'),'new');assert.equal((await store.begin({id:'x',size:bytes.length,hash,project:'项目-p',task:'待办-t',name:'外部.txt'})).unchanged,true);
 await assert.rejects(store.confined(next,'../escape.txt'),/超出/);
 const boundary=await store.begin({id:'reserved',size:0,hash:crypto.createHash('sha256').update('').digest('hex'),project:'CON',task:'中文名·特殊字符★',name:'a b(1).txt'});const boundaryPath=store.pending.get(boundary.token).target;assert.ok(boundaryPath.includes('未命名'));assert.ok(boundaryPath.endsWith('a b(1).txt'));await store.cancel({token:boundary.token});
 assert.ok(home.startsWith(path.resolve(os.tmpdir())+path.sep));await fsp.rm(home,{recursive:true,force:true});
});
test('all chats can query real todos while full material and history access stays coordinator scoped',async()=>{
 const home=await fsp.mkdtemp(path.join(os.tmpdir(),'shansha-tools-test-'));await fsp.mkdir(path.join(home,'.dsh'));
 const source=fs.readFileSync(path.join(__dirname,'../lib/index.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+'\nglobalThis.Files=makeFiles(TypertRemoteService,Remote);globalThis.install=installWorkTools;';
 const sandbox=vm.createContext({fs:fsp,path,os:{homedir:()=>home},crypto,Buffer,Uint8Array,AbortController,console,TypertRemoteService:class{},Remote:()=>{}});vm.runInContext(source,sandbox);
 const store=new sandbox.Files({}),task={id:'t',title:'测试',status:'todo',sessionId:'linked'};
 await store.snapshot({tasks:[task],projects:[],materials:[],workSession:'work'});assert.equal((await store.work()).events[0].type,'task-observed');
 await store.snapshot({tasks:[task],projects:[],materials:[]});assert.equal((await store.work()).events.length,1);
 await store.snapshot({tasks:[{...task,status:'done'}],projects:[],materials:[]});assert.equal((await store.work()).events.at(-1).type,'task-completed');const backup=JSON.parse(await fsp.readFile(path.join(home,'Documents','珊莎工作台备份','工作记录.json'),'utf8'));assert.equal(backup.tasks[0].status,'done');assert.ok(await fsp.readFile(path.join(home,'Documents','珊莎工作台备份','上次工作记录.json'),'utf8'));
 const tools=[];let listener,historyRequest;const agent={id:'work',ctx:{get:()=>({register:definition=>tools.push(definition)})}};
 const ctx={on:(_name,fn)=>{listener=fn;},get:name=>name==='agents'?{list:()=>[]}:{page:async request=>{historyRequest=request;return {messages:[],cursor:null};}}};
 sandbox.install(ctx,store);await listener({agent});assert.equal(tools.length,3);
 const query=tools.find(t=>t.name==='query_shansha_work');assert.equal((await query.execute({}, {agent})).tasks[0].status,'done');await assert.rejects(query.execute({}, {agent:{id:'other'}}),/不匹配/);
 const otherTools=[],other={id:'ordinary',ctx:{get:()=>({register:d=>otherTools.push(d)})}};await listener({agent:other});assert.equal(otherTools.length,3);const ordinaryQuery=otherTools.find(t=>t.name==='query_shansha_work');const result=await ordinaryQuery.execute({}, {agent:other});assert.equal(result.tasks[0].id,'t');assert.equal(result.access.isCoordinator,false);assert.equal(result.access.coordinatorSessionId,'work');await assert.rejects(otherTools.find(t=>t.name==='read_shansha_chat').execute({taskId:'t'},{agent:other}),/总会话/);
 const history=tools.find(t=>t.name==='read_shansha_chat');await assert.rejects(history.execute({taskId:'unlinked'},{agent}),/没有关联/);await history.execute({taskId:'t'},{agent});assert.equal(historyRequest.address.sessionId,'linked');assert.equal(historyRequest.maxMessages,10);
 assert.ok(home.startsWith(path.resolve(os.tmpdir())+path.sep));await fsp.rm(home,{recursive:true,force:true});
});

test('file opening falls back to Windows chooser with literal escaped paths',async()=>{
 const calls=[];let failed=false;
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.Files=makeFiles(TypertRemoteService,Remote);';
 const ctx=vm.createContext({process:{env:{ELECTRON_RUN_AS_NODE:'1',ELECTRON_NO_ASAR:'1',PATH:'system-path'}},fs:{access:async()=>{}},path,os,crypto,Buffer,TypertRemoteService:class{},Remote:()=>{},execFile:(exe,args,options,callback)=>{calls.push({exe,args,options,code:Buffer.from(args.at(-1),'base64').toString('utf16le')});if(!failed){failed=true;callback(Error('no association'),'','no association');}else callback(null,'','');}});vm.runInContext(source,ctx);
 const store=new ctx.Files({});store.load=async()=>({root:'C:/files',files:{f:{relative:"a'b.txt"}}});store.confined=async(root,relative)=>root+'/'+relative;
 assert.equal((await store.open({fileId:'f'})).openWith,true);assert.equal(calls.length,2);assert.ok(calls[0].code.includes("a''b.txt"));assert.ok(calls[1].code.includes('SHOpenWithDialog'));assert.ok(calls[1].code.includes('$info.Flags = 4'));assert.equal(calls[1].options.windowsHide,true);assert.equal(calls[1].options.env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(calls[1].options.env.ELECTRON_NO_ASAR,undefined);assert.equal(calls[1].options.env.PATH,'system-path');
 assert.equal((await store.open({fileId:'missing'})).needsSave,true);assert.equal(calls.length,2);
 calls.length=0;assert.equal((await store.open({fileId:'f'})).opened,true);assert.equal(calls.length,1);
 calls.length=0;await store.open({fileId:'f',openWith:true});assert.equal(calls.length,1);assert.ok(calls[0].code.includes('SHOpenWithDialog'));
 store.load=async()=>({root:'C:/files',files:{f:{relative:'test.md'}}});calls.length=0;await store.open({fileId:'f'});assert.equal(calls.length,1);assert.ok(calls[0].code.includes('SHOpenWithDialog'));
 store.load=async()=>({root:'C:/files',files:{f:{relative:'视频.MP4'}}});calls.length=0;assert.equal((await store.open({fileId:'f'})).opened,true);assert.equal(calls.length,1);assert.ok(calls[0].code.includes('Start-Process'));
 store.load=async()=>({root:'C:/files',files:{f:{relative:'资料.custom'}}});calls.length=0;assert.equal((await store.open({fileId:'f'})).openWith,true);assert.equal(calls.length,1);assert.ok(calls[0].code.includes('SHOpenWithDialog'));
 failed=false;calls.length=0;await assert.rejects(store.open({directory:true}),/文件夹/);assert.equal(calls.length,1);
});

test('atomic replacement retries temporary Windows locks and preserves destination on permanent failure',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.replace=replaceFile;';
 let attempts=0,removed=0;const delays=[];const ctx=vm.createContext({fs:{rename:async()=>{if(++attempts<3)throw Object.assign(Error('locked'),{code:'EPERM'});},unlink:async()=>removed++},setTimeout:(fn,ms)=>{delays.push(ms);fn();}});vm.runInContext(source,ctx);
 await ctx.replace('temp','destination');assert.equal(attempts,3);assert.equal(removed,0);assert.deepEqual(delays,[50,100]);
 ctx.fs.rename=async()=>{attempts++;throw Object.assign(Error('locked'),{code:'EPERM'});};attempts=0;await assert.rejects(ctx.replace('temp','destination'),/locked/);assert.equal(attempts,6);assert.equal(removed,1);
 ctx.fs.rename=async()=>{attempts++;throw Object.assign(Error('missing'),{code:'ENOENT'});};attempts=0;await assert.rejects(ctx.replace('temp','destination'),/missing/);assert.equal(attempts,1);
});

test('opening executable and shortcut materials is blocked before shell launch',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.Files=makeFiles(TypertRemoteService,Remote);';let calls=0;
 const ctx=vm.createContext({fs:{access:async()=>{}},path,os,crypto,Buffer,TypertRemoteService:class{},Remote:()=>{},execFile:()=>calls++});vm.runInContext(source,ctx);const store=new ctx.Files({});store.load=async()=>({files:{f:{relative:'bad.exe'}}});store.confined=async()=> 'C:/bad.exe';await assert.rejects(store.open({fileId:'f'}),/程序或脚本/);assert.equal(calls,0);
});
test('native opener receives a literal file path and chooser option without a PowerShell startup',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.Files=makeFiles(TypertRemoteService,Remote);';let call;
 const ctx=vm.createContext({process:{env:{}},fs:{access:async()=>{},stat:async()=>({isFile:()=>true})},path,os,crypto,Buffer,TypertRemoteService:class{},Remote:()=>{},execFile:(exe,args,opts,callback)=>{call={exe,args};callback(null,'','');}});vm.runInContext(source,ctx);
 const store=new ctx.Files({});store.load=async()=>({root:'C:/files',files:{f:{relative:'视频 with spaces.mp4'}}});store.confined=async()=> 'C:/files/视频 with spaces.mp4';assert.equal((await store.open({fileId:'f'})).opened,true);assert.ok(call.exe.endsWith('shansha-native-open.exe'));assert.deepEqual(Array.from(call.args),['C:/files/视频 with spaces.mp4']);
 assert.equal((await store.open({fileId:'f',openWith:true})).openWith,true);assert.equal(call.args[1],'--choose');
});

test('automatic backup status and file chunks can be restored and reject unknown ids',async()=>{
 const home=await fsp.mkdtemp(path.join(os.tmpdir(),'shansha-backup-test-'));try{await fsp.mkdir(path.join(home,'.dsh'));
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.Files=makeFiles(TypertRemoteService,Remote);';
 const ctx=vm.createContext({fs:fsp,path,os:{homedir:()=>home},crypto,Buffer,Uint8Array,TypertRemoteService:class{},Remote:()=>{}});vm.runInContext(source,ctx);const store=new ctx.Files({});assert.equal((await store.backupInfo()).lastSuccess,null);
 const bytes=Buffer.from('恢复测试'),hash=crypto.createHash('sha256').update(bytes).digest('hex'),started=await store.begin({id:'m',name:'材料.md',size:bytes.length,hash,project:'P',task:'T'});await store.chunk({token:started.token,data:bytes.toString('base64')});await store.commit({token:started.token});
 const request={tasks:[{id:'t',title:'待办',description:'',status:'todo',createdAt:1}],projects:[],materials:[{id:'m',taskId:'t',name:'材料.md',type:'text/markdown',size:bytes.length,hash}]};await store.snapshot(request);request.tasks[0].description='修改';await store.snapshot(request);const info=await store.backupInfo();assert.ok(info.lastSuccess);assert.ok(info.previousSuccess);
 const part=await store.backupBytes({fileId:'m',offset:0,length:4});assert.equal(Buffer.from(part.data,'base64').length,4);assert.equal(part.size,bytes.length);await assert.rejects(store.backupBytes({fileId:'../outside',offset:0,length:1}),/不存在/);
 const browser=vm.createContext({console,Blob,crypto,Uint8Array,atob,btoa});vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/bridge.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../src/backup.js'),'utf8')+';globalThis.Bridge=HarnessBridge;',browser);const bridge=new browser.Bridge({},{});bridge.nativeCall=async(method,args={})=>store[method.split('/')[1]](args.request);const restored=await bridge.loadAutomaticBackup();assert.equal(await restored.materials[0].blob.text(),'恢复测试');assert.equal(restored.tasks[0].description,'修改');const previous=await bridge.loadAutomaticBackup(true);assert.equal(previous.tasks[0].description,'');
 }finally{assert.ok(home.startsWith(path.resolve(os.tmpdir())+path.sep));await fsp.rm(home,{recursive:true,force:true});}
});

test('linked task tools read latest state, limit materials, and revoke on unlink',async()=>{
 const definitions=new Map(),listeners=[];const task={id:'t',title:'周会',description:'原备注',status:'todo',sessionId:'s',steps:[]};const other={id:'u',title:'私有任务',status:'todo',sessionId:'other'};const state={tasks:[task,other],projects:[],materials:[{id:'m',taskId:'t',name:'说明.md',size:4,type:'text/markdown'},{id:'private',taskId:'u',name:'私有.md'}],syncedAt:1};
 const agent={id:'s',ctx:{get:()=>({register:d=>definitions.set(d.name,d)})}},unrelated={id:'unrelated',ctx:{get:()=>({register:()=>{}})}};let previousCalls=0;
 const store={localManifest:async()=>({files:[]}),work:async()=>state,load:async()=>({root:'C:/root',files:{m:{relative:'说明.md'}}}),confined:async()=> 'C:/root/说明.md',onWorkSession:()=>previousCalls++};
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.install=installTaskTools;';const ctx=vm.createContext({fs:{stat:async()=>({size:4}),readFile:async()=> '文件内容'},console});vm.runInContext(source,ctx);
 const host={on:(_event,fn)=>listeners.push(fn),get:()=>({list:()=>[agent,unrelated]})};const initial=task.sessionId;task.sessionId='';ctx.install(host,store);await listeners[0]({agent});task.sessionId=initial;assert.equal(previousCalls,1);assert.equal(definitions.size,4);
 const exec={agent},read=definitions.get('read_shansha_task').execute,file=definitions.get('read_shansha_task_file').execute;const first=await read({},exec);assert.equal(first.task.description,'原备注');assert.equal(first.materials.length,1);const actualValues=await import('../../../work/harness-inspect/packages/dsh-util-values/lib/index.js');assert.equal(actualValues.snapshotJsonValue({origin:undefined}),undefined);assert.ok(actualValues.snapshotJsonValue(first));assert.equal(Object.hasOwn(first.materials[0],'origin'),false);task.description='刚修改的备注';state.syncedAt=2;const updated=await read({},exec);assert.equal(updated.task.description,'刚修改的备注');assert.equal(updated.syncedAt,2);
 assert.equal((await file({fileId:'m'},exec)).text,'文件内容');await assert.rejects(file({fileId:'private'},exec),/关联范围/);await assert.rejects(read({taskId:'u'},exec),/关联范围/);
 other.sessionId='s';const choices=await read({},exec);assert.ok(choices.needsSelection);assert.equal(choices.tasks.length,2);assert.ok(actualValues.snapshotJsonValue(choices));assert.equal((await read({taskId:'t'},exec)).task.id,'t');
 task.updatedAt=10;const update=definitions.get('update_shansha_task').execute;store.editTask=async command=>({taskId:command.taskId,expectedUpdatedAt:command.expectedUpdatedAt});await assert.rejects(update({taskId:'t',expectedUpdatedAt:10,action:'set_title',text:'新标题'},exec),/版本未经过读取/);await read({taskId:'t'},exec);await assert.rejects(update({taskId:'t',expectedUpdatedAt:9,action:'set_title',text:'新标题'},exec),/版本未经过读取/);assert.equal((await update({taskId:'t',expectedUpdatedAt:10,action:'set_title',text:'新标题'},exec)).taskId,'t');await assert.rejects(update({taskId:'t',expectedUpdatedAt:10,action:'set_title',text:'重试'},exec),/版本未经过读取/);
 task.sessionId='';other.sessionId='other';await assert.rejects(read({},exec),/没有关联待办/);await assert.rejects(file({fileId:'m'},exec),/没有关联待办/);
});

test('agent edit waits for committed client acknowledgement and returns lossless JSON',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.Files=makeFiles(TypertRemoteService,Remote);';const ctx=vm.createContext({fs:fsp,path,os,crypto,setTimeout,clearTimeout,TypertRemoteService:class{},Remote:()=>{}});vm.runInContext(source,ctx);const store=new ctx.Files({});let finished=false;
 const pending=store.editTask({sessionId:'s',taskId:'t',action:'append_note',text:'备注',optional:undefined}).then(result=>{finished=true;return result;});const queue=await store.taskEdits();assert.equal(queue.commands.length,1);assert.equal(finished,false);assert.equal(Object.hasOwn(queue.commands[0],'optional'),false);
 await store.finishTaskEdit({id:queue.commands[0].id,result:{task:{id:'t',description:'备注'},undoId:queue.commands[0].id}});assert.equal((await pending).task.description,'备注');assert.equal((await store.taskEdits()).commands.length,0);
 const rejected=store.editTask({taskId:'t'});const next=await store.taskEdits();await store.finishTaskEdit({id:next.commands[0].id,error:'版本冲突'});await assert.rejects(rejected,/版本冲突/);
});
test('copy file validates registered material and uses persistent Windows copy clipboard',async()=>{
 let invoked,clipboardCode;const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'')+';globalThis.Files=makeFiles(TypertRemoteService,Remote);';const v=vm.createContext({fs:{stat:async()=>({isFile:()=>true})},path,os,crypto,Buffer,TypertRemoteService:class{},Remote:()=>{},execFile:(exe,args,options,cb)=>{invoked={exe,args,options};clipboardCode=Buffer.from(args[args.length-1],'base64').toString('utf16le');cb(null,'','');}});vm.runInContext(source,v);const store=new v.Files({});store.load=async()=>({root:'C:/files',files:{m:{relative:'资料.txt'}}});store.confined=async()=>"C:/files/中文 ' 文件.txt";
 assert.equal((await store.copyFile({fileId:'m'})).copied,true);assert.equal(invoked.exe,'powershell.exe');assert.ok(invoked.args.includes('-STA'));assert.equal(invoked.options.windowsHide,true);assert.ok(clipboardCode.includes("中文 '' 文件.txt"));assert.ok(clipboardCode.includes('SetFileDropList'));assert.ok(clipboardCode.includes('SetDataObject($data, $true'));assert.ok(clipboardCode.includes('(1,0,0,0)'));await assert.rejects(store.copyFile({fileId:'foreign'}),/尚未保存/);
});
test('all remote method signatures pass the actual Harness gateway parser',()=>{
 const gateway=fs.readFileSync(path.join(__dirname,'../../../work/harness-inspect/_dsh_node_modules_@deepseek-ai_dsh-api-gateway_lib_index.js'),'utf8');const parser=gateway.slice(gateway.indexOf('function methodParameterNames('),gateway.indexOf('function assertExactArguments('));const names=[];const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');const ctx=vm.createContext({path,os,TypertRemoteService:class{},Remote:(_fn,metadata)=>names.push(metadata.name),TypertGatewayError:class extends Error{constructor(_code,_endpoint,message){super(message);}}});vm.runInContext(source+';globalThis.Files=makeFiles(TypertRemoteService,Remote);'+parser+';globalThis.parse=methodParameterNames;',ctx);const store=new ctx.Files({});for(const name of names)assert.doesNotThrow(()=>ctx.parse(store,name,'shanshaFiles/'+name),name);class Invalid{prune(...args){}}assert.throws(()=>ctx.parse(new Invalid(),'prune','test'),/unique identifier/);assert.ok(names.length>=15);
});


