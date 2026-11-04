import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
// Values are encoded as UTF-8 hex literals; never interpolate model-generated SQL.
export function sqliteText(value){return "CAST(X'"+Buffer.from(String(value),'utf8').toString('hex')+"' AS TEXT)";}
export async function sqliteRun(executable,database,sql){
 if(!path.isAbsolute(database))throw new Error('数据库路径必须为绝对路径。');
 await fs.mkdir(path.dirname(database),{recursive:true});
 return new Promise((resolve,reject)=>{
  const child=execFile(executable,['-batch','-bail','-json',database],{windowsHide:true,timeout:10000,maxBuffer:4*1024*1024,encoding:'utf8'},(error,stdout,stderr)=>{if(error){reject(new Error(error.code==='ENOENT'?'找不到 SQLite 工具，请检查安装位置。':'数据库操作未完成：'+String(stderr||error.message).slice(0,300)));return;}try{resolve(stdout.trim()?JSON.parse(stdout):[]);}catch{reject(new Error('数据库返回格式有误。'));}});
  child.stdin.on('error',()=>{});child.stdin.end('.timeout 5000\nPRAGMA foreign_keys=ON;\n'+sql);
 });
}
