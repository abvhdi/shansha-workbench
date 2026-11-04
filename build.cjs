const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const sources = ['core.js', 'repository.js', 'bridge.js', 'backup.js', 'selection.js', 'notifications.js', 'browser-qr.js', 'database-source.js', 'database-group-ui.js', 'database-attachment-ui.js', 'database-grid.js', 'database-relation-ui.js', 'database-ui.js', 'database-capture-ui.js', 'database-panel.js', 'task-link-cards.js', 'ui.js', 'plugin.js'];
const code = sources.map(name => fs.readFileSync(path.join(root, 'src', name), 'utf8')).join('\n');
const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
const output = `window.__ModuleLoader__.load({id:"shansha-workbench",factory:(require)=>{\nconst React=require("react");\nconst h=React.createElement;\nconst module={exports:{}};const exports=module.exports;\nconst STYLES=${JSON.stringify(css)};\n${code}\nexports.apply=apply;exports.inject=inject;return module.exports;\n}});\n`;
fs.mkdirSync(path.join(root, 'lib'), {recursive:true});
fs.writeFileSync(path.join(root,'lib/client.js'),output);
fs.copyFileSync(path.join(root,'src/host.js'),path.join(root,'lib/index.js'));
fs.copyFileSync(path.join(root,'src/native-open-path.js'),path.join(root,'lib/native-open-path.js'));
for(const name of ['database.js','sqlite-store.js','coordinator.js','database-formulas.js','database-relations.js','database-attachments.js','database-groups.js'])fs.copyFileSync(path.join(root,'src',name),path.join(root,'lib',name));
fs.cpSync(path.join(root,'src/vendor'),path.join(root,'lib/vendor'),{recursive:true});
if(process.platform==='win32'){
  const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  if(fs.existsSync(compiler))require('node:child_process').execFileSync(compiler,['/nologo','/target:exe','/platform:anycpu','/codepage:65001','/reference:System.Windows.Forms.dll','/out:'+path.join(root,'lib/shansha-native-open.exe'),path.join(root,'src/native-open.cs')],{windowsHide:true});
}
console.log('Built shansha-workbench/lib/client.js');
