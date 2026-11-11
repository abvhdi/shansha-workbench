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
  if(block.kind==='tool-result'&&(Array.isArray(name)?name.includes(block.name||block.call?.name):(block.name||block.call?.name)===name)&&accept('result',block)!==null&&Number.isFinite(block.seq)&&block.seq>lastSeq){latest=block;lastSeq=block.seq;}
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

function templateCandidateResult(phase,block){if(phase!=='result'||block?.isError||block?.content?.length!==1||block.content[0]?.type!=='text')return null;try{const data=JSON.parse(block.content[0].text),templates=data.templates||(data.template?[data.template]:null);if(data.format&&data.format!=='shansha-template-candidates-v1')return null;if(!Array.isArray(templates)||templates.length>100||templates.some(t=>typeof t.id!=='string'||typeof t.name!=='string'||!Number.isFinite(t.updatedAt)))return null;return {...data,templates};}catch{return null;}}

function TemplateChoiceCards({block,model,sessionId}){
 const [selection,setSelection]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[page,setPage]=React.useState(0);const data=templateCandidateResult('result',block);
 React.useEffect(()=>{let active=true;setSelection(null);model.bridge.nativeCall('shanshaFiles/templatesSelection',{request:{sessionId}}).then(r=>{if(active)setSelection(r.selection);}).catch(()=>{});return()=>{active=false;};},[sessionId,block]);
 if(!data)return null;if(!data.templates.length)return h('p',{className:'swb-muted'},'还没有保存的模板，可以到文件 → 模板添加。');
 const current=Math.min(page,Math.ceil(data.templates.length/5)-1);
 const confirmed=data.requestId&&selection?.requestId===data.requestId&&selection.status==='confirmed'&&data.templates.some(t=>t.id===selection.templateId&&t.updatedAt===selection.templateUpdatedAt);if(confirmed)return h('div',{className:'swb-template-confirmed-status',role:'status'},h('span',null,'本次模板 · '),h('strong',null,selection.name),h('small',null,'已确认'));
 const choose=async t=>{if(busy)return;if(!data.requestId){setError('这张旧卡片不支持本次确认，请让助手重新查询模板。');return;}setBusy(true);setError('');try{setSelection(await model.bridge.nativeCall('shanshaFiles/templatesConfirm',{request:{sessionId,requestId:data.requestId,id:t.id,expectedUpdatedAt:t.updatedAt}}));}catch(e){setError(e.message);}finally{setBusy(false);}};
 return h('section',{className:'swb-answer-task-links swb-template-choices','aria-label':'选择本次使用的模板'},h('strong',null,'这次使用哪个模板？'),data.noExactMatch&&h('p',{className:'swb-muted'},'没有完全匹配的名称，可以从下面选择。'),data.templates.slice(current*5,current*5+5).map(t=>{const chosen=!!data.requestId&&selection?.requestId===data.requestId&&selection.status==='confirmed'&&selection.templateId===t.id&&selection.templateUpdatedAt===t.updatedAt;return h('div',{key:t.id,className:'swb-template-choice-card'},h('span',null,t.name),h('button',{type:'button',disabled:busy||chosen,'aria-label':(chosen?'已选择 ':'使用 ')+t.name,onClick:()=>choose(t)},chosen?'已选择':'使用此模板'));}),data.templates.length>5&&h('div',null,h('button',{type:'button',disabled:current===0,onClick:()=>setPage(current-1)},'上一页'),h('button',{type:'button',disabled:(current+1)*5>=data.templates.length,onClick:()=>setPage(current+1)},'下一页')),selection?.templateId&&selection.requestId===data.requestId&&h('p',{className:'swb-muted',role:'status'},'本次已确认：'+selection.name+'。告诉助手继续，即可按这份模板处理。'),error&&h('p',{role:'alert'},error));
}
function TemplateChoiceAnswerTail({turn,useChat,model,sessionId}){const block=useChat(snapshot=>taskQueryResultInTurn(snapshot,turn,['search_shansha_templates','read_shansha_template'],templateCandidateResult));return block?h(TemplateChoiceCards,{block,model,sessionId}):null;}
function installTemplateAnswerLinks(ctx,model){ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({name:'conversation.chat.turnTail',id:'shansha-template-choice',order:12,inject:sessionId=>({model,sessionId})},TemplateChoiceAnswerTail));}
function quoteDraftResult(phase,block){if(phase!=='result'||block?.isError)return null;try{const r=JSON.parse(block.content[0].text);return r.format==='shansha-quote-draft-v1'?r:null;}catch{return null;}}
function QuoteDraftCard({model,sessionId,block}){
 const [draft,setDraft]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[dirty,setDirty]=React.useState(false);
 const load=()=>model.bridge.nativeCall('shanshaFiles/quoteDraftRead',{request:{sessionId}}).then(r=>{setDraft(r.draft);setDirty(false);});
 React.useEffect(()=>{let active=true;model.bridge.nativeCall('shanshaFiles/quoteDraftRead',{request:{sessionId}}).then(r=>{if(active){setDraft(r.draft);setDirty(false);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[sessionId,block]);
 if(!draft)return error?h('p',{role:'alert'},error):null;
 const edit=(key,value)=>{setDraft({...draft,[key]:value,status:'draft'});setDirty(true);};
 const cell=(i,key,value)=>edit('items',draft.items.map((r,n)=>n===i?{...r,[key]:value}:r));
 const amount=r=>r.quantity===null||r.price===null||r.discount===null?null:Math.round(r.quantity*r.price*(1-r.discount/100)*100)/100;
 const save=async confirm=>{setBusy(true);setError('');try{setDraft(await model.bridge.nativeCall('shanshaFiles/quoteDraftSave',{request:{sessionId,revision:draft.revision,data:draft,confirm}}));setDirty(false);}catch(e){setError(e.message);}finally{setBusy(false);}};
 const input=(label,value,change,numeric=false)=>h('input',{'aria-label':label,type:numeric?'number':'text',min:numeric?0:undefined,step:numeric?'any':undefined,value:value??'',disabled:busy,onChange:e=>change(numeric?(e.target.value===''?null:Number(e.target.value)):e.target.value)});
 return h('section',{className:'swb-quote-draft','aria-label':'填写内容'},h('strong',null,'核对填写内容'),h('small',null,draft.templateName),draft.needsRecheck&&h('p',{role:'alert'},'模板、填写规则或本次确认已变化，请让助手重新整理草稿。'),draft.rulesVersion?h('div',{className:'swb-quote-fields'},(draft.fields||[]).map((f,i)=>h('label',{key:f.name},h('span',null,f.name+(f.required?' *':'')),h('div',null,h(f.kind==='multiline'?'textarea':'input',{'aria-label':f.name,type:f.kind==='date'?'date':f.kind==='number'?'number':'text',step:f.kind==='number'?'any':undefined,value:f.value??'',disabled:busy||f.source==='fixed',onChange:e=>edit('fields',draft.fields.map((x,n)=>n===i?{...x,value:f.kind==='number'&&e.target.value!==''?Number(e.target.value):e.target.value}:x))}),(f.actualSource||f.source==='fixed')&&h('small',null,f.source==='fixed'?'固定内容':f.actualSource))))):h('label',null,'客户',input('客户',draft.customer,v=>edit('customer',v))),draft.hasDetails!==false&&h('div',{className:'swb-quote-scroll'},h('table',null,h('thead',null,h('tr',null,['产品','规格','数量','单价','折扣 %','金额',''].map((x,i)=>h('th',{key:i},x)))),h('tbody',null,draft.items.map((r,i)=>h('tr',{key:i},['name','model','quantity','price','discount'].map((key,n)=>h('td',{key},input(['产品','规格','数量','单价','折扣'][n]+(i+1),r[key],v=>cell(i,key,v),n>1))),h('td',null,amount(r)===null?'待补全':amount(r).toFixed(2)),h('td',null,h('button',{type:'button',disabled:busy,onClick:()=>edit('items',draft.items.filter((_,n)=>n!==i)),'aria-label':'删除明细'+(i+1)},'×')),r.source&&h('td',{className:'swb-quote-source',title:r.source},r.source)))))),draft.hasDetails!==false&&h('button',{type:'button',disabled:busy||draft.items.length>=100,onClick:()=>edit('items',[...draft.items,{name:'',model:'',quantity:null,price:null,discount:0,source:''}])},'+ 添加一行'),draft.hasDetails!==false&&h('p',null,'合计 ',draft.items.some(r=>amount(r)===null)?'待补全':draft.items.reduce((s,r)=>s+amount(r),0).toFixed(2)),!draft.rulesVersion&&h('label',null,'备注',input('报价备注',draft.notes,v=>edit('notes',v))),h('div',{className:'swb-task-link-actions'},h('button',{type:'button',disabled:busy||!dirty,onClick:()=>save(false)},'保存草稿'),h('button',{type:'button',disabled:busy||draft.needsRecheck||(!dirty&&draft.status==='confirmed'),onClick:()=>save(true)},draft.status==='confirmed'&&!dirty?'已确认明细':'确认明细')),h('small',{role:'status'},dirty?'有未保存的修改':draft.status==='confirmed'?'填写内容已确认，可以继续生成文件。':'草稿已保存，尚未写入正式数据库。'),error&&h('p',{role:'alert'},error, h('button',{type:'button',disabled:busy,onClick:()=>load().catch(e=>setError(e.message))},'重新读取')));
}
function QuoteDraftAnswerTail({turn,useChat,model,sessionId}){const block=useChat(snapshot=>taskQueryResultInTurn(snapshot,turn,['prepare_shansha_quote','read_shansha_quote'],quoteDraftResult));return block?h(QuoteDraftCard,{model,sessionId,block}):null;}
function installQuoteDraftCards(ctx,model){ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({name:'conversation.chat.turnTail',id:'shansha-quote-draft',order:13,inject:sessionId=>({model,sessionId})},QuoteDraftAnswerTail));}
