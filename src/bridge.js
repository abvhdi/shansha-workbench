function remoteValue(result){if(result&&typeof result.ok==='boolean'){if(!result.ok)throw new Error(result.error?.message||'Harness 接口调用失败');return result.value;}return result;}
class HarnessBridge {
  constructor(ctx, repo) {this.ctx=ctx;this.repo=repo;this.busy=new Set();this.importedDrafts=new Set();}
  workspaces() {return this.ctx.workspaces?.list.getSnapshot().items || [];}
  originalPath(file) {return typeof file.path==='string'&&/^(?:[A-Za-z]:[\\/]|\\\\)/.test(file.path)?file.path:null;}
  async removeOriginal(material,file) {const sourcePath=this.originalPath(file);if(!sourcePath)return {removed:false};return this.nativeCall('shanshaFiles/removeOriginal',{request:{fileId:material.id,sourcePath}});}
  sessionWorkspace(id) {return this.workspaces().find(w=>w.sessionIds?.includes(id));}
  workspaceMismatch(task) {
    const id=this.ctx.uiWorkspace?.selection?.getSnapshot()?.sessionId;
    if(!task.sessionId||!id||id===task.sessionId)return null;
    const rows=this.ctx.sessions?.list.getSnapshot()?.byId||{},current=rows[id],linked=rows[task.sessionId];
    if(!current||!linked||current.parentId||current.origin==='subagent')return null;
    const a=this.sessionWorkspace(id),b=this.sessionWorkspace(task.sessionId);
    const normalize=p=>String(p||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
    const different=a&&b?a.workspaceId!==b.workspaceId:current.cwd&&linked.cwd&&normalize(current.cwd)!==normalize(linked.cwd);
    return different?{sessionId:id,title:current.title||'当前会话',workspaceName:a?.title||a?.name||current.cwd,linkedTitle:linked.title||'原会话'}:null;
  }
  sessionOptions(task={}) {const snapshot=this.ctx.workspaces?.list.getSnapshot();const items=snapshot?.items||[];const workspace=items.find(w=>w.workspaceId===task.workspaceId)||items.find(w=>w.workspaceId===snapshot?.defaultWorkspaceId)||items[0];if(workspace)return {workspaceId:workspace.workspaceId};if(task.workspaceId)return {workspaceId:task.workspaceId};throw new Error('默认工作区尚未加载，请等待工作区加载后再试。');}
  revealSession(id) {this.ctx.uiWorkspace.openSession(id);const actual=this.ctx.uiWorkspace.selection?.getSnapshot()?.sessionId;if(actual&&actual!==id)throw new Error('会话跳转不一致，未创建新会话，请返回工作台重试。');}

  async openWorkshop(scopeLabel,files,selectedIds,options={}) {
    if(this.busy.has('__workshop'))throw new Error('正在打开文件会话，请稍候。');
    if(files.length>500)throw new Error('文件范围超过 500 条，请先选择项目、待办或搜索缩小范围。');
    this.busy.add('__workshop');let reference,drafts=[],attached=false;
    try {
      const materials=(await this.repo.allMaterials()).filter(m=>selectedIds.includes(m.id)&&files.some(f=>f.id===m.id));
      if(materials.some(m=>m.localOnly))throw new Error('大文件不能直接作为会话附件发送，可在待办关联会话中读取本地文件。');validateFiles(materials);if(materials.length!==selectedIds.length)throw new Error('所选文件已变化，请重新选择。');
      let id=await this.repo.getSetting(options.settingKey||'fileWorkshopSession');
      if(!id){id=await this.ctx.sessions.create(this.sessionOptions());await this.repo.setSetting(options.settingKey||'fileWorkshopSession',id);const renamed=await this.ctx.remote.session.rename({sessionId:id,title:options.title||'珊莎 · 文件工坊'});if(!renamed.ok)console.warn('文件工坊会话标题未更新');}
      reference=this.ctx.sessions.retain(id,{source:'shansha-file-workshop'});const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开文件工坊会话超时，请稍后重试。');
      if(binding.session.getSnapshot().openState==='error')throw new Error('文件工坊会话无法打开，请在 Harness 中检查该会话。');
      const conversation=this.ctx.get('conversation'),input=conversation.input.for(binding.ctx);
      if(['adjudicating','submitting'].includes(input.snapshot.phase))throw new Error('文件会话正在提交，请稍后重试。');
      const prompt=workshopPrompt(scopeLabel,files,selectedIds),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prompt)))).map(n=>n.toString(16).padStart(2,'0')).join('');
      const marker='[珊莎文件工坊 '+hash+']';
      if(!input.snapshot.draft.includes(marker)){
        if(materials.length){drafts=conversation.createDrafts(id,materials.map(m=>new File([m.blob],m.name,{type:m.type,lastModified:m.createdAt})));attached=input.actions.addAttachments(drafts.map(d=>d.id));if(!attached)throw new Error('文件会话暂时不能接收附件。');}
        input.actions.setDraft([input.snapshot.draft,marker,prompt].filter(Boolean).join('\n\n'));
      }
      this.revealSession(id);
    } finally {if(drafts.length&&!attached)this.ctx.get('conversation').releaseDraftAttachments(drafts);reference?.release();this.busy.delete('__workshop');}
  }
  async openProject(project,tasks,projects) {
    const files=workshopFiles(await this.repo.allMaterials(),tasks,projects,{projectId:project.id});
    await this.openWorkshop('项目：'+project.name,files,files.map(f=>f.id),{settingKey:'projectSession:'+project.id,title:'珊莎 · '+project.name});
  }
  async nativeCall(method,args={}) {
    const connection=this.ctx.get('connection');if(!connection?.rpc)throw new Error('本地文件服务连接不可用，请重启 Harness。');
    const controller=new AbortController(),interactive=method==='shanshaFiles/open'||method==='directoryPicker/pick',timeout=this.rpcTimeout|| (interactive?300000:method==='shanshaFiles/templatesIdentify'?60000:['shanshaFiles/mobileConnect','shanshaFiles/mobileInbox'].includes(method)?45000:['shanshaFiles/databaseExtract','shanshaFiles/suggestTaskSteps'].includes(method)?30000:method==='shanshaFiles/parseTaskInput'?25000:15000);
    try{return remoteValue(await withTimeout(connection.rpc.call('/api',method,{args},controller.signal),timeout,'本地文件操作超时，请稍后重试。'));}catch(error){if(method.startsWith('shanshaFiles/database')&&/HTTP 404|status.?404/i.test(error?.message||''))throw new Error('数据库的新接口尚未加载。请先保留未保存的输入，完整退出 Harness（包括托盘）再打开；仅刷新页面无效。');if(method.startsWith('shanshaFiles/knowledge')&&/HTTP 404|status.?404/i.test(error?.message||''))throw new Error('知识库服务尚未加载。请完整退出 Harness（包括托盘）后重新打开，再进入知识库；仅刷新页面不会加载新服务。');throw error;}finally{controller.abort();}
  }
  async backupInfo(){return this.nativeCall('shanshaFiles/backupInfo');}
  async openBackupFolder(){return this.nativeCall('shanshaFiles/open',{request:{directory:true,backupDirectory:true}});}
  async loadAutomaticBackup(previous=false){
    const state=await this.nativeCall('shanshaFiles/backupState',{request:{previous}}),materials=[];let total=0;
    for(const m of state.materials){total+=m.size;if(m.size>MAX_FILE_BYTES||total>BACKUP_LIMIT)throw new Error('自动备份材料总量超过本次恢复上限');let text='';for(let offset=0;offset<m.size;offset+=524288){const chunk=await this.nativeCall('shanshaFiles/backupBytes',{request:{previous,fileId:m.id,offset,length:Math.min(524288,m.size-offset)}});if(chunk.size!==m.size)throw new Error('自动备份材料与记录不一致：'+m.name);text+=atob(chunk.data);}if(text.length!==m.size)throw new Error('自动备份读取不完整：'+m.name);materials.push({...m,dataUrl:'data:'+(m.type||'application/octet-stream')+';base64,'+btoa(text)});}
    return decodeBackup(JSON.stringify({format:'shansha-workbench',version:2,tasks:state.tasks,projects:state.projects,materials,exportedAt:state.exportedAt}));
  }
  async openLocation(){return this.nativeCall('shanshaFiles/open',{request:{directory:true}});}
  async fileLocation(){return this.nativeCall('shanshaFiles/info');}
  async importLocalFiles(repo=this.repo){
    if(this.readingLocal)return this.readingLocal;
    this.readingLocal=(async()=>{const manifest=await this.nativeCall('shanshaFiles/localManifest');this.diskImported ||= new Map();let changed=0;const failures=[];
      for(const meta of manifest.files||[]){try{const signature=JSON.stringify([meta.hash,meta.name,meta.taskId]);if(this.diskImported.get(meta.id)===signature)continue;
        const existing=await repo.material(meta.id);if(existing?.hash===meta.hash&&existing.localHash===meta.hash&&existing.name===meta.name){this.diskImported.set(meta.id,signature);continue;}
        if(meta.localOnly){if(await repo.upsertLocal(meta,null))changed++;this.diskImported.set(meta.id,signature);continue;}
        const parts=[];for(let offset=0;offset<meta.size;offset+=524288){const chunk=await this.nativeCall('shanshaFiles/localBytes',{request:{fileId:meta.id,hash:meta.hash,offset,length:Math.min(524288,meta.size-offset)}});if(chunk.size!==meta.size)throw new Error('文件正在修改，稍后会重新读取。');parts.push(Uint8Array.from(atob(chunk.data),ch=>ch.charCodeAt(0)));}
        const blob=new Blob(parts,{type:guessMime(meta.name)});if(blob.size!==meta.size||await contentDigest(blob)!==meta.hash)throw new Error('文件正在修改，稍后会重新读取。');
        if(await repo.upsertLocal(meta,blob))changed++;this.diskImported.set(meta.id,signature);
      }catch(error){failures.push(meta.name+'：暂时无法读取，其他文件不受影响。');}}this.localWarnings=[...(manifest.warnings||[]),...failures];return changed;
    })().finally(()=>{this.readingLocal=null;});return this.readingLocal;
  }
  async syncLocal(repo){
    if(this.localSync){await this.localSync;return this.syncLocal(repo);}
    if(this.localInitialized&&!repo.localDirtyTasks?.size)return;
    this.localSync=(async()=>{
      this.localSaved ||= new Map();
      const full=!this.localInitialized,dirty=new Set(repo.localDirtyTasks||[]);
      repo.localDirtyTasks?.clear();
      try{
        const tasks=await repo.list(),projects=await repo.projects();
        const materials=full?await repo.allMaterials():(await Promise.all([...dirty].map(id=>repo.materials(id)))).flat();
        const present=new Set(materials.map(m=>m.id)),failures=[];this.localFailures ||= new Map();for(const [id,failure]of this.localFailures)if((full||dirty.has(failure.taskId))&&!present.has(id))this.localFailures.delete(id);
        for(const m of materials){const t=tasks.find(t=>t.id===m.taskId),p=projects.find(p=>p.id===t?.projectId);
          const signature=JSON.stringify([m.hash||m.createdAt,m.size,m.name,t?.title,p?.id,p?.name]);
          if(this.localSaved.get(m.id)?.signature===signature)continue;
          const previous=this.localFailures.get(m.id);if(previous?.signature===signature&&previous.retryAt>Date.now()){repo.localDirtyTasks ||= new Set();repo.localDirtyTasks.add(m.taskId);continue;}
          try{await this.saveLocal(m,t,p);this.localSaved.set(m.id,{signature,taskId:m.taskId});this.localFailures.delete(m.id);}
          catch(error){this.localFailures.set(m.id,{signature,taskId:m.taskId,retryAt:Date.now()+30000});repo.localDirtyTasks ||= new Set();repo.localDirtyTasks.add(m.taskId);failures.push(m.name+'：'+error.message);}
        }
        if(full)await this.nativeCall('shanshaFiles/prune',{request:{ids:materials.map(m=>m.id)}});
        else {const ids=[...this.localSaved].filter(([id,v])=>dirty.has(v.taskId)&&!present.has(id)).map(([id])=>id);
          if(ids.length){await this.nativeCall('shanshaFiles/remove',{request:{ids}});for(const id of ids)this.localSaved.delete(id);}}
        this.localInitialized=true;if(failures.length)throw new Error('有些文件暂时没能保存，已保存的文件不受影响：'+failures.join('；'));
      }catch(error){repo.localDirtyTasks ||= new Set();for(const id of dirty)repo.localDirtyTasks.add(id);throw error;}
    })().finally(()=>{this.localSync=null;});
    await this.localSync;if(repo.localDirtyTasks?.size&&!this.localFailures?.size)return this.syncLocal(repo);
  }
  savedFileFeedback(material,result){
    if(!result?.renamed)return;const name=String(result.path).split(/[\\/]/).pop();this.renamedNotices ||= new Set();const key=material.id+':'+name;
    if(!this.renamedNotices.has(key)){this.renamedNotices.add(key);this.fileNotice='已保留同名文件，新文件保存为“'+name+'”。';}
  }
  async saveLocal(m,task,project){
    if(m.localOnly)return null;
    const hash=m.hash||await contentDigest(m.blob),request={id:m.id,name:m.name,size:m.size,hash,localHash:m.localHash,project:project?project.name+'-'+project.id.slice(0,8):'未归类',task:(task?.title||'已删除待办')+'-'+String(m.taskId).slice(0,8)};
    const begin=await this.nativeCall('shanshaFiles/begin',{request});this.savedFileFeedback(m,begin);if(begin.localChanged){await this.importLocalFiles();return begin.path;}if(begin.unchanged)return begin.path;
    try{const bytes=new Uint8Array(await m.blob.arrayBuffer());for(let offset=0;offset<bytes.length;offset+=524288){let text='';const chunk=bytes.subarray(offset,offset+524288);for(let i=0;i<chunk.length;i+=8192)text+=String.fromCharCode(...chunk.subarray(i,i+8192));await this.nativeCall('shanshaFiles/chunk',{request:{token:begin.token,data:btoa(text)}});}
    const saved=await this.nativeCall('shanshaFiles/commit',{request:{token:begin.token}});this.savedFileFeedback(m,saved);return saved.path;}catch(error){await this.nativeCall('shanshaFiles/cancel',{request:{token:begin.token}}).catch(()=>{});throw error;}
  }
  async changeLocation(){if(this.localSync)await this.localSync;const root=await this.nativeCall('directoryPicker/pick');if(!root)return null;return this.nativeCall('shanshaFiles/change',{request:{root}});}
  async renameMaterial(file,name){if(this.localSync)await this.localSync;const material=await this.repo.material(file.id);if(!material)throw new Error('文件已不存在。');const task=(await this.repo.list()).find(t=>t.id===material.taskId),project=(await this.repo.projects()).find(p=>p.id===task?.projectId);await this.saveLocal(material,task,project);const result=await this.nativeCall('shanshaFiles/renameFile',{request:{fileId:file.id,name}});await this.repo.renameMaterial(file.id,result.name);this.diskImported?.delete(file.id);await this.importLocalFiles();return result;}
  async copyMaterial(file){if(this.localSync)await this.localSync;const material=await this.repo.material(file.id);if(!material)throw new Error('文件已不存在。');const task=(await this.repo.list()).find(t=>t.id===material.taskId),project=(await this.repo.projects()).find(p=>p.id===task?.projectId);await this.saveLocal(material,task,project);return this.nativeCall('shanshaFiles/copyFile',{request:{fileId:material.id}});}
  async openMaterial(file,options={}){
    this.openingFiles ||= new Map();if(this.openingFiles.has(file.id))return this.openingFiles.get(file.id);
    const run=(async()=>{const request={fileId:file.id,...options.openWith?{openWith:true}:{}};
      const result=await this.nativeCall('shanshaFiles/open',{request});if(!result?.needsSave)return result;
      const material=await this.repo.material(file.id);if(!material)throw new Error('文件已不存在。');if(material.localOnly)throw new Error('找不到本地文件，请检查保存文件夹。');
      const task=(await this.repo.list()).find(t=>t.id===material.taskId),project=(await this.repo.projects()).find(p=>p.id===task?.projectId);await this.saveLocal(material,task,project);
      return this.nativeCall('shanshaFiles/open',{request});
    })();this.openingFiles.set(file.id,run);try{return await run;}finally{this.openingFiles.delete(file.id);}
  }

  async pushWork(repo){
    const run=async()=>{const tasks=await repo.list(),projects=await repo.projects(),materials=(await repo.allMaterials()).map(({blob,...metadata})=>metadata),workSession=await repo.getSetting('workSession');return this.nativeCall('shanshaFiles/snapshot',{request:{tasks,projects,materials,workSession}});};
    if(globalThis.navigator?.locks?.request)return navigator.locks.request('shansha-work-snapshot',run);
    throw new Error('浏览器未提供多窗口同步锁，已停止推送快照以避免覆盖。');
  }
  async openWork(){
    if(this.workOpening)return this.workOpening;
    const run=async()=>{let reference,owned=false;
      try{
        if(this.disposed)throw Error('工作台已关闭');
        const navigation=this.ctx.layout?.beginNavigation?.();
        // The host binding is authoritative; never create a replacement for a failed reopen.
        const bound=await this.nativeCall('shanshaFiles/workBinding',{request:{}});
        let id=bound.sessionId||await this.repo.getSetting('workSession');
        if(!id){id=await this.ctx.sessions.create(this.sessionOptions());}
        if(typeof id!=='string'||!id)throw new Error('工作协作会话编号无效，未新建替代会话');
        reference=this.workReference?.sessionId===id?this.workReference:this.ctx.sessions.retain(id,{source:'shansha-work'});owned=reference!==this.workReference;
        const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开原工作协作会话超时，未新建会话');
        let snapshot=binding.session.getSnapshot();
        const listed=this.ctx.sessions.list?.getSnapshot()?.byId?.[id],normalize=p=>String(p||'').replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
        // Legacy coordinator sessions were created under the plugin profile, outside every user workspace.
        // The blank hero then switches to a workspace's OTHER blank session when a directory is chosen.
        if(snapshot.blank===true&&listed?.cwd&&this.workspaces().length&&!this.sessionWorkspace(id)&&!this.workspaces().some(w=>normalize(w.path)===normalize(listed.cwd))){
          const oldId=id,newId=await this.ctx.sessions.create({...this.sessionOptions(),sessionId:id+'-workbench'});
          const replacement=this.ctx.sessions.retain(newId,{source:'shansha-work'});let transferred=false;
          try{const ready=await withTimeout(replacement.ready,BRIDGE_READY_TIMEOUT,'工作协作工作区修复超时');if(ready.session.getSnapshot().openState==='error')throw Error('工作协作会话无法加载');
            const saved=await this.nativeCall('shanshaFiles/workBinding',{request:{sessionId:newId,replaceEmptySession:oldId}});if(saved.sessionId!==newId)throw Error('工作协作修复未确认');
            if(owned)reference.release();else {this.workReference?.release();this.workReference=null;}reference=replacement;owned=true;id=newId;snapshot=ready.session.getSnapshot();transferred=true;
          }finally{if(!transferred)replacement.release();}
        }
        if(snapshot.openState==='error'||reference.sessionId&&reference.sessionId!==id||snapshot.sessionId&&snapshot.sessionId!==id)throw new Error('原工作协作会话加载不一致，未新建替代会话');
        await this.repo.setSetting('workSession',id);
        const confirmed=await this.nativeCall('shanshaFiles/workBinding',{request:{sessionId:id,phase:'opening',clientVersion:'0.1.60'}});
        if(confirmed.sessionId!==id)throw new Error('工作协作绑定不一致，请重新打开');
        await this.pushWork(this.repo);
        // Always name the saved session, including old blank sessions created before this fix.
        if(this.ctx.remote?.session?.rename)remoteValue(await this.ctx.remote.session.rename({sessionId:id,title:'珊莎 · 工作协作'}));
        navigation?.throwIfAborted();
        this.revealSession(id);
        await new Promise(resolve=>setTimeout(resolve,180));
        if(this.disposed)throw Error('工作台已关闭，已停止跳转');
        const actual=this.ctx.uiWorkspace.selection?.getSnapshot()?.sessionId;
        if(actual!==id)throw new Error('工作协作跳转被其他导航替换，未切换关联或新建会话。请重新点击工作协作。');
        const row=this.ctx.sessions.list?.getSnapshot()?.byId?.[id];
        if(row?.retainedBy&&!(row.retainedBy.mainView>0))throw new Error('原会话尚未接管主视图，未新建会话，请重新打开。');
        await this.nativeCall('shanshaFiles/workBinding',{request:{sessionId:id,phase:'opened',actualSessionId:actual,clientVersion:'0.1.60'}});
        if(owned){this.workReference?.release();this.workReference=reference;owned=false;}
        return {sessionId:id};
      }finally{if(owned)reference?.release();}
    };
    const pending=globalThis.navigator?.locks?.request?navigator.locks.request('shansha-open-work-session',run):run();this.workOpening=pending;
    try{return await pending;}finally{if(this.workOpening===pending)this.workOpening=null;}
  }
  dispose(){this.disposed=true;this.workReference?.release();this.workReference=null;}
  async openDatabase(capture){
    if(this.busy.has('__database'))throw new Error('正在打开数据会话，请稍后重试。');this.busy.add('__database');let reference;
    try{const catalog=await this.nativeCall('shanshaFiles/databaseCatalog');let id=catalog.sessionId||await this.repo.getSetting('databaseSession');if(!id){id=await this.ctx.sessions.create(this.sessionOptions());await this.repo.setSetting('databaseSession',id);}
      await this.nativeCall('shanshaFiles/databaseBind',{request:{sessionId:id}});
      reference=this.ctx.sessions.retain(id,{source:'shansha-database'});const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开数据库会话超时');if(binding.session.getSnapshot().openState==='error')throw Error('数据库会话无法打开，请在Harness中检查原会话');
      remoteValue(await this.ctx.remote.session.rename({sessionId:id,title:'珊莎 · 数据库'}));this.revealSession(id);
      if(!this.openDatabasePanel)throw new Error('数据库会话已打开，但右侧表格扩展尚未加载，请完整重启 Harness 后重试。');
      await this.openDatabasePanel(id);
      if(capture){
        const input=this.ctx.get('conversation').input.for(binding.ctx);
        if(['adjudicating','submitting'].includes(input.snapshot.phase))throw new Error('数据会话正在提交，原内容未改动，请稍后重试。');
        const prompt=databaseCapturePrompt(capture);
        if(!input.snapshot.draft.includes(prompt))input.actions.setDraft([input.snapshot.draft,prompt].filter(Boolean).join('\n\n'));
      }
    }finally{reference?.release();this.busy.delete('__database');}
  }
  sessionTitle(id) {
    const row=this.ctx.sessions.list?.getSnapshot().byId[id];
    return row?.displayTitle||row?.title||'已关联会话';
  }
  async stageMaterials(task,materials) {
    materials=materials.filter(m=>!m.localOnly);if(!materials.length||!task.sessionId)return;
    const reference=this.ctx.sessions.retain(task.sessionId,{source:'shansha-workbench'});
    let drafts=[],attached=false;
    try {
      const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开关联会话超时，请稍后重试。');
      const conversation=this.ctx.get('conversation'),input=conversation.input.for(binding.ctx);
      if(binding.session.getSnapshot().openState==='error')throw new Error('关联会话无法打开。');
      if(['adjudicating','submitting'].includes(input.snapshot.phase))throw new Error('会话正在提交，请稍后点击详情页的加入会话草稿按钮。');
      drafts=conversation.createDrafts(task.sessionId,materials.map(m=>new File([m.blob],m.name,{type:m.type,lastModified:m.createdAt})));
      attached=input.actions.addAttachments(drafts.map(d=>d.id));
      if(!attached)throw new Error('会话暂时不能接收附件。');
    } finally {if(drafts.length&&!attached)this.ctx.get('conversation').releaseDraftAttachments(drafts);reference.release();}
  }
  async importDraftMaterials(task) {
    const reference=this.ctx.sessions.retain(task.sessionId,{source:'shansha-workbench'});
    try {
      const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开关联会话超时，请稍后重试。');
      if(binding.session.getSnapshot().openState==='error')return 0;
      const conversation=this.ctx.get('conversation'),input=conversation.input.for(binding.ctx);
      const drafts=conversation.resolveDraftAttachments(input.snapshot.attachmentIds);
      let count=0;
      for(const draft of drafts){const key=task.id+':'+task.sessionId+':'+draft.id;if(this.importedDrafts.has(key))continue;if(await this.repo.importMaterial(task.id,draft.file))count++;this.importedDrafts.add(key);}
      return count;
    } finally {reference.release();}
  }
  outputsAvailable() {
    try {const files=this.ctx.remote?.workspaceFiles;return typeof files?.list==='function'&&typeof files?.readBytes==='function';}
    catch(error) {console.warn('工作台：工作目录文件接口暂不可用',error);return false;}
  }
  async readWorkspaceBytes(sessionId, path, size) {
    const remote=this.ctx.remote.workspaceFiles;
    if(size===undefined||size<=32*1024*1024){const result=remoteValue(remoteValue(await withTimeout(remote.readBytes(sessionId,path,{}),15000,'读取产出超时')));return (result&&result.data)||null;}
    const window=1024*1024,parts=[];
    for(let offset=0;offset<size;offset+=window){
      const result=remoteValue(remoteValue(await withTimeout(remote.readBytes(sessionId,path,{range:{offset,length:Math.min(window,size-offset)}}),15000,'读取产出超时')));
      if(!result||!result.data||!result.data.length)break;
      parts.push(result.data);
    }
    const merged=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let at=0;
    for(const part of parts){merged.set(part,at);at+=part.length;}
    if(merged.length!==size)throw new Error('产出文件读取不完整，请稍后重试。');return merged;
  }
  async importOutputMaterials(task) {
    if(!task.sessionId||!this.outputsAvailable())return 0;
    const remote=this.ctx.remote.workspaceFiles;
    let listing;
    try {listing=remoteValue(remoteValue(await withTimeout(remote.list(task.sessionId,taskOutputDir(task)),15000,'读取产出目录超时')));} catch(error) {return 0;}
    let count=0;
    for(const entry of (listing&&listing.entries)||[]){
      if(!entry||entry.type!=='file'||!entry.name||/[\\/]/.test(entry.name)||entry.name==='.'||entry.name==='..')continue;
      if(entry.size!==undefined&&entry.size>MAX_FILE_BYTES)continue;
      try {
        const id=task.id+':'+OUTPUT_ORIGIN+':'+entry.name;
        if(this.repo.getSetting&&await this.repo.getSetting('materialDeleted:'+id))continue;
        this.outputChecks ||= new Map();const key=task.id+':'+task.sessionId+':'+entry.name,previous=this.outputChecks.get(key),stamp=entry.mtimeMs??entry.modifiedAt;
        const signature=JSON.stringify([entry.size,stamp]);if(previous?.signature===signature&&(stamp!==undefined||Date.now()-previous.at<30000))continue;
        const bytes=await this.readWorkspaceBytes(task.sessionId,taskOutputDir(task)+'/'+entry.name,entry.size);
        if(!bytes||!bytes.length)continue;
        const file=new File([bytes],entry.name,{type:guessMime(entry.name),lastModified:Date.now()});
        if(await this.repo.importOutput(task.id,file))count++;this.outputChecks.set(key,{signature,at:Date.now()});
      } catch(error) {if(typeof console!=='undefined')console.warn('工作台：读取 AI 产出失败',entry.name,error);}
    }
    return count;
  }
  forgetTasks(ids) {const gone=new Set(ids);for(const key of [...this.importedDrafts]){if(gone.has(key.split(':')[0]))this.importedDrafts.delete(key);}}
  async existingSessions() {
    await this.ctx.sessions.refresh();
    const state=this.ctx.sessions.list.getSnapshot();
    return state.ids.map(id=>state.byId[id]).filter(row=>row&&!row.parentId&&row.origin!=='subagent').sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  async link(task,sessionId) {
    if(!sessionId)throw new Error('请先选择一个会话。');
    const reference=this.ctx.sessions.retain(sessionId,{source:'shansha-workbench'});
    try {
      const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开会话超时，未修改关联。');
      if(binding.session.getSnapshot().openState==='error')throw new Error('这个会话无法打开，未修改关联。');
      const workspace=this.sessionWorkspace(sessionId);
      await this.repo.update(task.id,{sessionId,...workspace?{workspaceId:workspace.workspaceId}:{}});await this.pushWork(this.repo);
    } finally {reference.release();}
  }
  async session(task, forceNew=false) {
    const saved=this.repo.list?(await this.repo.list()).find(t=>t.id===task.id):task;
    if(!saved||saved.deletedAt)throw new Error('这条待办已删除。');
    let id=forceNew?'':saved.sessionId;
    if (!id) {
      id=await this.ctx.sessions.create(this.sessionOptions(task));
      await this.repo.update(task.id,{sessionId:id});
      const renamed=await this.ctx.remote.session.rename({sessionId:id,title:task.title});
      if (!renamed.ok) console.warn('工作台会话标题未更新',renamed.error.code);
    }
    return id;
  }
  async open(task) {
    const saved=this.repo.list?(await this.repo.list()).find(t=>t.id===task.id):task;
    if(!saved?.sessionId)throw new Error('这条待办尚未关联会话，请选择已有会话或开始协作。');
    await this.pushWork(this.repo);
    const reference=this.ctx.sessions.retain(saved.sessionId,{source:'shansha-workbench'});
    try{const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开关联会话超时。');if(binding.session.getSnapshot().openState==='error')throw new Error('关联会话无法打开，请检查原会话。');this.revealSession(saved.sessionId);}finally{reference.release();}
  }
  async prepare(task, materials, options={}) {
    if(this.busy.has(task.id)) throw new Error('正在准备这条待办，请稍候。');
    this.busy.add(task.id);
    let reference, drafts=[], input, id;
    try {
      id=await this.session(task,options.forceNew===true);await this.pushWork(this.repo).catch(error=>console.warn('待办状态暂未同步',error.message));
      reference=this.ctx.sessions.retain(id,{source:'shansha-workbench'});
      const binding=await withTimeout(reference.ready,BRIDGE_READY_TIMEOUT,'打开关联会话超时，请稍后重试。');
      if(binding.session.getSnapshot().openState==='error') throw new Error('关联会话无法打开，请先在 Harness 中检查。');
      const conversation=this.ctx.get('conversation');
      input=conversation.input.for(binding.ctx);
      if(['adjudicating','submitting'].includes(input.snapshot.phase)) throw new Error('会话正在提交消息，请稍后再准备。');
      const history=options.forceNew?[]:(task.handoffs||[]).filter(item=>!item.sessionId||item.sessionId===id);
      const handed=new Set(history.flatMap(item=>item.materialIds||[]));
      if(history.length&&materials.every(m=>handed.has(m.id))) {
        // 已交接的材料不重复附加，输入框保持用户原稿。
        await this.repo.update(task.id,{status:task.status==='done'?'done':'ready'});
        this.revealSession(id);
        return {duplicate:true};
      }
      const files=materials.filter(m=>!m.localOnly&&!handed.has(m.id)).map(m=>new File([m.blob],m.name,{type:m.type,lastModified:m.createdAt}));
      drafts=conversation.createDrafts(id,files);
      if(!input.actions.addAttachments(drafts.map(d=>d.id))) throw new Error('当前会话暂时不能接收附件。');
      await this.repo.update(task.id,{status:task.status==='done'?'done':'ready',handoffs:[...(task.handoffs||[]),{at:Date.now(),sessionId:id,materialIds:materials.map(m=>m.id)}]});
      this.revealSession(id);
      return {duplicate:false};
    } catch(error) {
      // Keep attachments already attached to a draft; the user can inspect/retry them.
      if(drafts.length && !input?.snapshot.attachmentIds.some(id=>drafts.some(d=>d.id===id))) this.ctx.get('conversation').releaseDraftAttachments(drafts);
      else if(drafts.length && id) this.revealSession(id);
      throw error;
    } finally {reference?.release();this.busy.delete(task.id);}
  }
}

