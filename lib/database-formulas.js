// A small arithmetic grammar, never JavaScript or SQL evaluation.
const formulaCache=new Map();
export function parseFormula(expression){
 if(typeof expression!=='string'||!expression.trim()||expression.length>500)throw Error('公式请输入1到500字，如 [数量] * [单价]');
 if(formulaCache.has(expression))return formulaCache.get(expression);
 let at=0,nodes=0;const refs=new Set(),space=()=>{while(/\s/.test(expression[at]||'')&&at<expression.length)at++;};
 function atom(depth){if(depth>25||++nodes>150)throw Error('公式过于复杂');space();const c=expression[at];if(c==='+'||c==='-'){at++;return {op:'unary',sign:c,value:atom(depth+1)};}if(c==='('){at++;const value=sum(depth+1);space();if(expression[at++]!==')')throw Error('公式括号不完整');return value;}if(c==='['){const end=expression.indexOf(']',at+1);if(end<0)throw Error('字段引用请写成 [列名]');const name=expression.slice(at+1,end);if(!name)throw Error('字段名不能为空');refs.add(name);at=end+1;return {op:'field',name};}const m=expression.slice(at).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);if(m){at+=m[0].length;const value=Number(m[0]);if(!Number.isFinite(value))throw Error('数字超出范围');return {op:'number',value};}throw Error('公式只支持 [列名]、数字、括号及加减乘除');}
 function product(d){let left=atom(d);for(;;){space();const op=expression[at];if(op!=='*'&&op!=='/')return left;at++;left={op,left,right:atom(d)};}}
 function sum(d){let left=product(d);for(;;){space();const op=expression[at];if(op!=='+'&&op!=='-')return left;at++;left={op,left,right:product(d)};}}
 const tree=sum(0);space();if(at!==expression.length)throw Error('公式包含不支持的内容');const parsed={tree,refs:[...refs]};if(formulaCache.size>=200)formulaCache.delete(formulaCache.keys().next().value);formulaCache.set(expression,parsed);return parsed;
}
export function validateFormulas(formulas,columns){
 if(!formulas||typeof formulas!=='object'||Array.isArray(formulas))throw Error('计算列请使用 列名:公式 的对象');
 for(const [name,expression] of Object.entries(formulas)){if(!columns.includes(name))throw Error('计算列不在表格中：'+name);const parsed=parseFormula(expression);for(const ref of parsed.refs){if(!columns.includes(ref))throw Error('公式引用了不存在的列：'+ref);if(Object.hasOwn(formulas,ref))throw Error('第一版计算列只能引用普通列，不能引用自身或其他计算列');}}
 return formulas;
}
export function calculateCells(cells,formulas={}){
 const result={...cells};
 const number=value=>{if(value==null||value==='')throw Error('#EMPTY!');if(typeof value==='boolean'||!['number','string'].includes(typeof value)||typeof value==='string'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))throw Error('#VALUE!');const n=Number(value);if(!Number.isFinite(n))throw Error('#VALUE!');return n;};
 const evalNode=node=>{if(node.op==='number')return node.value;if(node.op==='field')return number(cells[node.name]);if(node.op==='unary')return (node.sign==='-'?-1:1)*evalNode(node.value);const a=evalNode(node.left),b=evalNode(node.right);if(node.op==='/'&&b===0)throw Error('#DIV/0!');const n=node.op==='+'?a+b:node.op==='-'?a-b:node.op==='*'?a*b:a/b;if(!Number.isFinite(n))throw Error('#NUM!');return n;};
 for(const [name,expression] of Object.entries(formulas)){try{Object.defineProperty(result,name,{value:Number(evalNode(parseFormula(expression).tree).toPrecision(12)),enumerable:true,configurable:true,writable:true});}catch(error){Object.defineProperty(result,name,{value:error.message==='#EMPTY!'?'':/^#/.test(error.message)?error.message:'#FORMULA!',enumerable:true,configurable:true,writable:true});}}
 return result;
}
