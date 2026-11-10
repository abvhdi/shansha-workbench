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
function installTaskLinkCards(ctx,model){
 ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'show_shansha_task_links',inject:()=>({model})},TaskLinkCards));
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
 ctx.slots.inject('conversation.session.header.actions',()=>ctx.slots.register({name:'conversation.session.header.actions',id:'shansha-linked-task',order:-20,inject:()=>({model})},LinkedTaskHeader));
}
