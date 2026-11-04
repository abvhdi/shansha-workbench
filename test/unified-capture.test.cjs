const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('record capture saves dated text verbatim without creating a task, and failure retains text',async()=>{
 let hooks=[],index=0,fail=false,requests=[],created=[];
 const React={memo:f=>f,useState:initial=>{const n=index++;if(!(n in hooks))hooks[n]=typeof initial==='function'?initial():initial;return [hooks[n],value=>hooks[n]=typeof value==='function'?value(hooks[n]):value]},useRef:()=>({current:null})};
 const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat(Infinity)}),context=vm.createContext({React,h,crypto:require('node:crypto')});
 vm.runInContext(['core','ui'].map(name=>fs.readFileSync(path.join(__dirname,'../src/'+name+'.js'),'utf8')).join('\n')+';globalThis.Quick=QuickTaskCreate;',context);
 const model={repo:{add:async()=>{throw Error('record must not create task')}},bridge:{nativeCall:async(method,args)=>{requests.push({method,request:args.request});if(fail)throw Error('保存失败');return {id:'a.md'}}}};
 const render=()=>{index=0;return context.Quick({model,initialKind:'record',onCreated:kind=>created.push(kind)})},find=(n,p)=>n&&typeof n==='object'?(p(n)?n:n.children?.map(child=>find(child,p)).find(Boolean)):undefined;
 let tree=render();const text='周四记得核对：客户不收纸质合同\n电话联系';find(tree,n=>n.props['aria-label']==='记下内容').props.onChange({target:{value:text}});tree=render();await find(tree,n=>n.tag==='form').props.onSubmit({preventDefault(){}});assert.equal(requests.length,1);assert.equal(requests[0].method,'shanshaFiles/knowledgeSave');assert.equal(requests[0].request.body,text);assert.deepEqual(created,['record']);assert.equal(find(render(),n=>n.props['aria-label']==='记下内容').props.value,'');
 fail=true;tree=render();find(tree,n=>n.props['aria-label']==='记下内容').props.onChange({target:{value:'保留这个草稿'}});tree=render();await find(tree,n=>n.tag==='form').props.onSubmit({preventDefault(){}});tree=render();assert.equal(find(tree,n=>n.props.role==='alert').children[0],'保存失败');assert.equal(find(tree,n=>n.props['aria-label']==='记下内容').props.value,'保留这个草稿');
 find(tree,n=>n.tag==='button'&&n.children.includes('待办')).props.onClick();tree=render();assert.equal(find(tree,n=>n.props['aria-label']==='新待办标题').props.value,'保留这个草稿');
});
