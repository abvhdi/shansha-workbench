class WorkbenchRepository {
  constructor(factory = indexedDB) { this.factory=factory; this.dbPromise=null; }
  open() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise=new Promise((resolve,reject)=>{
      const request=this.factory.open('shansha-workbench-v1',3);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('tasks'))db.createObjectStore('tasks',{keyPath:'id'});
        if(!db.objectStoreNames.contains('materials')){const materials=db.createObjectStore('materials',{keyPath:'id'});materials.createIndex('taskId','taskId');}
        if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});
        if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'key'});
      };
      request.onsuccess=()=>{ const db=request.result; db.onversionchange=()=>{db.close();this.dbPromise=null;}; resolve(db); };
      request.onerror=()=>{this.dbPromise=null;reject(request.error);};
      request.onblocked=()=>{this.dbPromise=null;reject(new Error('请关闭其他工作台窗口后重试。'));};
    });
    return this.dbPromise;
  }
  async transaction(names, mode, run) {
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(names,mode); let result;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error || new Error('本地保存失败。'));
      tx.onabort=()=>reject(tx.error || new Error('本地保存已取消。'));
      try { run(tx,value=>{result=value;}); } catch(error) {tx.abort();reject(error);}
    });
  }
  list() { return this.transaction(['tasks'],'readonly',(tx,set)=>{const r=tx.objectStore('tasks').getAll();r.onsuccess=()=>set(r.result);}); }
  add(task) {return this.transaction(['tasks'],'readwrite',tx=>tx.objectStore('tasks').add(task));}
  importMobile(item) {
    if(item&&/^mobile-[a-f0-9]{32}$/.test(item.id)&&Number.isSafeInteger(item.deletedAt)&&item.deletedAt>0)return this.transaction(['tasks','settings'],'readwrite',(tx,set)=>{tx.objectStore('tasks').delete(item.id);tx.objectStore('settings').put({key:'mobileReceived:'+item.id,value:true});set({received:true,added:true,deleted:true});});
    if(!item||!/^mobile-[a-f0-9]{32}$/.test(item.id)||typeof item.title!=='string'||!item.title.trim()||item.title.length>200||typeof item.description!=='string'||item.description.length>4000||!Number.isSafeInteger(item.createdAt))throw new Error('手机待办格式有误。');
    const reminder=item.reminder?makeReminder({kind:'once',date:item.reminder.date,time:item.reminder.time},Math.min(Date.now(),reminderStamp(item.reminder.date,item.reminder.time)-1)):null;
    return this.transaction(['tasks','settings'],'readwrite',(tx,set)=>{
      const settings=tx.objectStore('settings'),tasks=tx.objectStore('tasks'),key='mobileReceived:'+item.id,r=settings.get(key);
      r.onsuccess=()=>{if(r.result?.value){set({received:true,added:false});return;}const q=tasks.get(item.id);q.onsuccess=()=>{if(q.result){set({received:false,added:false});return;}tasks.add({...newTask(item.title,item.id,item.createdAt),description:item.description,...item.kind==='record'?{kind:'record',classificationState:'manual'}:{},...reminder?{reminder}:{}});settings.put({key,value:true});set({received:true,added:true});};};
    });
  }
  applyMobileAction(command){
    return this.transaction(['tasks','settings'],'readwrite',(tx,set)=>{
      const tasks=tx.objectStore('tasks'),settings=tx.objectStore('settings'),key='mobileAction:'+command.id,r=settings.get(key);
      r.onsuccess=()=>{if(r.result){set(r.result.value);return;}const q=tasks.get(command.taskId);q.onsuccess=()=>{const t=q.result;let result,patch;
       try{if(!/^action-[a-f0-9]{32}$/.test(command.id)||command.expiresAt<Date.now())throw new Error('操作已过期，请刷新后重试');if(!t||t.deletedAt||t.kind==='record')throw new Error('这条待办已删除或已取消待办');if(t.updatedAt!==command.expectedUpdatedAt)throw new Error('电脑上的待办有新修改，请刷新后重试');
        if(command.action==='delete')tasks.delete(t.id);
        else{if(command.action==='complete'){if(!['todo','done'].includes(command.status))throw new Error('完成状态无效');patch=t.status===command.status?{}:completionPatch(t);}
        else if(command.action==='reminder')patch={reminder:command.reminder===null?null:makeReminder({kind:'once',date:command.reminder.date,time:command.reminder.time})};else throw new Error('未知操作');tasks.put({...t,...patch,updatedAt:Math.max(Date.now(),t.updatedAt+1)});}
        result={ok:true};
       }catch(e){result={error:e.message};}settings.put({key,value:result});set(result);
      };};
    });
  }
  material(id) {return this.transaction(['materials'],'readonly',(tx,set)=>{const r=tx.objectStore('materials').get(id);r.onsuccess=()=>set(r.result);});}
  allMaterials() {return this.transaction(['materials'],'readonly',(tx,set)=>{const r=tx.objectStore('materials').getAll();r.onsuccess=()=>set(r.result);});}
  getSetting(key) {return this.transaction(['settings'],'readonly',(tx,set)=>{const r=tx.objectStore('settings').get(key);r.onsuccess=()=>set(r.result?.value);});}
  setSetting(key,value) {return this.transaction(['settings'],'readwrite',tx=>tx.objectStore('settings').put({key,value}));}
  projects() {return this.transaction(['projects'],'readonly',(tx,set)=>{const r=tx.objectStore('projects').getAll();r.onsuccess=()=>set(r.result.sort((a,b)=>a.createdAt-b.createdAt));});}
  addProject(project) {return this.transaction(['projects'],'readwrite',tx=>tx.objectStore('projects').add(project));}
  moveTask(id,projectId) {
    return this.transaction(['tasks','projects'],'readwrite',(tx,set)=>{
      const tasks=tx.objectStore('tasks');
      const move=()=>{const r=tasks.get(id);r.onsuccess=()=>{if(!r.result||r.result.deletedAt){tx.abort();return;}const next={...r.result,projectId:projectId||'',updatedAt:Math.max(Date.now(),(r.result.updatedAt||0)+1)};tasks.put(next);set(next);};};
      if(!projectId){move();return;}const p=tx.objectStore('projects').get(projectId);p.onsuccess=()=>{if(!p.result){tx.abort();return;}move();};
    });
  }
  deleteProject(id) {
    return this.transaction(['tasks','projects'],'readwrite',tx=>{tx.objectStore('projects').delete(id);const tasks=tx.objectStore('tasks'),r=tasks.getAll();r.onsuccess=()=>{for(const task of r.result)if(task.projectId===id)tasks.put({...task,projectId:'',updatedAt:Math.max(Date.now(),(task.updatedAt||0)+1)});};});
  }
  update(id, patch) {
    return this.transaction(['tasks'],'readwrite',(tx,set)=>{
      const store=tx.objectStore('tasks'), request=store.get(id);
      request.onsuccess=()=>{
        if (!request.result) {tx.abort();return;}
        const value=typeof patch==='function'?patch(request.result):patch;
        if(!value){set(request.result);return;}
        const next={...request.result,...value,id,updatedAt:Math.max(Date.now(),(request.result.updatedAt||0)+1)};
        store.put(next);set(next);
      };
    });
  }
  materials(taskId) {
    return this.transaction(['materials'],'readonly',(tx,set)=>{const r=tx.objectStore('materials').index('taskId').getAll(taskId);r.onsuccess=()=>set(r.result.sort((a,b)=>a.createdAt-b.createdAt));});
  }
  async addMaterials(taskId, files, sessionId) {
    validateFiles(files);
    await this.precheck(files.reduce((total,file)=>total+(file.size||0),0));
    return this.transaction(['materials','tasks'],'readwrite',(tx,set)=>{
      const store=tx.objectStore('materials');
      const added=files.map(file=>({id:crypto.randomUUID(),taskId,name:file.name,type:file.type,size:file.size,createdAt:Date.now(),blob:file.slice(0,file.size,file.type),...(sessionId?{pendingSessionId:sessionId}:{})}));
      added.forEach(file=>store.add(file));set(added);
      const tasks=tx.objectStore('tasks'),r=tasks.get(taskId);
      r.onsuccess=()=>{if(!r.result){tx.abort();return;} tasks.put({...r.result,updatedAt:Date.now()});};
    });
  }
  markStaged(ids,sessionId) {
    return this.transaction(['materials'],'readwrite',tx=>{const store=tx.objectStore('materials');for(const id of ids){const r=store.get(id);r.onsuccess=()=>{if(r.result?.pendingSessionId===sessionId){const next={...r.result};delete next.pendingSessionId;store.put(next);}};}});
  }
  async precheck(bytes) {
    const storage=typeof navigator!=='undefined'?navigator.storage:null;
    if(!storage)return;
    try {if(storage.persisted&&!(await storage.persisted()))await storage.persist?.();} catch {}
    try {
      const estimate=await storage.estimate?.();
      if(estimate&&Number.isFinite(estimate.quota)&&estimate.quota>0){
        const free=estimate.quota-(estimate.usage||0);
        if(free<bytes*1.15)throw new Error('本机存储空间不足：本次约需 '+formatBytes(bytes)+'，剩余约 '+formatBytes(Math.max(0,free))+'。请确认重要资料已有本地备份，再清理不需要的材料后重试。');
      }
    } catch(error) {if(error&&error.message&&error.message.startsWith('本机存储空间不足'))throw error;}
  }
  purgeTasks(ids, keepMaterials = false) {
    if(!ids.length)return Promise.resolve(0);
    return this.transaction(keepMaterials?['tasks']:['tasks','materials'],'readwrite',tx=>{
      const tasks=tx.objectStore('tasks');
      if(!keepMaterials){const materials=tx.objectStore('materials');for(const id of ids){const keys=materials.index('taskId').getAllKeys(id);keys.onsuccess=()=>{for(const key of keys.result)materials.delete(key);};}}
      for(const id of ids)tasks.delete(id);
    });
  }
  reorderTask(id,before){return this.transaction(['tasks','settings'],'readwrite',(tx,set)=>{const q=tx.objectStore('tasks').getAll();q.onsuccess=()=>{const tasks=q.result.filter(t=>!t.deletedAt),settings=tx.objectStore('settings'),r=settings.get('manualTaskOrder');r.onsuccess=()=>{const ids=manualTaskOrder(tasks,r.result?.value||[]).map(t=>t.id),next=moveOrderedTask(ids,id,before);settings.put({key:'manualTaskOrder',value:next});set(next);};};});}
  renameMaterial(id,name) {return this.transaction(['materials'],'readwrite',(tx,set)=>{const store=tx.objectStore('materials'),q=store.get(id);q.onsuccess=()=>{if(!q.result){set(false);return;}store.put({...q.result,name});set(true);};});}
  deleteMaterial(id) {return this.transaction(['materials','settings'],'readwrite',tx=>{tx.objectStore('settings').put({key:'materialDeleted:'+id,value:true});tx.objectStore('materials').delete(id);});}
  async importMaterial(taskId,file) {
    validateFiles([file]);
    const digest=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const hash=await digest(file),existing=await this.materials(taskId);
    for(const material of existing){if(material.name===file.name&&material.size===file.size&&(material.hash||await digest(material.blob))===hash)return false;}
    await this.precheck(file.size||0);
    return this.transaction(['materials','tasks','settings'],'readwrite',(tx,set)=>{
      const store=tx.objectStore('materials'),id=taskId+':chat:'+hash+':'+file.name;
      const tomb=tx.objectStore('settings').get('materialDeleted:'+id);tomb.onsuccess=()=>{if(tomb.result?.value){set(false);return;}
      const request=store.get(id);
      request.onsuccess=()=>{if(request.result){set(false);return;}store.add({id,taskId,name:file.name,type:file.type,size:file.size,createdAt:Date.now(),blob:file.slice(),hash,origin:'conversation'});const tasks=tx.objectStore('tasks'),r=tasks.get(taskId);r.onsuccess=()=>{if(!r.result){tx.abort();return;}tasks.put({...r.result,updatedAt:Date.now()});};set(true);};
      };
    });
  }
  async importOutput(taskId, file, origin = OUTPUT_ORIGIN) {
    validateFiles([file]);
    const hash=await contentDigest(file),id=taskId+':'+origin+':'+file.name;
    const existing=await this.transaction(['materials'],'readonly',(tx,set)=>{const r=tx.objectStore('materials').get(id);r.onsuccess=()=>set(r.result);});
    if(existing&&(existing.sourceHash===hash||existing.size===file.size&&existing.hash===hash))return false;
    await this.precheck(file.size||0);
    return this.transaction(['materials','tasks','settings'],'readwrite',(tx,set)=>{
      const tomb=tx.objectStore('settings').get('materialDeleted:'+id);tomb.onsuccess=()=>{if(tomb.result?.value){set(false);return;}
      tx.objectStore('materials').put({id,taskId,name:file.name,type:file.type,size:file.size,createdAt:Date.now(),blob:file.slice(),hash,sourceHash:hash,origin,...existing?.localHash?{localHash:existing.localHash}:{}});
      const tasks=tx.objectStore('tasks'),r=tasks.get(taskId);
      r.onsuccess=()=>{if(!r.result){tx.abort();return;}tasks.put({...r.result,updatedAt:Date.now()});};
      set(true);};
    });
  }
  async backup() {
    return this.transaction(['tasks','materials','projects'],'readonly',(tx,set)=>{
      const data={tasks:null,materials:null,projects:null};
      for(const name of ['tasks','materials','projects']) {const r=tx.objectStore(name).getAll();r.onsuccess=()=>{data[name]=r.result;if(data.tasks&&data.materials&&data.projects)set(data);};}
    });
  }
  async upsertLocal(meta,blob) {
    if(blob)await this.precheck(blob.size);
    return this.transaction(['materials','tasks','settings'],'readwrite',(tx,set)=>{
      const tomb=tx.objectStore('settings').get('materialDeleted:'+meta.id);tomb.onsuccess=()=>{
        if(tomb.result?.value){set(false);return;}
        const tasks=tx.objectStore('tasks'),q=tasks.get(meta.taskId);q.onsuccess=()=>{
          if(!q.result||q.result.deletedAt){set(false);return;}
          const store=tx.objectStore('materials'),r=store.get(meta.id);r.onsuccess=()=>{
            const previous=r.result;store.put({...previous,...meta,type:guessMime(meta.name),blob,localHash:meta.hash});
            set(!previous||previous.hash!==meta.hash||previous.name!==meta.name);
          };
        };
      };
    });
  }
  async mergeRestore(plan,choices={}) {
    const incoming=plan.data;await this.precheck(incoming.materials.reduce((sum,m)=>sum+m.size,0));
    const affected=new Set();
    await this.transaction(['tasks','projects','materials','settings'],'readwrite',(tx,set)=>{
      const current={},names=['tasks','projects','materials'];let ready=0;
      for(const kind of names){const request=tx.objectStore(kind).getAll();request.onsuccess=()=>{current[kind]=request.result;if(++ready!==3)return;
        if(backupStamp(current)!==plan.stamp){tx.abort();return;}
        const conflictKeys=new Set(plan.conflicts.map(c=>c.key));
        for(const type of names){const store=tx.objectStore(type),existing=new Map(current[type].map(r=>[r.id,r]));for(const row of incoming[type]){
          const old=existing.get(row.id);if(old&&(!conflictKeys.has(type+':'+row.id)||choices[type+':'+row.id]!=='replace'))continue;
          let next={...row};if(type==='projects')for(const task of [...current.tasks,...incoming.tasks])if(task.projectId===row.id)affected.add(task.id);if(type==='tasks'){next={...next,sessionId:old?.sessionId||'',workspaceId:old?.workspaceId||'',updatedAt:Math.max(Date.now(),(old?.updatedAt||0)+1)};affected.add(row.id);}if(type==='materials'){delete next.dataUrl;delete next.pendingSessionId;tx.objectStore('settings').delete('materialDeleted:'+row.id);affected.add(row.taskId);}store.put(next);
        }}set(true);
      };}
    }).catch(error=>{throw new Error('恢复未写入：内容可能已变化或存储失败，请重新选择备份。'+(error?.message||''));});
    this.localDirtyTasks ||= new Set();for(const id of affected)this.localDirtyTasks.add(id);
  }
  async applyCoordinatorEdit(command){
    const result=await this.transaction(['tasks','settings'],'readwrite',(tx,set)=>{
      const tasks=tx.objectStore('tasks'),settings=tx.objectStore('settings'),key='coordinatorEdit:'+command.id;
      const fail=error=>set({error}),receipt=settings.get(key);
      receipt.onsuccess=()=>{const binding=settings.get('workSession');binding.onsuccess=()=>{
        if(!command.coordinator||binding.result?.value!==command.sessionId){fail('当前窗口尚未绑定工作协作，请从工作台打开工作协作后重试。');return;}
        if(receipt.result){if(receipt.result.value.signature!==JSON.stringify([command.taskId,command.operation])){fail('请求编号已用于其他操作');return;}set(receipt.result.value.answer);return;}
        if(command.expiresAt&&Date.now()>=command.expiresAt){fail('请求已过期，没有执行。');return;}
        const op=command.operation,commit=answer=>{settings.put({key,value:{signature:JSON.stringify([command.taskId,op]),answer}});set(answer);};
        if(op.action==='create'){
          const title=String(op.text||'').trim();if(!title||title.length>200){fail('标题请输入1到200字。');return;}
          const now=Date.now(),task={id:command.taskId,title,description:'',status:'todo',steps:[],sessionId:'',workspaceId:'',createdAt:now,updatedAt:now};
          const exists=tasks.get(task.id);exists.onsuccess=()=>{if(exists.result){fail('待办编号已存在');return;}tasks.add(task);commit({task,created:true});};return;
        }
        const q=tasks.get(command.taskId);q.onsuccess=()=>{const task=q.result;if(!task||task.deletedAt){fail('待办已不存在');return;}if(!Number.isFinite(op.expectedUpdatedAt)||task.updatedAt!==op.expectedUpdatedAt){fail('待办已经变化，请重新读取后修改。');return;}
          if(op.action==='delete'){tasks.delete(task.id);commit({task,deleted:true,materialsKept:true});return;}
          let patch={},text=typeof op.text==='string'?op.text.trim():'';
          if(op.action==='set_title'){if(!text||text.length>200){fail('标题请输入1到200字');return;}patch.title=text;}
          else if(op.action==='set_description'){if(typeof op.text!=='string'||op.text.length>100000){fail('备注内容无效或过长');return;}patch.description=op.text;}
          else if(op.action==='append_note'){if(!text||text.length>20000||(task.description||'').length+text.length>100000){fail('备注无效或过长');return;}patch.description=[task.description||'',text].filter(Boolean).join('\n\n');}
          else if(op.action==='set_done'){if(typeof op.done!=='boolean'){fail('完成状态无效');return;}patch=(task.status==='done')===op.done?{}:completionPatch(task);}
          else if(['add_step','edit_step','set_step_done'].includes(op.action)){
            const steps=(task.steps||[]).map(x=>({...x}));if(op.action==='add_step'){if(!text||text.length>500||steps.length>=20){fail('步骤无效或超过20步');return;}steps.push({id:crypto.randomUUID(),text,done:false});}
            else{const step=steps.find(x=>x.id===op.stepId);if(!step){fail('步骤不存在');return;}if(op.action==='edit_step'){if(!text||text.length>500){fail('步骤文字无效');return;}step.text=text;}else{if(typeof op.done!=='boolean'){fail('完成状态无效');return;}step.done=op.done;}}patch.steps=steps;
          }else{fail('不支持此操作');return;}
          const next={...task,...patch,updatedAt:Math.max(Date.now(),task.updatedAt+1)};tasks.put(next);commit({task:next});
        };
      };};
    });
    if(result.error)throw Error(result.error);this.localDirtyTasks ||= new Set();this.localDirtyTasks.add(result.task.id);return result;
  }
  async applyAgentEdit(command){
    const result=await this.transaction(['tasks','settings'],'readwrite',(tx,set)=>{
      const tasks=tx.objectStore('tasks'),settings=tx.objectStore('settings'),receiptKey='agentEdit:'+command.id;
      const fail=message=>{set({error:message});};
      const receipt=settings.get(receiptKey);receipt.onsuccess=()=>{
        if(receipt.result){set(receipt.result.value);return;}
        const apply=(taskId,undo)=>{const q=tasks.get(taskId);q.onsuccess=()=>{
          const task=q.result;if(command.expiresAt&&Date.now()>=command.expiresAt){fail('修改请求已过期，本次没有写入。');return;}if(!task||task.deletedAt||task.sessionId!==command.sessionId){fail('待办已删除或不属于当前会话。');return;}
          if(!undo&&!Number.isFinite(command.expectedUpdatedAt)){fail('请先读取最新待办版本。');return;}
          if(undo?task.updatedAt!==undo.appliedAt:task.updatedAt!==command.expectedUpdatedAt){fail('待办已有新的修改，请重新读取最新状态；本次没有写入。');return;}
          let patch={},previous={};
          if(undo){if(undo.undone){fail('该修改已经撤销。');return;}patch=undo.previous;}
          else {
            const action=command.action,text=command.text;
            if(['append_note','set_title','add_step','edit_step'].includes(action)&& (typeof text!=='string'||!text.trim())){fail('请输入有效文字。');return;}
            if(action==='append_note'){if(text.length>20000||(task.description||'').length+text.length>100000){fail('备注过长，请保存为材料。');return;}patch.description=[task.description||'',text.trim()].filter(Boolean).join('\n\n');}
            else if(action==='set_title'){if(text.trim().length>200){fail('标题最多200字。');return;}patch.title=text.trim();}
            else if(['add_step','edit_step','set_step_done'].includes(action)){
              const steps=(task.steps||[]).map(row=>({...row}));
              if(action==='add_step'){if(steps.length>=20||text.trim().length>500){fail('清单最多20步，每步最多500字。');return;}steps.push({id:crypto.randomUUID(),text:text.trim(),done:false});}
              else {const step=steps.find(row=>row.id===command.stepId);if(!step){fail('该步骤已不存在。');return;}if(action==='edit_step'){if(text.trim().length>500){fail('步骤最多500字。');return;}step.text=text.trim();}else {if(typeof command.done!=='boolean'){fail('done 必须为布尔值。');return;}step.done=command.done;}}patch.steps=steps;
            }else{fail('不支持此操作。');return;}
          }
          for(const key of Object.keys(patch))previous[key]=task[key]??(key==='steps'?[]:'');
          const next={...task,...patch,updatedAt:Math.max(Date.now(),(task.updatedAt||0)+1)};tasks.put(next);
          if(undo)settings.put({key:'agentEdit:'+command.undoId,value:{...undo,undone:true}});
          const answer={task:next,undoId:undo?null:command.id,appliedAt:next.updatedAt,previous};settings.put({key:receiptKey,value:answer});set(answer);
        };};
        if(command.action==='undo'){const u=settings.get('agentEdit:'+command.undoId);u.onsuccess=()=>{if(!u.result){fail('撤销记录不存在。');return;}apply(u.result.value.task.id,u.result.value);};}
        else apply(command.taskId,null);
      };
    });
    if(result.error)throw new Error(result.error);this.localDirtyTasks ||= new Set();this.localDirtyTasks.add(result.task.id);return result;
  }
  close() {this.dbPromise?.then(db=>db.close(),()=>{});this.dbPromise=null;}
}

// Track committed changes; failed transactions never enqueue work.
for(const name of ['addMaterials','importMaterial','importOutput','moveTask','update','purgeTasks','deleteMaterial','deleteProject']){
 const original=WorkbenchRepository.prototype[name];
 WorkbenchRepository.prototype[name]=async function(...args){
  let affected=[];
  if(name==='deleteMaterial'){const m=await this.transaction(['materials'],'readonly',(tx,set)=>{const q=tx.objectStore('materials').get(args[0]);q.onsuccess=()=>set(q.result);});if(m)affected=[m.taskId];}
  else if(name==='deleteProject')affected=(await this.list()).filter(t=>t.projectId===args[0]).map(t=>t.id);
  else affected=name==='purgeTasks'?args[0]:[args[0]];
  const result=await original.apply(this,args);
  const relevant=name!=='update'||typeof args[1]==='function'||Object.hasOwn(args[1],'title')||Object.hasOwn(args[1],'projectId');
  if(relevant&&result!==false){this.localDirtyTasks ||= new Set();for(const id of affected)this.localDirtyTasks.add(id);}
  return result;
 };
}
