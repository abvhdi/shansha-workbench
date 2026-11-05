const {test}=require('node:test'),assert=require('node:assert/strict');
test('macOS and Linux runtime selection never attempts the Windows SQLite binary',async()=>{
 const {sqliteCandidates,resolveSQLite,bundledSQLite}=await import('../src/sqlite-runtime.js');
 for(const platform of ['darwin','linux'])assert.ok(sqliteCandidates(platform,'/Applications/Harness').every(p=>!p.endsWith('.exe')&&!p.includes('G:')));
 assert.equal(bundledSQLite('darwin'),'/usr/bin/sqlite3');assert.ok(bundledSQLite('win32').endsWith('sqlite3.exe'));
 const tried=[];const selected=await resolveSQLite({platform:'darwin',access:async()=>{},probe:async candidate=>{tried.push(candidate);if(candidate==='/usr/bin/sqlite3')throw Error('older CLI lacks JSON');}});
 assert.equal(selected,'/opt/homebrew/bin/sqlite3');assert.deepEqual(tried,['/usr/bin/sqlite3','/opt/homebrew/bin/sqlite3']);
});
test('runtime selection checks executability and reports missing compatible runtime clearly',async()=>{
 const {resolveSQLite}=await import('../src/sqlite-runtime.js');let probed=[];
 const selected=await resolveSQLite({platform:'linux',access:async()=>{throw Error('missing');},probe:async candidate=>{probed.push(candidate);}});
 assert.equal(selected,'sqlite3');assert.deepEqual(probed,['sqlite3']);
 await assert.rejects(resolveSQLite({platform:'darwin',access:async()=>{},probe:async()=>{throw Error('not usable');}}),/支持 JSON/);
});
test('bundled Windows SQLite passes the same in-memory capability probe',async()=>{
 if(process.platform!=='win32')return;const {probeSQLite,bundledSQLite}=await import('../src/sqlite-runtime.js');assert.equal(await probeSQLite(bundledSQLite()),true);
});
