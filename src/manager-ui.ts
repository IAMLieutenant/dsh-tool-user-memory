/** Compact local manager. Memory content is rendered as text, never HTML. */
export const MANAGER_HTML = String.raw`<!doctype html>
<html lang="zh-CN" data-theme="__THEME__">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH 记忆管理</title>
<style nonce="__NONCE__">
:root{color-scheme:light;--memory-bg:#fff;--memory-surface:#f5f5f6;--memory-text:#1c1c1f;--memory-muted:#777780;--memory-border:#0000001a;--memory-hover:#2631480f;--memory-font:system-ui,"Microsoft YaHei",sans-serif}
:root[data-theme=dark]{color-scheme:dark;--memory-bg:#212123;--memory-surface:#303033;--memory-text:#f3f3f5;--memory-muted:#a6a6ad;--memory-border:#ffffff1f;--memory-hover:#ffffff14}
*{box-sizing:border-box}body{margin:0;background:var(--memory-bg);color:var(--memory-text);font:14px/1.6 var(--memory-font)}main{max-width:760px;margin:auto;padding:24px}.embedded main{padding:18px 24px}.embedded main>header{display:none}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;font-weight:600;margin:0 0 12px}p{margin:8px 0;color:var(--memory-muted)}button,input,select,textarea{font:inherit;color:inherit}button{border:1px solid var(--memory-border);background:transparent;border-radius:12px;padding:7px 13px;cursor:pointer;white-space:nowrap}button:hover{background:var(--memory-hover)}button:disabled{opacity:.4;cursor:default}button.primary{background:var(--memory-text);border-color:var(--memory-text);color:var(--memory-bg)}button.primary:hover{opacity:.88}button.quiet{border-color:transparent;padding:5px 10px}input,select,textarea{border:1px solid var(--memory-border);border-radius:10px;background:var(--memory-bg);padding:8px 10px;max-width:100%;min-width:0}input[type=text],textarea{width:100%}textarea{min-height:130px;resize:vertical}input:focus,textarea:focus,select:focus,button:focus-visible{outline:2px solid var(--memory-muted);outline-offset:2px}header{margin-bottom:20px}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tabs{gap:4px;border-bottom:1px solid var(--memory-border);margin-bottom:18px;padding-bottom:10px}.tabs button{border:0;border-radius:10px;padding:7px 16px;color:var(--memory-muted)}.tabs button[aria-selected=true]{background:var(--memory-surface);color:var(--memory-text);font-weight:600}#notice:empty{display:none}#notice{font-size:13px;margin:0 0 14px;overflow-wrap:anywhere}#notice.error,#editorError{color:var(--memory-text)}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;background:var(--memory-surface);border-radius:14px;padding:18px 20px}.stats strong{display:block;font-size:24px;font-weight:600;line-height:1.4}.stats span{font-size:12px;color:var(--memory-muted)}.capacity{margin:22px 0}.capacity .row{justify-content:space-between;font-size:13px;color:var(--memory-muted)}progress{width:100%;height:5px;border:0;border-radius:8px;accent-color:var(--memory-muted)}progress::-webkit-progress-bar{background:var(--memory-surface);border-radius:8px}progress::-webkit-progress-value{background:var(--memory-muted);border-radius:8px}.hint{font-size:12px}.toolbar{gap:8px;margin-bottom:8px}.toolbar select{width:170px}.toolbar input{flex:1;width:auto;min-width:100px}.memory-row{border-bottom:1px solid var(--memory-border);padding:14px 0;display:flex;align-items:center;gap:14px}.memory-info{flex:1;min-width:0}.memory-title{font-weight:500;overflow-wrap:anywhere}.memory-preview{margin:4px 0 0;font-size:13px;color:var(--memory-muted);overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere;white-space:pre-wrap}.memory-row .row{gap:2px;flex-wrap:nowrap}.badge{font-size:11px;background:var(--memory-surface);color:var(--memory-muted);border-radius:6px;padding:2px 6px;margin-left:8px}.empty{padding:24px 0;text-align:center}.section{padding:0 0 20px;margin-bottom:20px;border-bottom:1px solid var(--memory-border)}.section:last-child{border-bottom:0;margin-bottom:0}label{display:block;margin:12px 0 5px;font-size:13px}input[type=file]{width:100%;font-size:13px}input[type=file]::file-selector-button{font:inherit;background:var(--memory-surface);color:var(--memory-text);border:0;border-radius:8px;padding:7px 12px;margin-right:10px;cursor:pointer}.mapping{margin:14px 0}.mapping label{overflow-wrap:anywhere}.mapping small{display:block;color:var(--memory-muted);font-size:12px}pre{background:var(--memory-surface);border-radius:12px;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.65 var(--memory-font)}dialog{width:min(520px,94vw);max-height:88vh;overflow:auto;background:var(--memory-bg);color:var(--memory-text);border:1px solid var(--memory-border);border-radius:16px;padding:22px;font:inherit;box-shadow:0 12px 40px #00000020}dialog::backdrop{background:#00000035}.actions{justify-content:flex-end;margin-top:18px}.view-body{white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto;margin:16px 0}.view-meta{font-size:12px}.pin-option{display:flex;align-items:center;gap:8px;margin:12px 0 0}.pin-option input{width:16px;height:16px;accent-color:var(--memory-text)}#deleteEntry{margin-right:auto}#editorError:empty{display:none}[hidden]{display:none!important}@media(max-width:540px){main,.embedded main{padding:16px}.toolbar{flex-wrap:wrap}.toolbar select{width:calc(100% - 104px)}.toolbar input{order:3;flex-basis:100%}.stats{padding:14px;gap:8px}.stats strong{font-size:21px}.memory-row{gap:4px}.memory-row .row{flex-direction:column;gap:0}.mapping input{width:100%}}
</style></head><body class="__BODY_CLASS__"><main>
<header><h1>记忆管理</h1><p>查看、编辑和迁移记忆。</p></header>
<nav class="row tabs" aria-label="记忆管理"><button data-tab="overview" aria-selected="true">概览</button><button data-tab="memories" aria-selected="false">记忆</button><button data-tab="migration" aria-selected="false">迁移</button></nav>
<div id="notice" role="status" aria-live="polite"></div>
<section id="overview"><div class="stats"><div><strong id="profileCount">—</strong><span>用户记忆</span></div><div><strong id="projectCount">—</strong><span>项目</span></div><div><strong id="topicCount">—</strong><span>项目记忆</span></div></div><div class="capacity"><div class="row"><span>用户记忆容量</span><span id="capacityText">—</span></div><progress id="capacity" aria-label="用户记忆容量" value="0" max="1"></progress></div><p>记忆保存在本机，可在“记忆”中查看和编辑。</p><p class="hint">换电脑时，在“迁移”中导出或导入。统计包含已失效的记忆。</p></section>
<section id="memories" hidden><div class="row toolbar"><select id="scope" aria-label="记忆范围"><option value="">用户记忆</option></select><input id="search" type="text" placeholder="搜索记忆" aria-label="搜索记忆"><button id="add">新增记忆</button></div><div id="list"></div></section>
<section id="migration" hidden><div class="section"><h2>导出到另一台电脑</h2><p class="hint">生成文件后，复制到新电脑导入。</p><button id="export">导出记忆</button></div><div class="section"><h2>导入另一台电脑的记忆</h2><input id="importFile" type="file" accept=".json,application/json" aria-label="选择记忆导出文件"><p class="hint" id="importInfo">选择旧电脑导出的 JSON 文件。同名记忆保留本机内容。</p><div id="mappings"></div><div class="row"><button id="previewImport" disabled>预览导入</button><button id="applyImport" class="primary" disabled>确认导入</button></div><pre id="importPreview" hidden></pre><button id="rollbackImport" hidden>撤销本次导入</button></div><p class="hint">导出包含用户与项目记忆，不包含修改历史和归档。</p></section>
</main>
<dialog id="viewer" aria-labelledby="viewerTitle"><h2 id="viewerTitle"></h2><p class="view-meta" id="viewMeta"></p><div class="view-body" id="viewBody"></div><div class="row actions"><button type="button" id="closeViewer">关闭</button><button type="button" id="editViewed" class="primary">编辑记忆</button></div></dialog>
<dialog id="editor" aria-labelledby="editorTitle"><h2 id="editorTitle">编辑记忆</h2><label for="entryKey">名称</label><input id="entryKey" type="text" maxlength="64"><label for="entryValue">内容</label><textarea id="entryValue"></textarea><label id="pinOption" class="pin-option"><input id="entryPinned" type="checkbox">置顶记忆</label><p class="hint" id="editScope"></p><p id="editorError" role="alert"></p><div class="row actions"><button type="button" id="deleteEntry" class="quiet" hidden>删除记忆</button><button type="button" id="cancelEditor">取消</button><button type="button" id="saveEntry" class="primary">保存</button></div></dialog>
<dialog id="confirmation" aria-labelledby="confirmationTitle"><h2 id="confirmationTitle">确认导入</h2><p id="confirmationText"></p><div class="row actions"><button type="button" id="cancelConfirmation">取消</button><button type="button" id="acceptConfirmation" class="primary">确认</button></div></dialog>
<script nonce="__NONCE__">
'use strict';
const TOKEN='__TOKEN__', API='/_dsh/user-memory/api';
const $=id=>document.getElementById(id);
let state, selected=null, viewed=null, editorScope=null, uploadDoc='', preview=null, lastBackup='', busy=false;
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function notice(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'';}
function projectName(path){return path.split(/[\\/]/).filter(Boolean).pop()||'项目';}
function size(bytes){return (bytes/1024).toFixed(1)+' KB';}
function scope(){return $('scope').value?{scope:'workspace',projectId:$('scope').value}:{scope:'global'};}
async function api(action,values={}){
 let r,j;try{r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','X-User-Memory-Token':TOKEN},body:JSON.stringify({action,...values})});j=await r.json();}
 catch{throw new Error('无法确认操作结果。请检查 DSH 是否仍在运行，重新打开管理窗口核对记忆，再决定是否重试。');}
 if(!j.ok){if(j.code==='PREVIEW_CHANGED')invalidatePreview();throw new Error(j.error||'操作未完成，请重新打开管理窗口后重试。');}return j.result;
}
async function run(job){
 if(busy)return;busy=true;
 const controls=[...document.querySelectorAll('button,select,input[type=file],input[type=checkbox]')];const disabled=controls.map(b=>b.disabled);controls.forEach(b=>b.disabled=true);
 try{await job();}catch(e){if($('editor').open)$('editorError').textContent=e.message;else notice(e.message,true);}
 finally{controls.forEach((b,i)=>{if(b.isConnected)b.disabled=disabled[i];});busy=false;syncImport();}
}
function ask(message,title='确认导入',acceptText='确认'){return new Promise(resolve=>{
 const d=$('confirmation');$('confirmationTitle').textContent=title;$('confirmationText').textContent=message;$('acceptConfirmation').textContent=acceptText;d.returnValue='';
 const accept=$('acceptConfirmation'),cancel=$('cancelConfirmation');accept.disabled=false;cancel.disabled=false;
 d.onclose=()=>resolve(d.returnValue==='accept');accept.onclick=()=>d.close('accept');cancel.onclick=()=>d.close('cancel');d.showModal();
});}
function render(){
 $('profileCount').textContent=String(state.stats.profileEntries);$('projectCount').textContent=String(state.projects.length);$('topicCount').textContent=String(state.stats.projectTopics);
 $('capacityText').textContent=size(state.stats.activeBytes)+' / '+size(state.stats.maxBytes);$('capacity').max=state.stats.maxBytes;$('capacity').value=state.stats.activeBytes;
 const q=$('search').value.toLowerCase();const entries=state.entries.filter(e=>(e.key+' '+e.value).toLowerCase().includes(q)).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));$('list').replaceChildren();
 if(!entries.length)$('list').append(node('p',q?'没有匹配的记忆。':'还没有记忆，可新增一条。','empty'));
 for(const e of entries){
  const row=node('article',undefined,'memory-row'),info=node('div',undefined,'memory-info'),title=node('div',e.key,'memory-title');
  if(e.pinned)title.append(node('span','置顶','badge'));
  if(e.invalidatedAt)title.append(node('span','已失效','badge'));
  info.append(title,node('p',e.value,'memory-preview'));
  const actions=node('div',undefined,'row'),view=node('button','查看','quiet'),edit=node('button','编辑','quiet');
  view.setAttribute('aria-label','查看 '+e.key);edit.setAttribute('aria-label','编辑 '+e.key);
  view.onclick=()=>openViewer(e);edit.onclick=()=>openEditor(e);actions.append(view,edit);row.append(info,actions);$('list').append(row);
 }
}
async function refresh(){
 const id=$('scope').value;state=await api('snapshot',{projectId:id});const sel=$('scope');sel.replaceChildren(new Option('用户记忆',''));
 for(const p of state.projects){const option=new Option(projectName(p.sourcePath)||p.id,p.id);option.title=p.sourcePath;sel.add(option);}sel.value=id;render();
}
function openViewer(e){
 viewed=e;$('viewerTitle').textContent=e.key;$('viewBody').textContent=e.value;
 const date=e.updatedAt?new Date(e.updatedAt):null;
 $('viewMeta').textContent=(e.pinned?'置顶 · ':'')+(e.invalidatedAt?'已失效'+(e.invalidReason?' · '+e.invalidReason:''):'有效')+(date&&!Number.isNaN(date.getTime())?' · 更新于 '+date.toLocaleDateString('zh-CN'):'');
 $('viewer').showModal();
}
function openEditor(e){
 selected=e;editorScope=scope();$('editorTitle').textContent=e?'编辑记忆':'新增记忆';$('entryKey').value=e?.key||'';$('entryKey').readOnly=!!e;$('entryValue').value=e?.value||'';$('editorError').textContent='';
 $('deleteEntry').hidden=!e;$('pinOption').hidden=editorScope.scope!=='global';$('entryPinned').checked=!!e?.pinned;
 $('editScope').textContent=(editorScope.scope==='global'?'保存到用户记忆':'保存到当前项目')+(e?.invalidatedAt?'；修改内容后重新启用，仅置顶保留失效状态。':'。')+(editorScope.scope==='global'?' 置顶优先保留，模型读取仍受长度限制。':'');$('editor').showModal();
}
$('cancelEditor').onclick=()=>$('editor').close();
$('closeViewer').onclick=()=>$('viewer').close();
$('editViewed').onclick=()=>{$('viewer').close();openEditor(viewed);};
$('saveEntry').onclick=()=>run(async()=>{
 $('editorError').textContent='';const key=$('entryKey').value.trim(),value=$('entryValue').value;if(!key||!value.trim())throw new Error('请填写名称和内容');
 const target={...editorScope};const revision=selected?.revision||(target.scope==='global'?state.revision:(await api('history',{...target,key})).revision);
 const pin=target.scope==='global'?{pinned:$('entryPinned').checked}:{};
 const onlyPin=selected&&target.scope==='global'&&value===selected.value&&pin.pinned!==!!selected.pinned;
 const result=onlyPin?await api('set-pinned',{...target,key,revision,...pin}):await api('update',{...target,key,value,mode:'set',createOnly:!selected,revision,...pin});$('editor').close();await refresh();
 notice(result.truncated||result.evicted?.length?'记忆已保存，但容量不足：'+(result.evicted?.length?result.evicted.length+' 条旧记忆移入归档。':'')+(result.truncated?'当前记忆被截短，完整内容已归档。':'')+'可精简用户记忆或在插件设置中提高 maxBytes。':'记忆已保存。');
});
$('deleteEntry').onclick=()=>run(async()=>{
 if(!selected||!await ask('删除“'+selected.key+'”后，它将不再提供给模型。历史快照仍保留，便于恢复；这不是彻底清除。','删除记忆','确认删除'))return;
 $('editorError').textContent='';await api('update',{...editorScope,key:selected.key,value:'',mode:'remove',revision:selected.revision});$('editor').close();await refresh();notice('记忆已删除，不再提供给模型。历史快照仍保留。');
});
function importOptions(){return{includeProfile:true,policy:'keep-local',projectMap:[...$('mappings').querySelectorAll('input')].filter(i=>i.value.trim()).map(i=>({id:i.dataset.id,path:i.value.trim()}))};}
function invalidatePreview(){preview=null;$('importPreview').hidden=true;syncImport();}
function syncImport(){$('previewImport').disabled=busy||!uploadDoc;$('applyImport').disabled=busy||!preview;}
function summaryText(s){return '新增 '+s.added+' 条，保留本机 '+s.kept+' 条，内容相同 '+s.identical+' 条';}
function previewText(p){
 const lines=['用户记忆：'+(p.profile?summaryText(p.profile):'跳过')];
 for(const x of p.projects)lines.push(projectName(x.sourcePath)+' → '+x.targetPath+'\n'+summaryText(x.summary));
 for(const x of p.unmapped)lines.push('跳过 '+projectName(x.sourcePath)+'：未填写本机目录');return lines.join('\n\n');
}
function importResultText(p){
 const sums=[...(p.profile?[p.profile]:[]),...p.projects.map(x=>x.summary)];
 const total=key=>sums.reduce((n,s)=>n+(s[key]||0),0),skipped=p.unmapped.reduce((n,x)=>n+x.topics,0);
 const lines=['导入完成：新增 '+total('added')+' 条，保留本机 '+total('kept')+' 条，跳过 '+(total('identical')+skipped)+' 条。'];
 if(total('kept'))lines.push('同名记忆有差异，已保留本机版本。');
 if(total('identical'))lines.push(total('identical')+' 条内容与本机相同，无需重复导入。');
 for(const x of p.unmapped)lines.push('跳过项目“'+projectName(x.sourcePath)+'”：未填写本机目录（'+x.topics+' 条记忆）。');
 lines.push(p.backupPath?'已保存备份，可撤销本次导入。':'没有需要修改的内容。');return lines.join('\n');
}
$('importFile').onchange=()=>run(async()=>{
 uploadDoc='';invalidatePreview();$('mappings').replaceChildren();$('importInfo').textContent='选择旧电脑导出的 JSON 文件。同名记忆保留本机内容。';const f=$('importFile').files[0];if(!f)return;if(f.size>16*1024*1024)throw new Error('导出文件超过 16 MB。请精简或拆分记忆后重新导出，再选择文件。');
 const doc=await f.text(),info=await api('inspect-import',{doc});uploadDoc=doc;$('importInfo').textContent=info.profileEntries+' 条用户记忆，'+info.projects.length+' 个项目。同名记忆保留本机内容。';
 for(const p of info.projects){const row=node('div',undefined,'mapping'),label=node('label',projectName(p.sourcePath));label.append(node('small',p.sourcePath));
  const input=node('input');input.type='text';input.placeholder='填写项目在本机的目录；留空则跳过';input.dataset.id=p.id;input.setAttribute('aria-label','本机目录：'+projectName(p.sourcePath));input.oninput=invalidatePreview;
  row.append(label,input);$('mappings').append(row);}
 notice('先查看预览，再确认导入。');
});
$('previewImport').onclick=()=>run(async()=>{
 preview=null;preview=await api('preview-import',{doc:uploadDoc,options:importOptions()});$('importPreview').textContent=previewText(preview);$('importPreview').hidden=false;notice('预览完成，尚未写入记忆。');
});
$('applyImport').onclick=()=>run(async()=>{
 if(!preview||!await ask('确认按预览导入？同名记忆保留本机内容，未填写目录的项目会跳过。'))return;
 const result=await api('apply-import',{doc:uploadDoc,options:importOptions(),previewToken:preview.previewToken});if(result.backupPath)lastBackup=result.backupPath;invalidatePreview();$('rollbackImport').hidden=!lastBackup;await refresh();$('importPreview').textContent=importResultText(result);$('importPreview').hidden=false;notice('导入完成，结果如下。');
});
$('rollbackImport').onclick=()=>run(async()=>{
 if(!lastBackup||!await ask('确认撤销最近一次写入的导入？导入后修改过的文件会阻止恢复。','撤销导入','确认撤销'))return;
 await api('rollback-import',{backupPath:lastBackup});lastBackup='';$('rollbackImport').hidden=true;invalidatePreview();await refresh();notice('已恢复导入前的记忆。');
});
$('export').onclick=()=>run(async()=>{
 const b=await api('export'),url=URL.createObjectURL(new Blob([JSON.stringify(b,null,2)+'\n'],{type:'application/json'})),a=node('a');a.href=url;a.download='dsh-memory-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('导出文件已生成，请妥善保存。');
});
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>run(async()=>{
 for(const x of document.querySelectorAll('[data-tab]'))x.setAttribute('aria-selected',String(x===b));for(const id of ['overview','memories','migration'])$(id).hidden=id!==b.dataset.tab;
 notice('');await refresh();
});
$('scope').onchange=()=>run(refresh);$('search').oninput=render;$('add').onclick=()=>openEditor(null);
run(refresh);
</script></body></html>`;
