export function templateRuleIssues(fields){
 const issues={},names=new Map(),details=[];
 const put=(index,control,message)=>{if(!issues[index])issues[index]={control,message};};
 (fields||[]).forEach((f,index)=>{const name=typeof f?.name==='string'?f.name.trim():'';
 if(!name||name.length>80)put(index,'name','请填写不超过80字的名称');
 else if(names.has(name)){const other=names.get(name);put(index,'name','名称与第'+(other+1)+'项重复，请修改名称');put(other,'name','名称与第'+(index+1)+'项重复，请修改名称');}else names.set(name,index);
 if(!['text','number','date','multiline','details'].includes(f?.kind))put(index,'kind','请选择填写类型');
 if(!['manual','database','task','fixed'].includes(f?.source))put(index,'source','请选择取值来源');
 if(f?.kind==='details')details.push(index);
 if(f?.source==='fixed'){
  const value=String(f.value??'');
  if(f.kind==='details')put(index,'source','产品明细不能使用固定内容，请更换来源');
  else if(!value.trim())put(index,'value','请填写固定值');
  else if(value.length>2000)put(index,'value','固定值不能超过2000字');
  else if(f.kind==='number'&&!Number.isFinite(Number(value)))put(index,'value','固定值需要填写有效数字');
  else if(f.kind==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value))put(index,'value','固定日期请使用年-月-日格式，例如 2026-11-11');
 }
 if(String(f?.hint||'').trim().length>500)put(index,'hint','取值说明不能超过500字');
 });
 if(details.length>1)for(const index of details)put(index,'kind','只能保留一个产品明细区域，请修改其他明细项的类型');
 return issues;
}
