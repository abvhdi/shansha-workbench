import crypto from 'node:crypto';
import {sqliteText as q} from './sqlite-store.js';
export const groupSchema=`
CREATE TABLE IF NOT EXISTS table_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS table_group_members(table_id TEXT PRIMARY KEY REFERENCES data_tables(id) ON DELETE CASCADE,group_id TEXT NOT NULL REFERENCES table_groups(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS table_sort(table_id TEXT PRIMARY KEY REFERENCES data_tables(id) ON DELETE CASCADE,position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS table_group_setup(id INTEGER PRIMARY KEY CHECK(id=1));
`;
export function groupPlan(input,catalog){
 const operation=input.groupOperation,groups=catalog.groups||[],old=groups.find(g=>g.id===input.groupId);let groupId=input.groupId||'',name=String(input.name||'').trim();
 if(!['create','rename','delete','move'].includes(operation))throw Error('请选择新建、重命名、删除分组或移动表格。');
 if(operation==='create'||operation==='rename'){
  if(!name||name.length>60||name==='未分组')throw Error('请填写1到60字的分组名，「未分组」为保留名称。');
  if(groups.some(g=>(operation!=='rename'||g.id!==groupId)&&g.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('已有同名分组，请换个名字。');
 }
 if(operation==='create'){if(groups.length>=50)throw Error('最多创建50个分组');groupId=crypto.randomUUID();}
 else if(operation!=='move'||groupId){if(!old)throw Error('分组已不存在，请刷新后重试。');if(operation!=='rename')name=old.name;}
 let tableIds=input.tableIds||[];if(!Array.isArray(tableIds)||tableIds.length>100||new Set(tableIds).size!==tableIds.length||tableIds.some(id=>!catalog.tables.some(t=>t.id===id)))throw Error('要移动的数据表已不存在或选择重复，请刷新后重试。');
 if(operation==='move'&&!tableIds.length)throw Error('请选择要移动的数据表。');
 if(operation==='delete')tableIds=catalog.tables.filter(t=>t.groupId===groupId).map(t=>t.id);
 if(operation==='rename')tableIds=[];
 let tableOrder=[];if(operation==='move'||operation==='create'){
  const members=catalog.tables.filter(t=>(t.groupId||'')===groupId&&!tableIds.includes(t.id)).map(t=>t.id);let at=members.length;
  if(input.anchorTableId){const anchor=catalog.tables.find(t=>t.id===input.anchorTableId);if(operation!=='move'||!anchor||(anchor.groupId||'')!==groupId||tableIds.includes(anchor.id)||!['before','after'].includes(input.placement))throw Error('排序位置已变化，请重新拖动。');at=members.indexOf(anchor.id)+(input.placement==='after'?1:0);}
  members.splice(at,0,...tableIds);tableOrder=members;
 }
 return {action:'group',table:{id:'',name:'数据表分组',columns:[],formulas:{}},rows:[],group:{operation,id:groupId,name:name||'未分组',tableIds,tableOrder,...input.anchorTableId?{anchorName:catalog.tables.find(t=>t.id===input.anchorTableId).name,placement:input.placement}:{},tables:tableIds.map(id=>catalog.tables.find(t=>t.id===id).name),...(operation==='rename'?{beforeName:old.name}:{})}};
}
export function groupSQL(plan){const g=plan.group;let sql='';if(g.operation==='create')sql='INSERT INTO table_groups VALUES('+q(g.id)+','+q(g.name)+');';if(g.operation==='rename')return 'UPDATE table_groups SET name='+q(g.name)+' WHERE id='+q(g.id)+';';if(g.operation==='delete')return 'DELETE FROM table_groups WHERE id='+q(g.id)+';';for(const id of g.tableIds){sql+='DELETE FROM table_group_members WHERE table_id='+q(id)+';';if(g.id)sql+='INSERT INTO table_group_members VALUES('+q(id)+','+q(g.id)+');';}for(const [index,id]of(g.tableOrder||[]).entries())sql+='INSERT OR REPLACE INTO table_sort VALUES('+q(id)+','+index+');';return sql;}
export async function setupSalesGroups(db){return db.serial(async()=>{const catalog=await db.catalog();if((await db.run('SELECT id FROM table_group_setup WHERE id=1;')).length)return {existing:true,catalog};const template=(await db.run("SELECT mapping_json FROM business_templates WHERE name='sales-v1';"))[0];if(!template)return {skipped:true,catalog};const mapping=JSON.parse(template.mapping_json);let sql='';for(const [name,keys]of [['基础资料',['customers','products']],['销售业务',['orders','lines','contracts']],['财务',['invoices','payments']],['交付',['deliveries']]]){const group=catalog.groups.find(g=>g.name===name),id=group?.id||crypto.randomUUID();if(!group)sql+='INSERT INTO table_groups VALUES('+q(id)+','+q(name)+');';for(const key of keys)if(catalog.tables.some(t=>t.id===mapping[key]))sql+='INSERT OR IGNORE INTO table_group_members VALUES('+q(mapping[key])+','+q(id)+');';}await db.run('BEGIN IMMEDIATE;CREATE TEMP TABLE guard(ok INTEGER CHECK(ok=1));INSERT INTO guard SELECT CASE WHEN revision='+catalog.revision+' THEN 1 ELSE 0 END FROM meta;'+sql+'INSERT INTO table_group_setup VALUES(1);UPDATE meta SET revision=revision+1 WHERE id=1;COMMIT;');return {catalog:await db.catalog()};});}
