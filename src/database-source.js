function applyDatabaseDelta(page,request,result){
 if(!page||page.table.id!==request.tableId||page.revision!==request.revision||!result.delta||result.delta.deletedTable)return null;
 const d=result.delta,changed=new Map((d.rows||[]).map(r=>[r.id,r])),existing=new Set(page.rows.map(r=>r.id));let rows=page.rows.filter(r=>r.id!==d.removedRowId).map(r=>changed.has(r.id)?{...r,...changed.get(r.id)}:r);rows.push(...(d.rows||[]).filter(r=>!existing.has(r.id)));rows=rows.slice(0,100).map(row=>{if(!d.removedColumn&&!d.renamedColumn)return row;const cells=Object.fromEntries(Object.entries(row.cells).filter(([key])=>key!==d.removedColumn).map(([key,value])=>[key===d.renamedColumn?.from?d.renamedColumn.to:key,value]));return {...row,cells};});const total=page.total+(d.inserted||0)-(d.removedRowId?1:0);return {...page,revision:result.revision,table:{...page.table,...d.columns?{columns:d.columns}:{}},rows,total,limited:page.offset+rows.length<total};
}
class DatabaseDataSource {
 constructor(call,memory={}){this.call=call;this.memory=memory;this.cache=memory.cache||new Map();memory.cache=this.cache;this.generation=0;}
 key(request){return JSON.stringify([request.tableId,request.query||'',request.offset||0]);}
 cancel(){this.generation++;}
 async load(request,publish){const run=++this.generation,key=this.key(request),cached=this.cache.get(key);publish({loading:true,error:'',...cached?{page:cached}:{}});try{const page=await this.call('Read',request);this.cache.delete(key);this.cache.set(key,page);if(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);if(run===this.generation){this.memory.page=page;publish({loading:false,error:'',page});}return page;}catch(error){if(run===this.generation)publish({loading:false,error:error.message||'表格暂时未能读取，请重试。'});throw error;}}
}
