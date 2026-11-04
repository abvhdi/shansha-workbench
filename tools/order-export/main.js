const base = null;
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import * as XLSX from "xlsx";


const state = {
  source: "file",
  sourceName: "",
  groups: [],
  fileGroups: [],
  linkFields: {},
  mergeStats: null,
  activeGroupId: "",
  fields: [],
  records: [],
  selectedIds: new Set(),
  templateBytes: null,
  templateName: "",
  query: "",
};

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="/" target="_top" aria-label="返回珊莎首页">SHANSHA &amp; CO.</a>
      <span class="product-name">订单导出助手</span>
    </header>

    <section class="intro">
      <div>
        <span class="eyebrow">表格数据，一键生成 Word</span>
        <h1>选择订单，自动填入模板</h1>
        <p>支持飞书多维表格，也支持本地 Excel、WPS 表格。文件只在当前设备中处理，不会上传保存。</p>
      </div>
      <span class="privacy-pill">本地处理</span>
    </section>

    <section class="card source-card">
      <div class="step-title"><span>1</span><div><h2>选择数据来源</h2><p>飞书或本地表格都可以</p></div></div>
      <div class="source-tabs" role="tablist" aria-label="数据来源">
        <button class="source-tab active" data-source="file" role="tab" aria-selected="true"><b>Excel / WPS</b><small>上传本地表格</small></button>
        <button class="source-tab" data-source="feishu" role="tab" aria-selected="false"><b>飞书多维表格</b><small>读取当前表格</small></button>
      </div>

      <div id="file-panel" class="source-panel">
        <input id="sheet-file" type="file" accept=".xlsx,.xls,.csv" hidden />
        <label class="drop-zone" for="sheet-file" id="drop-zone">
          <span class="upload-icon">＋</span>
          <b>把表格拖到这里</b>
          <span>或点击选择 .xlsx、.xls、.csv 文件（WPS 请先另存为 Excel）</span>
        </label>
      </div>

      <div id="feishu-panel" class="source-panel hidden">
        <div class="feishu-box">
          <div><b>读取当前飞书多维表格</b><p>请在飞书多维表格的插件中使用此功能。</p></div>
          <button class="button secondary" id="load-feishu">读取表格</button>
        </div>
      </div>
      <div id="source-status" class="status neutral">尚未选择表格</div>
      <div id="merge-panel" class="merge-panel hidden">
        <div class="merge-heading">
          <div><b>合并全部工作表</b><p>使用每张表中的公司名称或公司信息，将同一家公司的字段合并成一条记录。</p></div>
          <button class="button secondary" id="apply-merge">重新关联</button>
        </div>
        <div id="merge-sheet-list" class="merge-sheet-list"></div>
        <div id="merge-result" class="merge-result"></div>
      </div>
    </section>

    <section class="card hidden" id="records-card">
      <div class="step-title"><span>2</span><div><h2>选择需要导出的订单</h2><p id="record-summary">可以同时选择多条记录</p></div></div>
      <div class="filters">
        <label>数据表<select id="group-select"></select></label>
        <label class="search-label">搜索订单<input id="record-search" type="search" placeholder="输入任意内容搜索" /></label>
      </div>
      <div class="record-actions">
        <span id="selection-count">尚未选择</span>
        <button id="select-visible" type="button">选择当前结果</button>
        <button id="clear-selection" type="button">清空选择</button>
      </div>
      <div class="record-list" id="record-list"></div>
    </section>

    <section class="card hidden" id="template-card">
      <div class="step-title"><span>3</span><div><h2>加载 Word 模板</h2><p>模板使用 {{字段名}} 作为需要替换的位置</p></div></div>
      <div class="template-row">
        <input id="template-file" type="file" accept=".docx" hidden />
        <label class="button secondary" for="template-file">选择 Word 模板</label>
        <button class="button ghost" id="make-template">生成空白模板</button>
        <span id="template-name" class="muted">尚未加载模板</span>
      </div>
      <details class="fields-box">
        <summary>查看并复制可用字段 <span id="field-count"></span></summary>
        <div id="field-tags" class="field-tags"></div>
      </details>
    </section>

    <section class="export-bar hidden" id="export-bar">
      <div><span class="muted">当前选择</span><b id="selected-name">尚未选择订单</b></div>
      <button class="button primary" id="export-word" disabled>导出 Word</button>
    </section>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </div>
`;

const els = Object.fromEntries([
  "file-panel", "feishu-panel", "sheet-file", "drop-zone", "load-feishu", "source-status",
  "merge-panel", "merge-sheet-list", "merge-result", "apply-merge",
  "records-card", "record-summary", "group-select", "record-search", "record-list",
  "selection-count", "select-visible", "clear-selection",
  "template-card", "template-file", "template-name", "make-template", "field-count",
  "field-tags", "export-bar", "selected-name", "export-word", "toast",
].map((id) => [id, document.getElementById(id)]));

document.querySelectorAll(".source-tab").forEach((button) => {
  button.addEventListener("click", () => switchSource(button.dataset.source));
});

function switchSource(source) {
  state.source = source;
  document.querySelectorAll(".source-tab").forEach((button) => {
    const active = button.dataset.source === source;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els["file-panel"].classList.toggle("hidden", source !== "file");
  els["feishu-panel"].classList.toggle("hidden", source !== "feishu");
  els["merge-panel"].classList.toggle("hidden", source !== "file" || state.fileGroups.length < 2);
  setStatus(source === "file" ? "尚未选择表格" : "点击“读取表格”开始", "neutral");
}

els["sheet-file"].addEventListener("change", (event) => importWorkbook(event.target.files?.[0]));
els["drop-zone"].addEventListener("dragover", (event) => {
  event.preventDefault();
  els["drop-zone"].classList.add("dragging");
});
els["drop-zone"].addEventListener("dragleave", () => els["drop-zone"].classList.remove("dragging"));
els["drop-zone"].addEventListener("drop", (event) => {
  event.preventDefault();
  els["drop-zone"].classList.remove("dragging");
  importWorkbook(event.dataTransfer.files?.[0]);
});

async function importWorkbook(file) {
  if (!file) return;
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    setStatus("请选择 Excel、WPS 或 CSV 表格文件", "error");
    return;
  }
  setStatus("正在读取表格…", "loading");
  try {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    const groups = workbook.SheetNames.map((name, index) => {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, dateNF: "yyyy-mm-dd" });
      const fields = collectFields(rows);
      return {
        id: `sheet-${index}`,
        name,
        fields,
        records: rows.map((values, rowIndex) => ({ id: `${index}-${rowIndex + 2}`, values })),
      };
    }).filter((group) => group.fields.length || group.records.length);
    if (!groups.length) throw new Error("没有识别到有内容的工作表");
    state.sourceName = file.name;
    prepareWorkbookGroups(groups);
    const mergedText = state.mergeStats ? `，已合并为 ${state.mergeStats.companyCount} 家公司` : "";
    setStatus(`已读取 ${file.name}：${groups.length} 个工作表，共 ${groups.reduce((sum, group) => sum + group.records.length, 0)} 条记录${mergedText}`, "success");
  } catch (error) {
    setStatus(`表格读取失败：${friendlyError(error)}`, "error");
  }
}

els["apply-merge"].addEventListener("click", () => {
  applyWorkbookMerge();
  showToast("已按新的关联字段重新合并");
});

els["load-feishu"].addEventListener("click", loadFeishu);

async function loadFeishu() {
  setStatus("正在读取飞书多维表格…", "loading");
  els["load-feishu"].disabled = true;
  try {
    const tableResult = await base.getTableList();
    const tables = Array.isArray(tableResult) ? tableResult : tableResult?.tables || [];
    if (!tables.length) throw new Error("没有读取到数据表，请从飞书多维表格插件中打开");
    const activeTable = await base.getActiveTable();
    const groups = [];
    for (const table of tables) {
      const fieldMeta = await table.getFieldMetaList();
      const fields = fieldMeta.map((field) => ({ id: field.id, name: field.name }));
      const records = [];
      let pageToken;
      let hasMore = true;
      while (hasMore && records.length < 1000) {
        const response = await table.getRecordsByPage({ pageSize: 200, pageToken, stringValue: false });
        for (const record of response.records || []) {
          const values = {};
          for (const field of fields) values[field.name] = normalizeValue(record.fields?.[field.id]);
          records.push({ id: record.recordId, values, rawFields: record.fields || {} });
        }
        hasMore = Boolean(response.hasMore);
        pageToken = response.pageToken;
      }
      const tableName = await table.getName();
      groups.push({ id: table.id, name: tableName || "未命名数据表", fields, records });
    }
    enrichLinkedRecords(groups);
    state.sourceName = "当前飞书多维表格";
    loadGroups(groups, activeTable?.id);
    setStatus(`已读取 ${groups.length} 个数据表，共 ${groups.reduce((sum, group) => sum + group.records.length, 0)} 条记录`, "success");
  } catch (error) {
    setStatus(`读取失败：${friendlyError(error)}。如果当前在普通网页，请改用 Excel / WPS 上传。`, "error");
  } finally {
    els["load-feishu"].disabled = false;
  }
}

const companyFieldNames = ["公司名称", "公司信息", "企业名称", "单位名称", "客户名称", "客户公司", "供应商名称", "公司"];

function prepareWorkbookGroups(groups) {
  state.fileGroups = groups;
  state.linkFields = Object.fromEntries(groups.map((group) => [group.id, detectCompanyField(group)]));
  if (groups.length < 2) {
    state.mergeStats = null;
    els["merge-panel"].classList.add("hidden");
    loadGroups(groups);
    return;
  }
  renderMergePanel();
  applyWorkbookMerge();
}

function detectCompanyField(group) {
  const fields = new Map(group.fields.map((field) => [normalizeFieldName(field.name), field.name]));
  for (const candidate of companyFieldNames) {
    const match = fields.get(normalizeFieldName(candidate));
    if (match) return match;
  }
  const fuzzy = group.fields.find((field) => /公司.*(名称|信息)|企业.*名称|单位.*名称|客户.*名称/.test(normalizeFieldName(field.name)));
  return fuzzy?.name || "";
}

function renderMergePanel() {
  els["merge-panel"].classList.remove("hidden");
  els["merge-sheet-list"].innerHTML = state.fileGroups.map((group) => {
    const options = [`<option value="">不参与合并</option>`, ...group.fields.map((field) => `<option value="${escapeHtml(field.name)}" ${state.linkFields[group.id] === field.name ? "selected" : ""}>${escapeHtml(field.name)}</option>`)].join("");
    return `<label><span><b>${escapeHtml(group.name)}</b><small>${group.records.length} 条记录</small></span><select data-group-id="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name)}的公司关联字段">${options}</select></label>`;
  }).join("");
  els["merge-sheet-list"].querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => { state.linkFields[select.dataset.groupId] = select.value; });
  });
}

function applyWorkbookMerge() {
  const merged = mergeWorkbookGroups(state.fileGroups, state.linkFields);
  state.mergeStats = merged.stats;
  const displayGroups = merged.group.records.length ? [merged.group, ...state.fileGroups] : state.fileGroups;
  loadGroups(displayGroups, merged.group.records.length ? merged.group.id : state.fileGroups[0]?.id);
  const missing = merged.stats.unlinkedRows + merged.stats.skippedRows;
  els["merge-result"].className = `merge-result ${missing ? "warning" : "success"}`;
  els["merge-result"].textContent = merged.stats.configuredSheets
    ? `已关联 ${merged.stats.configuredSheets} 张工作表，得到 ${merged.stats.companyCount} 家公司${missing ? `；${missing} 条记录未能关联，可调整上方字段` : "；全部记录均已关联"}`
    : "还没有选择关联字段，请为工作表选择“公司名称”或“公司信息”。";
}

function mergeWorkbookGroups(groups, linkFields) {
  const configuredGroups = groups.filter((group) => linkFields[group.id]);
  const duplicateNames = new Map();
  for (const group of configuredGroups) {
    for (const field of group.fields) {
      if (field.name === linkFields[group.id]) continue;
      duplicateNames.set(field.name, (duplicateNames.get(field.name) || 0) + 1);
    }
  }

  const usedNames = new Set(["公司名称"]);
  const fields = [{ id: "公司名称", name: "公司名称" }];
  const fieldMaps = new Map();
  for (const group of configuredGroups) {
    const mapping = new Map();
    for (const field of group.fields) {
      let outputName;
      if (field.name === linkFields[group.id]) {
        outputName = "公司名称";
      } else {
        const baseName = duplicateNames.get(field.name) > 1 ? `${group.name}_${field.name}` : field.name;
        outputName = uniqueOutputName(baseName, usedNames);
        fields.push({ id: outputName, name: outputName });
      }
      mapping.set(field.name, outputName);
    }
    fieldMaps.set(group.id, mapping);
  }

  const mergedRecords = new Map();
  let linkedRows = 0;
  let unlinkedRows = 0;
  let skippedRows = 0;
  for (const group of groups) {
    const linkField = linkFields[group.id];
    if (!linkField) {
      skippedRows += group.records.length;
      continue;
    }
    const mapping = fieldMaps.get(group.id);
    for (const record of group.records) {
      const companyValue = record.values[linkField];
      const companyKey = normalizeCompanyKey(companyValue);
      if (!companyKey) {
        unlinkedRows += 1;
        continue;
      }
      linkedRows += 1;
      if (!mergedRecords.has(companyKey)) {
        mergedRecords.set(companyKey, { id: `merged-${mergedRecords.size + 1}`, values: { 公司名称: String(companyValue).trim() } });
      }
      const target = mergedRecords.get(companyKey).values;
      for (const [fieldName, value] of Object.entries(record.values)) {
        if (value === "" || value == null) continue;
        appendMergedValue(target, mapping.get(fieldName) || fieldName, value);
      }
    }
  }

  return {
    group: { id: "merged-all", name: "合并全部工作表", fields, records: [...mergedRecords.values()] },
    stats: { configuredSheets: configuredGroups.length, companyCount: mergedRecords.size, linkedRows, unlinkedRows, skippedRows },
  };
}

function uniqueOutputName(name, usedNames) {
  let output = name;
  let index = 2;
  while (usedNames.has(output)) output = `${name}_${index++}`;
  usedNames.add(output);
  return output;
}

function appendMergedValue(target, fieldName, value) {
  const text = String(value).trim();
  if (!text) return;
  if (!target[fieldName]) {
    target[fieldName] = text;
    return;
  }
  const existing = String(target[fieldName]).split("\n");
  if (!existing.includes(text)) target[fieldName] = `${target[fieldName]}\n${text}`;
}

function normalizeFieldName(value) { return String(value || "").normalize("NFKC").replace(/[\s_\-—:：]/g, "").toLowerCase(); }
function normalizeCompanyKey(value) { return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase(); }

function loadGroups(groups, preferredId) {
  state.groups = groups;
  state.activeGroupId = groups.some((group) => group.id === preferredId) ? preferredId : groups[0].id;
  state.selectedIds = new Set();
  els["group-select"].innerHTML = groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}（${group.records.length}）</option>`).join("");
  els["group-select"].value = state.activeGroupId;
  els["records-card"].classList.remove("hidden");
  els["template-card"].classList.remove("hidden");
  els["export-bar"].classList.remove("hidden");
  activateGroup(state.activeGroupId);
}

els["group-select"].addEventListener("change", (event) => activateGroup(event.target.value));
els["record-search"].addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  renderRecords();
});
els["select-visible"].addEventListener("click", () => {
  visibleRecords().forEach((record) => state.selectedIds.add(record.id));
  renderRecords();
  updateSelection();
});
els["clear-selection"].addEventListener("click", () => {
  state.selectedIds.clear();
  renderRecords();
  updateSelection();
});

function activateGroup(id) {
  state.activeGroupId = id;
  const group = currentGroup();
  state.fields = state.source === "feishu" ? uniqueFields(state.groups.flatMap((item) => item.fields)) : (group?.fields || []);
  state.records = group?.records || [];
  state.selectedIds = new Set();
  state.query = "";
  els["record-search"].value = "";
  els["record-summary"].textContent = `${group?.name || "数据表"}中有 ${state.records.length} 条记录`;
  renderRecords();
  renderFields();
  updateSelection();
}

function renderRecords() {
  const records = visibleRecords();
  if (!records.length) {
    els["record-list"].innerHTML = `<div class="empty">${state.query ? "没有找到匹配的订单" : "这个工作表没有数据"}</div>`;
    return;
  }
  els["record-list"].innerHTML = records.slice(0, 500).map((record) => {
    const title = recordTitle(record);
    const preview = Object.entries(record.values).filter(([, value]) => value !== "").slice(0, 4).map(([key, value]) => `${key}：${value}`).join("　");
    return `<button class="record ${state.selectedIds.has(record.id) ? "selected" : ""}" data-record-id="${escapeHtml(record.id)}" aria-pressed="${state.selectedIds.has(record.id)}"><span class="check">✓</span><span><b>${escapeHtml(title)}</b><small>${escapeHtml(preview || "空白记录")}</small></span></button>`;
  }).join("");
  els["record-list"].querySelectorAll(".record").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.selectedIds.has(button.dataset.recordId)) state.selectedIds.delete(button.dataset.recordId);
      else state.selectedIds.add(button.dataset.recordId);
      renderRecords();
      updateSelection();
    });
  });
}

function visibleRecords() {
  return state.records.filter((record) => !state.query || Object.values(record.values).join(" ").toLowerCase().includes(state.query)).slice(0, 500);
}

function recordTitle(record) {
  const preferred = ["订单号", "订单编号", "合同号", "项目名称", "公司名称", "客户名称", "公司信息", "订单信息"];
  for (const name of preferred) if (record.values[name]) return String(record.values[name]).slice(0, 80);
  return Object.values(record.values).find((value) => value !== "")?.toString().slice(0, 80) || `第 ${state.records.indexOf(record) + 1} 条记录`;
}

function updateSelection() {
  const selected = selectedRecords();
  els["selection-count"].textContent = selected.length ? `已选择 ${selected.length} 条` : "尚未选择";
  els["selected-name"].textContent = selected.length === 1 ? recordTitle(selected[0]) : selected.length ? `已选择 ${selected.length} 条订单` : "尚未选择订单";
  els["export-word"].textContent = selected.length > 1 ? `打包导出 ${selected.length} 份 Word` : "导出 Word";
  els["export-word"].disabled = !(selected.length && state.templateBytes);
}

function selectedRecords() { return state.records.filter((record) => state.selectedIds.has(record.id)); }

els["template-file"].addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    state.templateBytes = new Uint8Array(await file.arrayBuffer());
    state.templateName = file.name;
    els["template-name"].textContent = `已加载：${file.name}`;
    updateSelection();
    showToast("Word 模板已加载");
  } catch (error) {
    showToast(`模板读取失败：${friendlyError(error)}`, true);
  }
});

function renderFields() {
  els["field-count"].textContent = `（${state.fields.length} 个）`;
  els["field-tags"].innerHTML = state.fields.map((field) => `<button data-field="${escapeHtml(field.name)}">{{${escapeHtml(field.name)}}}</button>`).join("");
  els["field-tags"].querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = `{{${button.dataset.field}}}`;
      try { await navigator.clipboard.writeText(text); } catch { copyFallback(text); }
      showToast(`已复制 ${text}`);
    });
  });
}

els["make-template"].addEventListener("click", () => {
  if (!state.fields.length) return showToast("请先读取表格", true);
  const paragraphs = state.fields.map((field) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(field.name)}：{{${escapeXml(field.name)}}}</w:t></w:r></w:p>`).join("");
  const zip = new PizZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("_rels/.rels", relationshipsXml);
  zip.file("word/document.xml", documentXml(paragraphs));
  downloadBlob(zip.generate({ type: "blob", compression: "DEFLATE" }), "订单模板.docx");
  showToast("空白模板已生成");
});

els["export-word"].addEventListener("click", () => {
  const records = selectedRecords();
  if (!records.length || !state.templateBytes) return;
  els["export-word"].disabled = true;
  els["export-word"].textContent = "正在生成…";
  try {
    if (records.length === 1) {
      const output = generateWord(records[0], "blob");
      downloadBlob(output, `订单-${safeFilename(recordTitle(records[0]))}.docx`);
      showToast("Word 已导出");
    } else {
      const bundle = new PizZip();
      const usedNames = new Set();
      records.forEach((record, index) => {
        const baseName = `订单-${safeFilename(recordTitle(record)) || index + 1}.docx`;
        const filename = uniqueFilename(baseName, usedNames);
        bundle.file(filename, generateWord(record, "uint8array"));
      });
      downloadBlob(bundle.generate({ type: "blob", compression: "DEFLATE" }), `订单文件-${records.length}份.zip`);
      showToast(`已生成 ${records.length} 份 Word`);
    }
  } catch (error) {
    const detail = error?.properties?.errors?.map((item) => item.properties?.explanation).filter(Boolean).join("；");
    showToast(`导出失败：${detail || friendlyError(error)}。请检查模板中的字段名。`, true);
  } finally {
    updateSelection();
  }
});

function generateWord(record, type) {
  const zip = new PizZip(state.templateBytes);
  const template = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
  });
  template.render(record.values);
  return template.getZip().generate({ type, compression: "DEFLATE" });
}

function uniqueFilename(filename, usedNames) {
  if (!usedNames.has(filename)) {
    usedNames.add(filename);
    return filename;
  }
  const extensionIndex = filename.lastIndexOf(".");
  const base = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  let index = 2;
  let candidate = `${base}-${index}${extension}`;
  while (usedNames.has(candidate)) candidate = `${base}-${++index}${extension}`;
  usedNames.add(candidate);
  return candidate;
}

function currentGroup() { return state.groups.find((group) => group.id === state.activeGroupId); }
function collectFields(rows) {
  const names = [];
  const seen = new Set();
  rows.forEach((row) => Object.keys(row).forEach((name) => {
    const clean = String(name).trim();
    if (clean && !seen.has(clean)) { seen.add(clean); names.push({ id: clean, name: clean }); }
  }));
  return names;
}
function uniqueFields(fields) {
  const seen = new Set();
  return fields.filter((field) => {
    if (seen.has(field.name)) return false;
    seen.add(field.name);
    return true;
  });
}
function enrichLinkedRecords(groups) {
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const recordMaps = new Map(groups.map((group) => [group.id, new Map(group.records.map((record) => [record.id, record]))]));
  for (const group of groups) {
    for (const record of group.records) {
      const relations = [];
      findRelations(record.rawFields, relations);
      for (const relation of relations) {
        const relatedGroup = groupMap.get(relation.tableId);
        const relatedRecords = recordMaps.get(relation.tableId);
        if (!relatedGroup || !relatedRecords) continue;
        for (const relatedId of relation.recordIds.slice(0, 20)) {
          const related = relatedRecords.get(relatedId);
          if (!related) continue;
          for (const field of relatedGroup.fields) {
            const value = normalizeValue(related.rawFields?.[field.id]);
            if (!value) continue;
            record.values[field.name] = record.values[field.name] ? `${record.values[field.name]}、${value}` : value;
          }
        }
      }
    }
  }
}
function findRelations(value, output, depth = 0) {
  if (!value || depth > 4) return;
  if (Array.isArray(value)) return value.forEach((item) => findRelations(item, output, depth + 1));
  if (typeof value !== "object") return;
  const tableId = value.table_id || value.tableId;
  const recordIds = value.record_ids || value.recordIds;
  if (tableId && Array.isArray(recordIds)) output.push({ tableId, recordIds });
  Object.values(value).forEach((item) => findRelations(item, output, depth + 1));
}
function normalizeValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(normalizeValue).filter(Boolean).join("、");
  if (typeof value === "object") {
    if (value.text) return normalizeValue(value.text);
    if (value.text_arr) return normalizeValue(value.text_arr);
    if (value.name) return normalizeValue(value.name);
    if (value.value != null) return normalizeValue(value.value);
    if (value.full_address) return normalizeValue(value.full_address);
    if (value.link) return normalizeValue(value.link);
  }
  return "";
}
function setStatus(message, type) { els["source-status"].textContent = message; els["source-status"].className = `status ${type}`; }
function showToast(message, error = false) {
  els.toast.textContent = message;
  els.toast.className = `toast show ${error ? "error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}
function friendlyError(error) { return error?.message || String(error || "未知错误"); }
function safeFilename(value) { return String(value || "未命名").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40); }
function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function escapeXml(value) { return escapeHtml(value).replace(/'/g, "&apos;"); }
function copyFallback(text) { const area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.left = "-9999px"; document.body.append(area); area.select(); document.execCommand("copy"); area.remove(); }
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function documentXml(body) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`; }
const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const relationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

if (false) {
  switchSource("feishu");
  setTimeout(loadFeishu, 250);
}

document.querySelector('.topbar')?.remove();
document.querySelector('.source-tabs')?.remove();
document.querySelector('.intro h1').textContent='从表格批量生成订单';
document.querySelector('.intro p').textContent='选择 Excel / WPS / CSV 表格，使用 Word 模板导出。文件只在本机处理。';
document.querySelector('.eyebrow')?.remove();
document.querySelector('.step-title p').textContent='拖入或选择本地表格';
