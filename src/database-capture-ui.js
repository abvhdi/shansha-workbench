function DatabaseCaptureDialog({capture,model}){
 const [result,setResult]=React.useState(null),[tableId,setTableId]=React.useState(''),[loading,setLoading]=React.useState(true),[saving,setSaving]=React.useState(false),[error,setError]=React.useState('');
 const alive=React.useRef(true),generation=React.useRef(0),proposal=React.useRef(null),panel=React.useRef(null);
 const close=()=>{if(!saving)model.closeDatabaseCapture();};
 const extract=async target=>{const run=++generation.current;setLoading(true);setError('');proposal.current=null;try{const value=await model.bridge.nativeCall('shanshaFiles/databaseExtract',{request:{text:capture.text,tableId:target||undefined}});if(alive.current&&run===generation.current){setResult(value);setTableId(value.tableId||target||'');}}catch(e){if(alive.current&&run===generation.current)setError(e.message||'识别失败，请重试。');}finally{if(alive.current&&run===generation.current)setLoading(false);}};
 React.useEffect(()=>{alive.current=true;extract('');panel.current?.focus();return()=>{alive.current=false;generation.current++;};},[]);
 const confirm=async()=>{if(saving||loading||!result?.rows?.length)return;setSaving(true);setError('');try{
  if(!proposal.current)proposal.current=await model.bridge.nativeCall('shanshaFiles/databasePropose',{request:{revision:result.revision,action:'insert',tableId:result.tableId,rows:result.rows}});
  const value=await model.bridge.nativeCall('shanshaFiles/databaseDecide',{request:{id:proposal.current.id,confirm:true}});
  if(value?.status!=='applied')throw Error('这份方案未执行，请重新识别后确认。');
  model.databaseMemory ||= {recent:[]};model.databaseMemory.cache?.clear();delete model.databaseMemory.page;model.closeDatabaseCapture();
 }catch(e){setError(e.message||'保存失败，请重试确认。');}finally{if(alive.current)setSaving(false);}};
 const table=result?.tables?.find(t=>t.id===result.tableId),columns=table?.columns||[];
 return h('div',{className:'swb-rename-overlay',onClick:e=>{if(e.target===e.currentTarget)close();}},h('section',{className:'swb-database-capture',ref:panel,tabIndex:-1,role:'dialog','aria-modal':true,'aria-label':'加入数据库',onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const fields=[...e.currentTarget.querySelectorAll('button:not(:disabled),select:not(:disabled)')];if(!fields.length){e.preventDefault();return;}const first=fields[0],last=fields.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}},
 h('h2',null,'加入数据库'),loading?h('p',{role:'status'},'正在匹配表和字段…'):h(React.Fragment,null,
 result?.tables?.length>0&&h('label',null,'目标表 ',h('select',{'aria-label':'目标表',value:tableId,disabled:saving,onChange:e=>{setTableId(e.target.value);setResult(r=>({...r,rows:[]}));if(e.target.value)extract(e.target.value);}},h('option',{value:''},'请选择'),result.tables.map(t=>h('option',{key:t.id,value:t.id},t.name)))),
 result?.note&&h('p',{className:'swb-muted'},result.note),
 result?.rows?.length>0&&h('div',{className:'swb-database-capture-grid'},h('table',null,h('thead',null,h('tr',null,columns.map(c=>h('th',{key:c},c)))),h('tbody',null,result.rows.map((row,i)=>h('tr',{key:i},columns.map(c=>h('td',{key:c},String(row.cells[c]??'—')))))))),
 h('details',null,h('summary',null,'查看来源'),h('p',{className:'swb-capture-source'},capture.text))),
 error&&h('p',{role:'alert'},error),h('div',{className:'swb-actions'},h('button',{className:'swb-button',disabled:loading||saving||!result?.rows?.length,onClick:confirm},saving?'正在保存…':'确认加入'),!saving&&!loading&&h('button',{className:'swb-text-button',onClick:()=>extract(tableId)},'重新识别'),h('button',{className:'swb-text-button',disabled:saving,onClick:close},'取消'))));
}
