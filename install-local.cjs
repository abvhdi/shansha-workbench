const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const root=__dirname;
const profile=path.join(os.homedir(),'.dsh','profiles','desktop');
const manifestPath=path.join(profile,'package.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(!Array.isArray(manifest.dsh?.profile?.bundles)) throw new Error('不是可识别的 Harness desktop profile');
const dest=path.join(profile,'node_modules','shansha-workbench');
const backup=path.join(profile,'.shansha-backups',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(backup,{recursive:true});
fs.copyFileSync(manifestPath,path.join(backup,'package.json'));
if(fs.existsSync(dest)) fs.cpSync(dest,path.join(backup,'previous-plugin'),{recursive:true});
fs.mkdirSync(dest,{recursive:true});
for(const name of ['package.json','cordis.patch.yml','lib','README.md']) {
  const source=path.join(root,name);
  if(fs.existsSync(source))fs.cpSync(source,path.join(dest,name),{recursive:true});
}
manifest.dependencies ||= {};
manifest.dependencies['shansha-workbench']='file:'+root.replace(/\\/g,'/');
if(!manifest.dsh.profile.bundles.includes('shansha-workbench'))manifest.dsh.profile.bundles.push('shansha-workbench');
const temp=manifestPath+'.shansha.tmp';
fs.writeFileSync(temp,JSON.stringify(manifest,null,2)+'\n');
fs.renameSync(temp,manifestPath);
console.log('Registered: '+dest);
console.log('Configuration backup: '+backup);
