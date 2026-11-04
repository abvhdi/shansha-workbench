const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
test('plugin native methods pass the installed 0.2.1-rc.2 gateway signature parser',()=>{
 const root=path.join(__dirname,'../../../work/harness-021/packages'),pkg=JSON.parse(fs.readFileSync(path.join(root,'dsh/package.json'),'utf8'));assert.equal(pkg.version,'0.2.1-rc.2');
 const gateway=fs.readFileSync(path.join(root,'dsh-api-gateway/lib/index.js'),'utf8'),parser=gateway.slice(gateway.indexOf('function methodParameterNames('),gateway.indexOf('function assertExactArguments('));
 const source=fs.readFileSync(path.join(__dirname,'../src/host.js'),'utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');const names=[],ctx=vm.createContext({path,os,TypertRemoteService:class{},Remote:(_fn,metadata)=>names.push(metadata.name),TypertGatewayError:class extends Error{constructor(_code,_endpoint,message){super(message);}}});
 vm.runInContext(source+';globalThis.Files=makeFiles(TypertRemoteService,Remote);'+parser+';globalThis.parse=methodParameterNames;',ctx);const store=new ctx.Files({});for(const name of names)assert.doesNotThrow(()=>ctx.parse(store,name,'shanshaFiles/'+name),name);assert.ok(names.includes('localManifest'));assert.ok(names.includes('renameFile'));
});
