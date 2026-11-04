const DATABASE_PANEL_KIND='shansha-database';
const DATABASE_PANEL_ID='shansha-workbench/database';
function DatabaseSidePanel({model,useTabInfo}){
 const info=useTabInfo?.(),state=React.useSyncExternalStore(model.subscribe,model.snapshot,model.snapshot);
 if(info&&!info.tab.visible)return null;
 return h('section',{className:'swb swb-db-sidepanel','aria-label':'会话旁的数据库'},state.error&&state.message&&h('div',{className:'swb-notice','data-error':true,role:'alert'},state.message),h(DatabaseView,{model,sidePanel:true}));
}
function installDatabasePanel(ctx,model){
 const sidebar=ctx.get('sidebarRight'),tabs=ctx.get('sidebarRightTabs');
 if(!sidebar?.openTab||!tabs?.register)return;
 ctx.effect(()=>tabs.register({id:DATABASE_PANEL_ID,kind:DATABASE_PANEL_KIND,title:()=> '数据库',keepMounted:false}));
 ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:DATABASE_PANEL_ID,inject:()=>({model})},DatabaseSidePanel)));
 ctx.effect(()=>{
  let disposed=false;
  const open=async sessionId=>{
   const deadline=Date.now()+8000;
   for(;;){
    if(disposed)throw Error('数据库侧栏已关闭');
    const selected=ctx.get('uiWorkspace')?.selection?.getSnapshot()?.sessionId;
    if(selected&&selected!==sessionId)throw Error('你已切换会话，已停止打开数据库侧栏');
    if(sidebar.mounted?.getSnapshot()===sessionId){
     // The mounted id arrives before React adopts the docking surface.
     const existing=sidebar.tabsIn?.(sessionId)?.find(tab=>tab.kind===DATABASE_PANEL_KIND);
     try{
      if(existing){sidebar.focus(existing.id);if(!sidebar.isExpanded())sidebar.toggleExpanded();}
      else sidebar.openTab(DATABASE_PANEL_KIND);
      return;
     }catch(error){
      if(!/not.*(?:mounted|adopted)|no.*(?:surface|session)|not.*screen|尚未|未挂载/i.test(error.message))throw error;
     }
    }
    if(Date.now()>=deadline)throw Error('数据库右侧面板尚未就绪，请重新点击与数据对话');
    await new Promise(resolve=>setTimeout(resolve,50));
   }
  };
  model.bridge.openDatabasePanel=open;
  return ()=>{disposed=true;if(model.bridge.openDatabasePanel===open)delete model.bridge.openDatabasePanel;};
 });
}
