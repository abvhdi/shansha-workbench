const inject=['slots','layout','sessions','uiWorkspace','conversation','workspaces','remote','connection','remote.workspaceFiles','remote.session'];
function createModel(repo,bridge) {
  let state={tasks:[],loaded:false,message:'',error:false,saves:{},materialCounts:{},projects:[],files:[]};
  const writers=new Map();let workTimer;
  const scheduleWork=()=>{if(!bridge.pushWork)return;clearTimeout(workTimer);workTimer=setTimeout(async()=>{try{await bridge.pushWork(repo);await bridge.syncLocal?.(repo);}catch(error){model.fail(error);}},500);};
  let syncTimer,reminderTimer,undoTimer,noticeTimer,disposed=false,syncing=false,checkingReminders=false,applyingAgentEdits=false,changingSession=false,importingMobile=false,lastMobileError='',lastSyncError='',lastLocalError='';
  const listeners=new Set();
  const publish=patch=>{state={...state,...patch};if(Object.prototype.hasOwnProperty.call(patch,'message')){clearTimeout(noticeTimer);if(patch.message&&typeof setTimeout==='function')noticeTimer=setTimeout(()=>{if(!disposed)publish({message:'',error:false,undo:null});},8000);}for(const listener of listeners)listener();};
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('shansha-workbench-changes'):null;
  const model={repo,bridge,drafts:new Map(),selected:'',snapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    refresh:async(broadcast=true)=>{const tasks=await repo.list();const projects=repo.projects?await repo.projects():[];const all=repo.allMaterials?await repo.allMaterials():null;let counts;if(all){counts={};for(const material of all)counts[material.taskId]=(counts[material.taskId]||0)+1;}else counts=Object.fromEntries(await Promise.all(tasks.map(async t=>[t.id,(await repo.materials(t.id)).length])));const files=(all||[]).map(({blob,...meta})=>meta);publish({tasks,projects,files,materialCounts:counts,manualOrder:await repo.getSetting?.('manualTaskOrder')||[],loaded:true});if(broadcast)channel?.postMessage('changed');scheduleWork();},
    capture:async text=>{const item=capturedContent(text,crypto.randomUUID(),Date.now());await repo.add(item);await model.refresh().catch(error=>{publish({tasks:[...state.tasks.filter(t=>t.id!==item.id),item],loaded:true});model.fail(error);});model.classifyContent(item);return item;},
    classifyContent:async item=>{try{const result=await bridge.nativeCall('shanshaFiles/parseTaskInput',{request:{text:item.description||item.title,mode:'classify'}});if(disposed)return;await repo.update(item.id,current=>classificationPatch(current,item,result));await model.refresh();}catch(error){if(disposed)return;try{await repo.update(item.id,current=>current.updatedAt===item.updatedAt&&current.classificationToken===item.classificationToken?{classificationState:'unavailable',classificationToken:null}:null);await model.refresh();}catch{ /* Deleted or edited while identifying: preserve the current content. */ }}},
    retryClassification:async id=>{await model.flushDraft(id);const saved=await repo.update(id,{classificationState:'pending',classificationToken:crypto.randomUUID()});await model.refresh();model.classifyContent(saved);},
    setContentKind:async(id,kind)=>{if(!['task','record'].includes(kind))throw new Error('内容类型无效');await model.flushDraft(id);await repo.update(id,{kind,classificationState:'manual',classificationToken:null});await model.refresh();await bridge.pushWork?.(repo);},
    saveDraft:(id,patch)=>{
      let writer=writers.get(id);
      if(!writer){writer=new DraftWriter(async value=>{if(value.title!==undefined)value={...value,title:cleanTitle(value.title)};const saved=await repo.update(id,value);clearRescueTasks([id]);if(saved&&saved.id){publish({tasks:state.tasks.map(task=>task.id===id?saved:task)});channel?.postMessage('changed');scheduleWork();}else await model.refresh();},(status,error,patch)=>{publish({saves:{...state.saves,[id]:{status,error:error?.message}}});if(status==='error'&&patch)rescuePatch(id,patch,Date.now());});writers.set(id,writer);}
      writer.schedule(patch);
    },
    flushDraft:id=>writers.get(id)?.flush()||Promise.resolve(),
    addProject:async name=>{const cleaned=String(name).trim();if(!cleaned||cleaned.length>60)throw new Error('项目名称请输入 1 到 60 个字符。');if((await repo.projects()).some(p=>p.name.toLocaleLowerCase()===cleaned.toLocaleLowerCase()))throw new Error('已有同名项目。');await repo.addProject({id:crypto.randomUUID(),name:cleaned,createdAt:Date.now()});await model.refresh();},
    moveTask:async(id,projectId)=>{await model.flushDraft(id);await repo.moveTask(id,projectId);await bridge.pushWork?.(repo);await bridge.importLocalFiles?.(repo);await model.refresh();await bridge.syncLocal?.(repo);},
    deleteProject:async id=>{await repo.deleteProject(id);await model.refresh();model.notice('项目已删除，待办回到未归类。');},
    toggleComplete:async id=>{await model.flushDraft(id);const saved=await repo.update(id,task=>completionPatch(task));await model.refresh();if(saved.status==='done'&&saved.reminder?.kind!=='once'&&saved.reminder&&saved.reminder.unit!=='hours')model.notice('本轮已完成，下次：'+reminderDisplay(saved.reminder.nextAt));},
    reorderTask:async(id,before)=>{await repo.reorderTask(id,before);await model.refresh();},
    postponeReminder:async(id,date,time)=>{await model.flushDraft(id);const at=reminderStamp(date,time);if(at<=Date.now())throw new Error('请选择之后的提醒时间。');await repo.update(id,task=>{if(!task.reminder)throw new Error('这条待办没有提醒。');return {reminder:{...task.reminder,nextAt:at,notifiedAt:null,advanceNotifiedAt:at-Number(task.reminder.advanceMinutes||0)*60000<=Date.now()?at:null}};});await model.refresh();model.notice('提醒已延后到 '+reminderDisplay(at));},
    saveReminder:async(id,input)=>{await model.flushDraft(id);const reminder=makeReminder(input);await repo.update(id,{reminder});if(input.rememberAdvance)await repo.setSetting('defaultAdvanceMinutes',reminder.advanceMinutes);await model.refresh();model.notice('提醒已设置，下一次：'+reminderDisplay(reminder.nextAt));},
    clearReminder:async id=>{await repo.update(id,{reminder:null});await model.refresh();model.notice('已关闭提醒。');},
    startCollaboration:async(id,materials)=>{
      await model.flushDraft(id);changingSession=true;
      try{await waitWhile(()=>syncing,{timeout:BRIDGE_WAIT_TIMEOUT,isStopped:()=>disposed});const task=(await repo.list()).find(t=>t.id===id);if(!task||task.deletedAt)throw new Error('这条待办已删除。');
        if(task.sessionId)await bridge.open(task);else await bridge.prepare(task,materials||[]);
      }finally{changingSession=false;await model.refresh();}
    },
    changeSession:async(id,sessionId,materials)=>{
      await model.flushDraft(id);changingSession=true;
      try{await waitWhile(()=>syncing,{timeout:BRIDGE_WAIT_TIMEOUT,isStopped:()=>disposed});const task=(await repo.list()).find(t=>t.id===id);if(!task||task.deletedAt)throw new Error('这条待办已删除。');const previous=task.sessionId||'';
        if(sessionId===previous){model.notice('该会话已关联。');return;}
        if(sessionId)await bridge.link(task,sessionId);else await bridge.prepare(task,materials||[],{forceNew:true});
        await model.refresh();clearTimeout(undoTimer);publish({message:previous?'已更换会话。':'已添加会话。',error:false,undo:async()=>{if(previous)await bridge.link({id},previous);else await repo.update(id,{sessionId:''});await model.refresh();model.notice('已撤销会话关联修改。');}});undoTimer=setTimeout(()=>publish({undo:null}),8000);
      }finally{changingSession=false;}
    },
    dismissAdvanceReminders:async ids=>{for(const id of ids)await repo.update(id,task=>isTaskAdvanceDue(task)?{reminder:{...task.reminder,advanceNotifiedAt:task.reminder.nextAt}}:null);await model.refresh();},
    dismissReminders:async ids=>{for(const id of ids)await repo.update(id,task=>task.reminder?{reminder:task.reminder.unit==='hours'?{...task.reminder,nextAt:nextReminder(task.reminder,Date.now()),notifiedAt:null}:{...task.reminder,notifiedAt:task.reminder.nextAt}}:null);await model.refresh();},
    checkReminders:async()=>{if(disposed||checkingReminders)return;checkingReminders=true;try{const now=Date.now(),allTasks=await repo.list(),tasks=allTasks.filter(t=>t.kind!=='record');for(const task of tasks){if(disposed)break;if(!task.deletedAt&&task.status!=='done'&&task.reminder?.unit==='hours'&&task.reminder.nextAt+task.reminder.interval*3600000<=now)await repo.update(task.id,current=>!current.deletedAt&&current.status!=='done'&&current.reminder?.unit==='hours'?{reminder:{...current.reminder,nextAt:nextReminder(current.reminder,now)-current.reminder.interval*3600000,notifiedAt:null}}:null);if(!task.deletedAt&&task.status==='done'&&task.reminder?.kind!=='once'&&task.reminder?.unit!=='hours'&&task.reminder?.nextAt<=now)await repo.update(task.id,current=>!current.deletedAt&&current.status==='done'&&current.reminder?.kind!=='once'&&current.reminder?.unit!=='hours'&&current.reminder?.nextAt<=now?{status:'todo'}:null);}if(!disposed){const current=await repo.list();if(current.some(t=>allTasks.find(old=>old.id===t.id)?.updatedAt!==t.updatedAt))await model.refresh(false);else publish({clock:now});}}catch(error){if(!disposed)model.fail(error);}finally{checkingReminders=false;}},
    notice:(message,keepUndo)=>{if(!keepUndo)clearTimeout(undoTimer);publish({message,error:false,undo:keepUndo?(state.undo||null):null});},fail:error=>publish({message:error?.message||String(error),error:true,undo:null}),
    unlinkSession:async id=>{
      changingSession=true;
      try{await waitWhile(()=>syncing,{timeout:BRIDGE_WAIT_TIMEOUT,isStopped:()=>disposed});const task=(await repo.list()).find(t=>t.id===id);if(!task?.sessionId)return;const old=task.sessionId;await repo.update(id,{sessionId:''});await bridge.pushWork?.(repo);await model.refresh();clearTimeout(undoTimer);publish({message:'已取消关联，聊天和材料仍保留。',error:false,undo:async()=>{await bridge.link({id},old);await model.refresh();model.notice('已恢复会话关联。');}});undoTimer=setTimeout(()=>publish({undo:null}),8000);}finally{changingSession=false;}
    },
    deleteTask:async(id,options)=>{
      await model.flushDraft(id).catch(()=>{});changingSession=true;
      try{await waitWhile(()=>syncing,{timeout:BRIDGE_WAIT_TIMEOUT,isStopped:()=>disposed});const current=(await repo.list()).find(task=>task.id===id);if(!current)throw new Error('这条待办已经不存在。');const keep=!!options?.keepMaterials;await repo.purgeTasks([id],keep);if(!keep)bridge.forgetTasks?.([id]);clearRescueTasks([id]);if(model.selected===id)model.selected='';await model.refresh();await bridge.pushWork?.(repo);await bridge.syncLocal?.(repo);model.notice(keep?'待办已删除，文件已保留在文件工坊。':'待办和它的文件副本都已删除。');}finally{changingSession=false;}
    },
    addToDatabase:async(text,source={})=>{const body=String(text||'').trim();if(!body)throw new Error('请先选中需要整理的内容。');if(body.length>20000)throw new Error('选中内容较长，请分段整理（每次最多两万字）。');model.revealWorkbench?.();publish({databaseCapture:{id:crypto.randomUUID(),text:body,source}});},
    closeDatabaseCapture:()=>publish({databaseCapture:null}),
    taskToDatabase:async id=>{await model.flushDraft(id);const task=(await repo.list()).find(t=>t.id===id&&!t.deletedAt);if(!task)throw new Error('这条内容已经不存在。');await model.addToDatabase([task.title,task.description].filter(Boolean).join('\n\n'),{taskId:task.id,title:task.title});},
    openDatabaseFromChat:async id=>{if(model.databaseEditing)throw Error('请先完成表格中正在编辑的内容。');const catalog=await bridge.nativeCall('shanshaFiles/databaseCatalog');if(!catalog.tables?.some(t=>t.id===id))throw Error('这张表已删除，请重新查询。');model.databaseMemory={recent:model.databaseMemory?.recent||[],tableId:id};model.area='database';model.selected='';publish({databaseNavigation:{id,token:crypto.randomUUID()}});model.revealWorkbench?.();},
    openTaskFromChat:async id=>{await model.refresh();const task=state.tasks.find(t=>t.id===id&&!t.deletedAt&&t.kind!=='record');if(!task)throw Error('这条待办已删除或已改为随手记，无法打开。');model.selected=id;publish({taskNavigation:{id,token:crypto.randomUUID()}});model.revealWorkbench?.();},
    openTaskChat:async id=>{model.chatOpenings ||= new Map();if(model.chatOpenings.has(id))return model.chatOpenings.get(id);const run=async()=>{const task=(await repo.list()).find(t=>t.id===id&&!t.deletedAt&&t.kind!=='record');if(!task)throw Error('这条待办已删除或已改为随手记。');const materials=task.sessionId?[]:await repo.materials(id);await model.startCollaboration(id,materials);};const pending=globalThis.navigator?.locks?.request?navigator.locks.request('shansha-task-chat:'+id,run):run();model.chatOpenings.set(id,pending);try{return await pending;}finally{model.chatOpenings.delete(id);}},
    requestRename:file=>publish({renameTarget:file}),
    renameFile:async(file,name)=>{const result=await bridge.renameMaterial(file,name);await model.refresh();model.notice(result.adjusted?'已有同名文件，已改名为“'+result.name+'”。':'文件已改名为“'+result.name+'”。');},
    deleteFile:async id=>{await bridge.nativeCall?.('shanshaFiles/remove',{request:{ids:[id]}});await repo.deleteMaterial(id);await model.refresh();await bridge.syncLocal?.(repo);model.notice('文件副本已从本机删除。');},
    syncMobileInbox:async(manual=false)=>{
      if(disposed||importingMobile||!bridge.nativeCall||!repo.importMobile)return;importingMobile=true;
      try{const result=await bridge.nativeCall('shanshaFiles/mobileInbox',{request:{captureOnly:true,manual}});if(manual&&result.available===false)throw new Error('手机同步尚未连接，请在“连接手机”中检查。');const ids=[],deletedIds=[],results=[];let added=false;
        for(const item of result.items||[]){if(disposed)break;if(item.deletedAt)await model.flushDraft(item.id);const saved=await repo.importMobile(item);if(saved.deleted){deletedIds.push(item.id);model.drafts.delete(item.id);clearRescueTasks([item.id]);if(model.selected===item.id)model.selected='';}else if(saved.received)ids.push(item.id);added ||= saved.added;}
        for(const command of result.commands||[]){if(disposed)break;await model.flushDraft(command.taskId);const outcome=await repo.applyMobileAction(command);results.push({id:command.id,result:outcome});if(outcome.ok){added=true;if(command.action==='delete'){model.drafts.delete(command.taskId);clearRescueTasks([command.taskId]);}}}
        if(added&&!disposed){await model.refresh();await bridge.pushWork?.(repo);}
        if(ids.length||deletedIds.length||results.length)await bridge.nativeCall('shanshaFiles/mobileAcknowledge',{request:{ids,deletedIds,results}});lastMobileError='';
      }catch(error){const message=error?.message||String(error);if(!disposed&&(manual||message!==lastMobileError)&&!/404|not found/i.test(message)){lastMobileError=message;model.fail(new Error('手机同步暂未完成：'+message));}}finally{importingMobile=false;}
    },
    applyAgentEdits:async()=>{
      if(disposed||applyingAgentEdits||changingSession||!bridge.nativeCall||!repo.applyAgentEdit)return;applyingAgentEdits=true;
      try{const queue=await bridge.nativeCall('shanshaFiles/taskEdits');for(const command of queue.commands||[]){if(disposed)break;let result,error;
        try{const undo=command.action==='undo'?await repo.getSetting('agentEdit:'+command.undoId):null;const id=command.taskId||undo?.task?.id;if(id)await model.flushDraft(id);result=command.coordinator?await repo.applyCoordinatorEdit(command):await repo.applyAgentEdit(command);if(id)model.drafts.delete(id);await model.refresh();try{await bridge.pushWork(repo);}catch(e){result.syncWarning='修改已保存，但会话状态同步失败：'+e.message;}model.notice(command.coordinator?'':command.action==='undo'?'已撤销 AI 的待办修改。':'AI 已更新待办，可在会话中要求撤销。');}
        catch(e){error=e.message;model.fail(e);}await bridge.nativeCall('shanshaFiles/finishTaskEdit',{request:{id:command.id,...error?{error}:{result}}});}
      }catch(error){if(!disposed)model.fail(error);}finally{applyingAgentEdits=false;}
    },
    syncMaterials:async()=>{if(disposed||syncing||changingSession)return;syncing=true;try{let changed=bridge.importLocalFiles?await bridge.importLocalFiles(repo):0,failure=null;for(const task of await repo.list()){if(disposed)break;if(!task.sessionId||task.deletedAt)continue;try{changed+=await bridge.importDraftMaterials(task);const pending=(await repo.materials(task.id)).filter(m=>m.pendingSessionId===task.sessionId);if(pending.length){await bridge.stageMaterials(task,pending);await repo.markStaged(pending.map(m=>m.id),task.sessionId);}changed+=await bridge.importOutputMaterials(task);}catch(error){if(!failure)failure=error;}}if(changed&&!disposed){await model.refresh();await bridge.syncLocal?.(repo);}const localWarning=(bridge.localWarnings||[]).join('；');if(localWarning&&localWarning!==model.lastDiskWarning){model.lastDiskWarning=localWarning;model.notice(localWarning);}else if(!localWarning)model.lastDiskWarning='';if(bridge.fileNotice){model.notice(bridge.fileNotice);bridge.fileNotice='';}if(failure){if(!disposed&&failure.message!==lastSyncError){lastSyncError=failure.message;model.fail(new Error('聊天附件同步失败：'+failure.message));}}else lastSyncError='';}catch(error){if(!disposed&&error&&error.message!==lastSyncError){lastSyncError=error.message;model.fail(error);}}finally{if(!disposed&&repo.localDirtyTasks?.size&&bridge.syncLocal)try{await bridge.syncLocal(repo);}catch(error){if(error.message!==lastLocalError){lastLocalError=error.message;model.fail(error);}}syncing=false;}},
    rescuePending:()=>{const at=Date.now();const ids=[];for(const [id,writer] of writers){const patch=writer.pendingPatch();if(patch){rescuePatch(id,patch,at);ids.push(id);}}return ids;},
    recoverRescue:async()=>{
      const entries=readRescue();if(!entries.length)return 0;
      const tasks=await repo.list(),byId=new Map(tasks.map(task=>[task.id,task]));let restored=0;const remaining=[];
      for(const entry of entries){
        const task=byId.get(entry.taskId);
        if(!task||task.deletedAt)continue;
        if(!entry.at||Date.now()-entry.at>RESCUE_MAX_AGE)continue;
        const patch=entry.patch||{};
        if(Object.entries(patch).every(([key,value])=>task[key]===value))continue;
        try{await repo.update(entry.taskId,patch);restored++;}catch(error){remaining.push(entry);}
      }
      writeRescue(remaining);
      if(restored){await model.refresh();model.notice('已恢复上次未能保存的修改（'+restored+' 条）。');}
      return restored;
    },
    cleanLegacyTrash:async()=>{const legacy=(await repo.list()).filter(task=>task.deletedAt).map(task=>task.id);if(!legacy.length)return 0;await repo.purgeTasks(legacy,true);bridge.forgetTasks?.(legacy);clearRescueTasks(legacy);if(legacy.includes(model.selected))model.selected='';await model.refresh();model.notice('回收站已取消：之前放进回收站的 '+legacy.length+' 条待办已删除，它们的文件保留在文件工坊。');return legacy.length;},
    dispose:async()=>{disposed=true;clearTimeout(noticeTimer);clearTimeout(workTimer);clearTimeout(undoTimer);if(syncTimer)clearInterval(syncTimer);if(reminderTimer)clearInterval(reminderTimer);await waitWhile(()=>syncing||checkingReminders||applyingAgentEdits||importingMobile,{timeout:5000});if(typeof document!=='undefined'&&typeof document.removeEventListener==='function')document.removeEventListener('visibilitychange',onVisibility);if(typeof window!=='undefined'&&typeof window.removeEventListener==='function')window.removeEventListener('pagehide',onHide);await Promise.allSettled([...writers.values()].map(w=>w.flush()));channel?.close();bridge.dispose?.();repo.close();listeners.clear();}};
  if(typeof setInterval==='function')syncTimer=setInterval(()=>{model.syncMaterials();model.applyAgentEdits();},2000);
  if(typeof setInterval==='function'){reminderTimer=setInterval(()=>model.checkReminders(),15000);model.checkReminders();}
  if(channel)channel.onmessage=()=>{bridge.localInitialized=false;model.refresh(false).catch(model.fail);};
  const onHide=()=>{const ids=model.rescuePending();if(!ids.length)return;Promise.allSettled(ids.map(id=>writers.get(id).flush())).then(results=>{const done=ids.filter((id,index)=>results[index].status==='fulfilled');if(done.length)clearRescueTasks(done);});};
  const onVisibility=()=>{if(document.visibilityState==='hidden')onHide();};
  if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('visibilitychange',onVisibility);
  if(typeof window!=='undefined'&&typeof window.addEventListener==='function')window.addEventListener('pagehide',onHide);
  return model;
}
function apply(ctx) {
  const repo=new WorkbenchRepository(),bridge=new HarnessBridge(ctx,repo),model=createModel(repo,bridge);
  model.revealWorkbench=()=>ctx.layout.selectPanel(PANEL_ID);
  ctx.effect(()=>{
    const style=document.createElement('style');style.dataset.plugin='shansha-workbench';style.textContent=STYLES;document.head.appendChild(style);
    const stopReminderPopups=installReminderPopups(model,()=>ctx.layout.selectPanel(PANEL_ID));const stopDatabaseSelection=installDatabaseSelectionMenu(model);return async()=>{stopDatabaseSelection();stopReminderPopups();style.remove();await model.dispose();};
  });
  // Optional capabilities must never abort plugin activation.
  Promise.resolve().then(()=>{
    if(!bridge.outputsAvailable())model.notice('AI 产出自动收取尚未连接，请重启 Harness 后再试。待办与已保存的材料不受影响。');
    return model.cleanLegacyTrash();
  }).then(()=>model.recoverRescue()).then(()=>bridge.syncLocal?.(repo)).catch(error=>{console.error('珊莎工作台初始化失败',error);model.fail(error);});
  installTaskLinkCards(ctx,model);
  installTaskAnswerLinks(ctx,model);
  installDatabaseAnswerLinks(ctx,model);
  installLinkedTaskHeader(ctx,model);
  ctx.inject?.(['sidebarRight','sidebarRightTabs'],child=>installDatabasePanel(child,model));
  ctx.slots.inject('main',()=>{
    const dispose=ctx.slots.register({name:'main',key:PANEL_ID,inject:()=>({model})},WorkbenchPage);
    ctx.layout.selectPanel(PANEL_ID);
    return dispose;
  });
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:PANEL_ID,order:-10,label:()=> '待办工作台'},WorkbenchIcon));
}








