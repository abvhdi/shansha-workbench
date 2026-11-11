import {templateRuleIssues} from './template-rule-validation.js';
import {inflateRawSync} from 'node:zlib';
// Read only bounded Office XML entries; never extract archive paths to disk.
export function officeXml(bytes,accept){
 if(bytes.length>20*1024*1024)throw Error('模板最多20 MB');
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('文件不是有效的 Office 文档');const count=bytes.readUInt16LE(end+10);let pos=bytes.readUInt32LE(end+16),total=0;const result=[];
 if(count>10000)throw Error('文档结构过大，请简化模板');
 for(let n=0;n<count;n++){if(pos+46>bytes.length||bytes.readUInt32LE(pos)!==0x02014b50)throw Error('文档结构损坏');const method=bytes.readUInt16LE(pos+10),flags=bytes.readUInt16LE(pos+8),size=bytes.readUInt32LE(pos+20),rawSize=bytes.readUInt32LE(pos+24),nameLen=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42),name=bytes.subarray(pos+46,pos+46+nameLen).toString('utf8');pos+=46+nameLen+extra+comment;
 if(!accept(name))continue;total+=rawSize;if(total>32*1024*1024||flags&1)throw Error('文档过大或已加密，无法识别填写项');if(offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)throw Error('文档结构损坏');const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);if(start+size>bytes.length)throw Error('文档结构损坏');const compressed=bytes.subarray(start,start+size),raw=method===0?compressed:method===8?inflateRawSync(compressed,{maxOutputLength:32*1024*1024}):null;if(!raw||raw.length!==rawSize)throw Error('文档压缩格式不支持');result.push({name,text:raw.toString('utf8')});}
 return result;
}
const decode=s=>s.replace(/&#x([a-f\d]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,num,key)=>hex||num?String.fromCodePoint(parseInt(hex||num,hex?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key]));
export async function scanTemplateFields(bytes,extension){
 const found=new Map();const collect=(text,location)=>{for(const m of text.matchAll(/\{\{\s*([^{}\r\n]{1,80}?)\s*\}\}/g)){const name=m[1].trim();if(!name)continue;if(!found.has(name))found.set(name,{name,token:'{{'+name+'}}',locations:[]});const f=found.get(name);if(!f.locations.includes(location)&&f.locations.length<30)f.locations.push(location);if(found.size>100)throw Error('填写项最多100项');}};
 if(extension==='.docx'){
  for(const part of officeXml(bytes,n=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(n))){let index=0;for(const paragraph of part.text.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)){index++;const text=[...paragraph[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>decode(m[1])).join('');collect(text,(part.name==='word/document.xml'?'正文（含表格）':/header/.test(part.name)?'页眉':'页脚')+' 第'+index+'段');}}
 }else if(extension==='.xlsx'){
  officeXml(bytes,n=>/\.xml$/.test(n));const XLSX=await import('./vendor/xlsx.mjs');const book=XLSX.read(bytes,{type:'buffer',cellFormula:false,cellHTML:false,bookVBA:false});let cells=0;for(const name of book.SheetNames){const sheet=book.Sheets[name];for(const [cell,value] of Object.entries(sheet)){if(cell.startsWith('!'))continue;if(++cells>200000)throw Error('模板单元格过多，请简化后重试');if(typeof value.v==='string')collect(value.v,name+'!'+cell);}}
 }else throw Error('填写项配置目前支持 .docx 和 .xlsx，请先另存为这两种格式');
 return [...found.values()];
}
function checkRuleFields(fields){const issues=templateRuleIssues(fields),index=Object.keys(issues)[0];if(index!==undefined)throw Error('第'+(Number(index)+1)+'项「'+(fields[index]?.name||'未命名')+'」：'+issues[index].message);}
export function validateTemplateRules(input,scan){
 if(!Array.isArray(input)||!input.length||input.length!==scan.length)throw Error('请为识别到的每个占位符设置填写规则');checkRuleFields(input);const names=new Set(),allowed=new Map(scan.map(f=>[f.name,f]));
 const fields=input.map(f=>{if(!allowed.has(f.name)||names.has(f.name))throw Error('填写项名称重复或不在模板中');names.add(f.name);if(!['text','number','date','multiline','details'].includes(f.kind)||!['manual','database','task','fixed'].includes(f.source))throw Error('填写类型或来源无效');const hint=String(f.hint||'').trim(),value=f.source==='fixed'?String(f.value??''):'';if(hint.length>500||value.length>2000)throw Error('填写说明过长');if(f.source==='fixed'&&f.kind==='number'&&!Number.isFinite(Number(value)))throw Error('固定数字内容无效');if(f.source==='fixed'&&f.kind==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('固定日期请使用年-月-日格式');return {...allowed.get(f.name),kind:f.kind,source:f.source,hint,value,required:f.required!==false};});
 if(fields.filter(f=>f.kind==='details').length>1)throw Error('第一版只支持一个产品明细区域');return fields;
}

export async function templateLayout(bytes,extension){
 const anchors=[],sheets=[];let truncated=false;
 const add=(id,location,text,extra={})=>{if(anchors.length>=1000||text.length>2000){truncated=true;return;}anchors.push({id,location,text,...extra});};
 if(extension==='.docx'){
  for(const part of officeXml(bytes,n=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(n))){let p=0,table=0,row=0,cell=0,inTable=false;const tokens=part.text.matchAll(/<w:tbl(?:\s[^>]*)?>|<\/w:tbl>|<w:tr(?:\s[^>]*)?>|<w:tc(?:\s[^>]*)?>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);for(const token of tokens){const xml=token[0];if(/^<w:tbl[\s>]/.test(xml)){table++;row=0;inTable=true;}else if(xml==='</w:tbl>'){inTable=false;}else if(/^<w:tr[\s>]/.test(xml)){row++;cell=0;}else if(/^<w:tc[\s>]/.test(xml)){cell++;}else{p++;const text=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)].map(m=>m[1]!==undefined?decode(m[1]):' ').join('');const zone=part.name==='word/document.xml'?'正文':/header/.test(part.name)?'页眉':'页脚';add(part.name+':p'+p,zone+(inTable?' 表'+table+' 第'+row+'行第'+cell+'列':'')+' 第'+p+'段',text,{part:part.name,paragraph:p,table:inTable?table:null,row:inTable?row:null,column:inTable?cell:null});}}}
 }else if(extension==='.xlsx'){
  officeXml(bytes,n=>/\.xml$/.test(n));const X=await import('./vendor/xlsx.mjs'),book=X.read(bytes,{type:'buffer',cellFormula:true,cellHTML:false});for(let si=0;si<book.SheetNames.length;si++){const name=book.SheetNames[si],sheet=book.Sheets[name];if(!sheet['!ref'])continue;const range=X.utils.decode_range(sheet['!ref']),maxRow=Math.min(range.e.r+2,200),maxCol=Math.min(range.e.c+2,40),preview={name,startRow:range.s.r,startCol:range.s.c,endRow:maxRow,endCol:maxCol,cells:[]};sheets.push(preview);if(range.e.r>=200||range.e.c>=40)truncated=true;for(let r=range.s.r;r<=maxRow;r++)for(let c=range.s.c;c<=maxCol;c++){if(preview.cells.length>=1000){truncated=true;continue;}const cell=X.utils.encode_cell({r,c}),v=sheet[cell],merge=(sheet['!merges']||[]).find(m=>r>=m.s.r&&r<=m.e.r&&c>=m.s.c&&c<=m.e.c);if(merge&&(r!==merge.s.r||c!==merge.s.c))continue;const id='sheet'+si+':'+cell;preview.cells.push({cell,row:r,column:c,text:String(v?.w??v?.v??(v?.f?'（自动计算）':'')),rowSpan:merge?Math.min(merge.e.r,maxRow)-r+1:1,colSpan:merge?Math.min(merge.e.c,maxCol)-c+1:1,anchorId:v?.f?null:id});if(v?.f)continue;add(id,name+'!'+cell,String(v?.v??''),{sheet:name,cell});}}
 }else throw Error('AI识别目前支持 .docx 和 .xlsx');
 for(let i=0;i<anchors.length;i++){anchors[i].nearby=[anchors[i-1],anchors[i+1]].filter(Boolean).map(a=>a.location+'：'+a.text).join('；').slice(0,500);}
 return {anchors,truncated,preview:{kind:extension==='.xlsx'?'sheets':'document',sheets}};
}
export function validateMappedRules(input,layout){
 if(!Array.isArray(input)||!input.length||input.length>100)throw Error('请保留1至100个填写项');checkRuleFields(input);const names=new Set(),targets=[];
 const reserve=(id,start,end)=>{if(targets.some(t=>t.id===id&&(t.start===start||start<t.end&&end>t.start)))throw Error('两个填写项的位置重叠，请核对');targets.push({id,start,end});};
 const fields=input.map(f=>{const name=String(f.name||'').trim();if(!name||name.length>80||names.has(name))throw Error('填写项名称不能为空或重复');names.add(name);
 if(!f.anchorId&&f.token){const tokenName=String(f.token).replace(/^\{\{\s*|\s*\}\}$/g,'').trim(),locations=[];for(const a of layout.anchors)for(const m of a.text.matchAll(/\{\{\s*([^{}\r\n]{1,80}?)\s*\}\}/g))if(m[1].trim()===tokenName){reserve(a.id,m.index,m.index+m[0].length);locations.push(a.location);}if(!locations.length)throw Error(name+'的占位符已不存在');return validateTemplateRules([{...f,name}],[{name,token:'{{'+tokenName+'}}',locations}])[0];}
 const anchor=layout.anchors.find(a=>a.id===f.anchorId);if(!anchor)throw Error(name+'的位置不存在，请重新选择');const match=String(f.match??'');let start,end;
 if(f.offsetStart!==undefined||f.offsetEnd!==undefined){start=f.offsetStart;end=f.offsetEnd;if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>anchor.text.length||anchor.text.slice(start,end)!==match)throw Error(name+'的文字位置已变化，请重新选择');}
 else {if(match.length>2000||match&&(!anchor.text.includes(match)||anchor.text.indexOf(match)!==anchor.text.lastIndexOf(match)))throw Error(name+'的替换文字不明确，请核对原文');start=match?anchor.text.indexOf(match):anchor.text.length;end=start+match.length;}
 reserve(anchor.id,start,end);const normalized=validateTemplateRules([{...f,name}],[{name,locations:[anchor.location]}])[0];return {...normalized,anchorId:anchor.id,match,offsetStart:start,offsetEnd:end,anchorText:anchor.text,target:Object.fromEntries(Object.entries({sheet:anchor.sheet,cell:anchor.cell,part:anchor.part,paragraph:anchor.paragraph,start,end}).filter(([,value])=>value!==undefined)),position:match?'replace':!anchor.text?'fill':start===anchor.text.length?'append':'insert'};});
 if(fields.filter(f=>f.kind==='details').length>1)throw Error('第一版只支持一个产品明细区域');return fields;
}
export function templateSuggestions(result,layout){
 if(!result||!Array.isArray(result.fields)||result.fields.length>100)throw Error('识别结果格式不正确，请重试');
 if(!result.fields.length)return [];
 return validateMappedRules(result.fields.map(f=>({...f,required:f.required!==false,value:'',source:['manual','database','task'].includes(f.source)?f.source:'manual'})),layout).map(f=>({...f,uncertain:true}));
}
