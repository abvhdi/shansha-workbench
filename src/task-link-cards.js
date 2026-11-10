function taskLinkResult(phase,block){
 if(phase!=='result'||block?.isError||!Array.isArray(block?.content)||block.content.length!==1||block.content[0]?.type!=='text')return null;
 try{const data=JSON.parse(block.content[0].text);if(data?.format!=='shansha-task-links-v1'||!Array.isArray(data.tasks)||!data.tasks.length||data.tasks.length>5||data.tasks.some(t=>typeof t.id!=='string'||!t.id||typeof t.title!=='string'))return null;return data;}catch{return null;}
}
function TaskLinkCards({phase,block,model}){
 const state=React.useSyncExternalStore(model.subscribe,model.snapshot,model.snapshot),[busy,setBusy]=React.useState(''),[error,setError]=React.useState(''),result=taskLinkResult(phase,block);
 React.useEffect(()=>{if(result)model.refresh().catch(e=>setError(e.message));},[block]);
 if(!result)return h('div',{className:'swb-task-link-status',role:'status'},block?.isError?'未能找到待办入口，请重新查询。':phase==='result'?'待办入口暂不可用。':'正在查找待办入口…');
 const action=async(id,chat)=>{if(busy)return;setBusy(id);setError('');try{if(chat)await model.openTaskChat(id);else await model.openTaskFromChat(id);}catch(e){setError(e.message||'暂时无法打开，请重试。');}finally{setBusy('');}};
 return h('section',{className:'swb-task-links','aria-label':'相关待办'},result.tasks.map(item=>{const task=state.tasks.find(t=>t.id===item.id&&!t.deletedAt&&t.kind!=='record'),available=state.loaded&&!!task;return h('article',{key:item.id,className:'swb-task-link-card'},h('strong',null,task?.title||item.title),h('div',{className:'swb-task-link-actions'},h('button',{type:'button',disabled:!!busy||!available,onClick:()=>action(item.id,false)},'打开待办'),h('button',{type:'button',disabled:!!busy||!available,onClick:()=>action(item.id,true)},busy===item.id?'正在打开…':task?.sessionId?'进入会话 ↗':'开始协作')),state.loaded&&!task&&h('small',null,'这条待办已删除或已改为随手记'));}),error&&h('p',{role:'alert'},error));
}
function queryTaskLinkResult(phase,block){
 if(phase!=='result'||block?.isError||block?.content?.length!==1||block.content[0]?.type!=='text')return null;
 try{const data=JSON.parse(block.content[0].text);if(data?.access?.isCoordinator!==true||!Array.isArray(data.tasks)||data.tasks.length>200||data.tasks.some(t=>typeof t.id!=='string'||!t.id||typeof t.title!=='string'))return null;return data.tasks.filter(t=>!t.deletedAt&&t.kind!=='record');}catch{return null;}
}
function QueryTaskLinkCards({phase,block,model}){
 const [page,setPage]=React.useState(0),tasks=queryTaskLinkResult(phase,block);
 React.useEffect(()=>setPage(0),[block]);
 if(!tasks)return h('div',{role:'status'},phase==='result'?'待办查询未提供可用入口，请查看查询结果。':'正在查询待办…');
 if(!tasks.length)return h('div',{role:'status'},'没有符合条件的待办');
 const current=Math.min(page,Math.max(0,Math.ceil(tasks.length/5)-1));
 return h(QueryTaskLinkPage,{block,model,tasks,current,setPage});
}
function QueryTaskLinkPage({block,model,tasks,current,setPage}){
 const cards=React.useMemo(()=>({content:[{type:'text',text:JSON.stringify({format:'shansha-task-links-v1',tasks:tasks.slice(current*5,current*5+5).map(t=>({id:t.id,title:t.title}))})}]}),[block,current]);
 return h('section',{className:'swb-query-task-links','aria-label':'查询到的待办'},h(TaskLinkCards,{phase:'result',block:cards,model}),tasks.length>5&&h('div',{className:'swb-task-link-actions'},h('button',{type:'button',disabled:current===0,onClick:()=>setPage(current-1)},'上一页'),h('span',null,(current+1)+' / '+Math.ceil(tasks.length/5)),h('button',{type:'button',disabled:(current+1)*5>=tasks.length,onClick:()=>setPage(current+1)},'下一页')));
}
function installTaskLinkCards(ctx,model){
 ctx.slots.inject('tool.call.toolview',()=>{const a=ctx.slots.register({name:'tool.call.toolview',key:'show_shansha_task_links',inject:()=>({model})},TaskLinkCards);const b=ctx.slots.register({name:'tool.call.toolview',key:'query_shansha_work',inject:()=>({model})},QueryTaskLinkCards);return()=>{a?.();b?.();};});
}

function linkedTasksForSession(tasks,sessionId){return sessionId?(tasks||[]).filter(t=>t.sessionId===sessionId&&!t.deletedAt&&t.kind!=='record'):[];}
function LinkedTaskHeader({sessionId,model}){
 const state=React.useSyncExternalStore(model.subscribe,model.snapshot,model.snapshot),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 React.useEffect(()=>{model.refresh(false).catch(()=>{});},[sessionId]);
 const tasks=linkedTasksForSession(state.tasks,sessionId);
 if(!tasks.length)return null;
 const open=async id=>{if(busy)return;setBusy(true);setError('');try{await model.openTaskFromChat(id);}catch(e){setError(e.message||'待办暂时无法打开');}finally{setBusy(false);}};
 const button=t=>h('button',{type:'button',key:t.id,className:'swb-linked-task-button',disabled:busy,title:'打开待办：'+t.title,onClick:()=>open(t.id)},'↗ ',t.title);
 return h('div',{className:'swb-linked-task-header'},tasks.length===1?button(tasks[0]):h('details',null,h('summary',null,'关联待办 ▾'),h('div',{className:'swb-linked-task-menu'},tasks.map(button))),error&&h('span',{role:'alert',className:'swb-linked-task-error'},error));
}
function installLinkedTaskHeader(ctx,model){
 ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({name:'conversation.session.header.utilities',id:'shansha-linked-task',order:-20,inject:()=>({model})},LinkedTaskHeader));
}

function taskQueryResultInTurn(snapshot,turn,name='query_shansha_work',accept=queryTaskLinkResult){
 if(!turn?.end||!snapshot?.locations?.getTurn||!snapshot?.nodes?.get)return null;
 let latest=null,lastSeq=-1;const seen=new Set();
 const visit=block=>{if(!block||seen.has(block))return;seen.add(block);
  if(block.kind==='tool-result'&&(block.name||block.call?.name)===name&&accept('result',block)!==null&&Number.isFinite(block.seq)&&block.seq>lastSeq){latest=block;lastSeq=block.seq;}
  for(const child of block.subCalls||[])visit(child);
 };
 for(const key of snapshot.locations.getTurn(turn.turn)||[]){const node=snapshot.nodes.get(key);if(node?.kind==='tool-call')visit(node.data?.root);}
 return latest;
}
function TaskQueryAnswerTail({turn,useChat,model}){
 const block=useChat(snapshot=>taskQueryResultInTurn(snapshot,turn));
 if(!block)return null;
 return h('div',{className:'swb-answer-task-links','aria-label':'本次查询的待办入口'},h(QueryTaskLinkCards,{phase:'result',block,model}));
}
function installTaskAnswerLinks(ctx,model){
 ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({name:'conversation.chat.turnTail',id:'shansha-query-task-links',order:10,inject:()=>({model})},TaskQueryAnswerTail));
}

function databaseLinkResult(phase,block){
 if(phase!=='result'||block?.isError||block?.content?.length!==1||block.content[0]?.type!=='text')return null;
 try{const data=JSON.parse(block.content[0].text);if(!Number.isFinite(data.revision))return null;const tables=data.table?[data.table]:data.tables;if(!Array.isArray(tables)||tables.length>100||tables.some(t=>typeof t.id!=='string'||!t.id||typeof t.name!=='string'))return null;return tables;}catch{return null;}
}
function DatabaseAnswerLinks({block,model}){
 const [page,setPage]=React.useState(0),[busy,setBusy]=React.useState(''),[error,setError]=React.useState('');React.useEffect(()=>{setPage(0);setError('');},[block]);
 const tables=databaseLinkResult('result',block);if(!tables?.length)return null;
 const current=Math.min(page,Math.ceil(tables.length/5)-1),open=async id=>{if(busy)return;setBusy(id);setError('');try{await model.openDatabaseFromChat(id);}catch(e){setError(e.message||'表格暂时无法打开');}finally{setBusy('');}};
 return h('section',{className:'swb-answer-task-links swb-database-answer-links','aria-label':'查询到的数据表'},tables.slice(current*5,current*5+5).map(t=>h('button',{key:t.id,type:'button',className:'swb-linked-task-button',disabled:!!busy,onClick:()=>open(t.id)},'打开表格 · '+t.name)),tables.length>5&&h('div',null,h('button',{type:'button',disabled:current===0,onClick:()=>setPage(current-1)},'上一页'),h('button',{type:'button',disabled:(current+1)*5>=tables.length,onClick:()=>setPage(current+1)},'下一页')),error&&h('p',{role:'alert'},error));
}
function DatabaseQueryAnswerTail({turn,useChat,model}){
 const block=useChat(snapshot=>taskQueryResultInTurn(snapshot,turn,'read_shansha_database',databaseLinkResult));
 return block?h(DatabaseAnswerLinks,{block,model}):null;
}
function installDatabaseAnswerLinks(ctx,model){ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({name:'conversation.chat.turnTail',id:'shansha-database-links',order:11,inject:()=>({model})},DatabaseQueryAnswerTail));}
