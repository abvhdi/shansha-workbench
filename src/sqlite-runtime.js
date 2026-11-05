import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function bundledSQLite(platform=process.platform){
 if(platform==='win32')return fileURLToPath(new URL('./vendor/sqlite3.exe',import.meta.url));
 return platform==='darwin'?'/usr/bin/sqlite3':'sqlite3';
}
export function sqliteCandidates(platform=process.platform,executable=process.execPath){
 if(platform==='win32')return [bundledSQLite(platform),path.join(path.dirname(executable),'sqlite3.exe'),'G:/Program Files (x86)/sqlite/sqlite-tools-win-x64-3540100/sqlite3.exe'];
 if(platform==='darwin')return ['/usr/bin/sqlite3','/opt/homebrew/bin/sqlite3','/usr/local/bin/sqlite3','sqlite3'];
 return ['/usr/bin/sqlite3','/usr/local/bin/sqlite3','sqlite3'];
}
export async function probeSQLite(executable){
 return new Promise((resolve,reject)=>execFile(executable,['-batch','-bail','-json',':memory:',`SELECT json_extract('{"ok":1}','$.ok') AS ok,(SELECT count(*) FROM json_each('[1]')) AS count;`],{windowsHide:true,timeout:4000,maxBuffer:1024*1024,encoding:'utf8'},(error,stdout)=>{
  if(error){reject(error);return;}try{const row=JSON.parse(stdout)[0];if(row?.ok!==1||row?.count!==1)throw Error('SQLite JSON capability unavailable');resolve(true);}catch(e){reject(e);}
 }));
}
export async function resolveSQLite({platform=process.platform,executable=process.execPath,access=fs.access,probe=probeSQLite}={}){
 for(const candidate of sqliteCandidates(platform,executable)){
  try{if(path.isAbsolute(candidate))await access(candidate,platform==='win32'?0:1);await probe(candidate);return candidate;}catch{}
 }
 if(platform==='win32')throw Error('找不到可运行的 SQLite，请重新安装完整插件包。');
 throw Error('找不到支持 JSON 的 SQLite 数据库程序。请检查本机 sqlite3 是否可用，或安装新版 SQLite 后重试。');
}
