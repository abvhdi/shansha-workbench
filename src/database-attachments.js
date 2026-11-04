import {sqliteText as q} from './sqlite-store.js';
export const attachmentSchema=`
CREATE TABLE IF NOT EXISTS database_files(id TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,type TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS row_files(row_id TEXT NOT NULL REFERENCES data_rows(id) ON DELETE CASCADE,file_id TEXT NOT NULL REFERENCES database_files(id) ON DELETE RESTRICT,PRIMARY KEY(row_id,file_id));
CREATE INDEX IF NOT EXISTS row_files_file ON row_files(file_id);
`;
export async function enrichAttachments(db,page){if(!page.rows.length)return page;const files=await db.run('SELECT rf.row_id,f.* FROM row_files rf JOIN database_files f ON f.id=rf.file_id WHERE rf.row_id IN ('+page.rows.map(r=>q(r.id)).join(',')+');');for(const row of page.rows)row.attachments=files.filter(f=>f.row_id===row.id).map(({row_id,...f})=>f);return page;}
export async function attachmentPlan(db,input,catalog){const table=catalog.tables.find(t=>t.id===input.tableId);if(!table)throw Error('数据表不存在');if(typeof input.rowId!=='string'||!(await db.run('SELECT id FROM data_rows WHERE table_id='+q(table.id)+' AND id='+q(input.rowId)+';')).length)throw Error('请先填写并保存这一行，再添加附件。');if(typeof input.fileId!=='string')throw Error('请选择已保存的附件。');const file=(await db.run('SELECT * FROM database_files WHERE id='+q(input.fileId)+';'))[0];if(!file)throw Error('附件未保存，请重新添加。');return {action:'attachment',table,rows:[],attachment:{rowId:input.rowId,fileId:input.fileId,name:file.name,remove:input.remove===true}};}
export function attachmentSQL(plan){const a=plan.attachment;return a.remove?'DELETE FROM row_files WHERE row_id='+q(a.rowId)+' AND file_id='+q(a.fileId)+';':'INSERT OR IGNORE INTO row_files VALUES('+q(a.rowId)+','+q(a.fileId)+');';}
