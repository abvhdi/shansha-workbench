const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const root=path.join(__dirname,'../../../work/harness-022/packages'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
test('DSH 0.2.2-rc.1 gateway accepts all plugin RPC method signatures',()=>{
 assert.equal(JSON.parse(read('dsh/package.json')).version,'0.2.2-rc.1');
 assert.ok(require('../package.json').peerDependencies['@deepseek-ai/dsh'].split(' || ').includes('0.2.2-rc.1'));
 const g=read('dsh-api-gateway/lib/index.js'),a=g.indexOf('function methodParameterNames('),b=g.indexOf('function assertExactArguments(');assert.ok(a>=0&&b>a);
 const src=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,''),names=[],v=vm.createContext({path,os,Remote:(_fn,m)=>names.push(m.name),TypertRemoteService:class{},TypertGatewayError:class extends Error{constructor(_c,_e,m){super(m);}}});
 vm.runInContext(src+';globalThis.Files=makeFiles(TypertRemoteService,Remote);'+g.slice(a,b)+';globalThis.parse=methodParameterNames;',v);const store=new v.Files({});for(const n of names)assert.doesNotThrow(()=>v.parse(store,n,'shanshaFiles/'+n),n);assert.ok(names.includes('databaseManual')&&names.includes('workBinding'));
 for(const n of ['dsh-api-workspace-files','dsh-api-workspace-controller','dsh-typert-protocol'])assert.equal(read(n+'/lib/index.js'),fs.readFileSync(path.join(root,'../../harness-rc5/packages',n,'lib/index.js'),'utf8'),n+' unchanged contract');
});
test('new host SessionManager preserves workspace identity and persistent session creation contract',async()=>{
 const s=read('dsh-api-session-controller/lib/types/client/sessions/manager.js'),a=s.indexOf('    async create(opts = {}) {'),b=s.indexOf('\n    /**',a);assert.ok(a>=0&&b>a);const v=vm.createContext({});vm.runInContext('globalThis.Manager=class {'+s.slice(a,b)+'}',v);const manager=new v.Manager();let payload,mutation;
 manager.remote={session:{create:async p=>{payload=p;return {ok:true,value:{sessionId:'existing-id'}};}}};manager.recordMutation=x=>mutation=x;
 const result=await manager.create({workspaceId:'workspace',sessionId:'existing-id'});assert.equal(result.value.sessionId,'existing-id');assert.deepEqual(JSON.parse(JSON.stringify(payload)),{workspaceId:'workspace',sessionId:'existing-id'});assert.equal(mutation.summary.sessionId,'existing-id');
 const service=read('dsh-api-session-controller/lib/types/client/sessions/service.js');assert.match(service,/retain\(target, options\)/);assert.match(service,/reference\.attachOpening\(this\.manager\.get\(id\)\.open\(\), signal\)/);
 const host=read('dsh-api-session-controller/lib/typert.host.js');for(const n of ['create','rename','prompt'])assert.ok(host.includes("@Remote('"+n+"')"),n);
});
