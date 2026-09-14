/* Public data layer, verified from digiLQD dashboard on 2026-09-14. */
const API_CONFIG = Object.freeze({
  base: "https://firestore.googleapis.com/v1/projects/doanthptchuyenlequydon/databases/(default)/documents",
  apiKey: "AIzaSyBZjf4cej0daDmPiL5JhjH_bFX7kQpKX0w",
  className: "11 Tin", classId: "MM2KGZwgLGLHDvod10ZW",
  cacheKey: "thidua-11tin-public-v1", cacheMs: 5 * 60 * 1000
});
const $ = id => document.getElementById(id), root = document.documentElement;
let chart, records = [];

function syncThemeIcon() { $("themeIcon").className = root.dataset.theme === "light" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill"; }
function setTheme(theme) { root.dataset.theme = theme; localStorage.setItem("thidua-11tin-theme", theme); syncThemeIcon(); updateChartTheme(); }
setTheme(localStorage.getItem("thidua-11tin-theme") || "dark");
$("themeToggle").addEventListener("click", () => setTheme(root.dataset.theme === "light" ? "dark" : "light"));

const endpoint = path => `${API_CONFIG.base}${path.startsWith(":") ? "" : "/"}${path}?key=${API_CONFIG.apiKey}`;
async function request(path, options) { const response = await fetch(endpoint(path), options); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
function value(field) {
  if (!field) return undefined;
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return Number(field.doubleValue);
  if ("booleanValue" in field) return field.booleanValue;
  if ("timestampValue" in field) return field.timestampValue;
  if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([key, item]) => [key, value(item)]));
}
const documentData = doc => Object.fromEntries(Object.entries(doc.fields || {}).map(([key, field]) => [key, value(field)]));
const formatNumber = number => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number);
const formatDate = iso => iso ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "Chưa có thời điểm cập nhật";
const text = input => String(input ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[char]));

async function getRecords(classId) {
  const body = { structuredQuery: { from: [{ collectionId: "thidua_ghi" }], where: { fieldFilter: { field: { fieldPath: "lopId" }, op: "EQUAL", value: { stringValue: classId } } } } };
  const results = await request(":runQuery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return results.filter(item => item.document).map(item => documentData(item.document));
}
async function loadFromApi() {
  const [configDoc, classesDoc] = await Promise.all([request("site/thidua"), request("thidua_lops")]);
  const config = documentData(configDoc);
  const summaryDoc = await request(`thidua_tonghop/${encodeURIComponent(config.nienHoc)}`);
  const classes = (classesDoc.documents || []).map(doc => ({ id: doc.name.split("/").pop(), ...documentData(doc) }));
  const log = await getRecords(API_CONFIG.classId);
  return { config, classes, summary: documentData(summaryDoc).data || {}, updatedAt: documentData(summaryDoc).capNhat, log: log.filter(item => item.nienHoc === config.nienHoc && !item.daXoa) };
}
function getCache() { try { const item = JSON.parse(localStorage.getItem(API_CONFIG.cacheKey)); return item && Date.now() - item.time < API_CONFIG.cacheMs ? item.data : null; } catch { return null; } }
function putCache(data) { try { localStorage.setItem(API_CONFIG.cacheKey, JSON.stringify({ time: Date.now(), data })); } catch {} }
function totalFor(weeks) { return Object.values(weeks || {}).reduce((sum, week) => ({ plus: sum.plus + Number(week.cong || 0), minus: sum.minus + Number(week.tru || 0) }), { plus: 0, minus: 0 }); }
function rankings(summary, classes) {
  const sorted = classes
    .map(item => ({ ...item, ...totalFor(summary[item.id]) }))
    .map(item => ({ ...item, total: item.plus + item.minus }))
    .sort((a, b) => b.total - a.total);

  let rank = 0;
  let previousTotal;
  return sorted.map((item, index) => {
    if (index === 0 || item.total !== previousTotal) rank = index + 1;
    previousTotal = item.total;
    return { ...item, rank };
  });
}
function setStat(id, number, note, prefix = "") { $(id).textContent = number == null ? "—" : `${prefix}${formatNumber(number)}`; $(id.replace("Value", "Note")).textContent = note; }
function empty(message) { return `<div class="data-state"><i class="bi bi-database-exclamation"></i><strong>Hiện chưa có dữ liệu.</strong><span>${text(message)}</span></div>`; }

function renderSummary(data) {
  const weeks = data.summary[API_CONFIG.classId], allRanks = rankings(data.summary, data.classes), mine = allRanks.find(item => item.id === API_CONFIG.classId);
  // Không có mục tuần của lớp nghĩa là chưa phát sinh cộng/trừ điểm, không phải không có dữ liệu lớp.
  if (!mine) throw new Error("Không tìm thấy lớp 11 Tin trong danh sách lớp công khai.");
  setStat("rankValue", mine.rank, `Hạng trong ${allRanks.length} lớp`, "#"); setStat("plusValue", mine.plus, "Tổng điểm cộng", "+"); setStat("minusValue", mine.minus, "Tổng điểm trừ"); setStat("totalValue", mine.total, "Điểm cộng + điểm trừ");
  $("rankBadge").textContent = `HẠNG #${mine.rank}`;
  // Hiện Top 3 thực tế và 11 Tin. Khi nhiều lớp đồng hạng 4, danh sách vẫn rõ lớp đang xem.
  const topThree = allRanks.slice(0, 3);
  const displayRanks = topThree.some(item => item.id === mine.id) ? topThree : [...topThree, mine];
  $("rankList").innerHTML = displayRanks.map(item => `<div class="rank-row ${item.id === API_CONFIG.classId ? "current" : "faded"}"><span class="rank-number ${item.rank === 1 ? "crown" : ""}">${String(item.rank).padStart(2,"0")}</span><span class="rank-name"><strong>${text(item.ten)}</strong>${item.id === API_CONFIG.classId ? "<small>Lớp đang xem</small>" : ""}</span><span class="rank-score">${formatNumber(item.total)}</span></div>`).join("");
  renderBreakdown(mine); renderChart(weeks);
}
function renderBreakdown(mine) {
  if (!mine) { $("breakdown").innerHTML = `<div class="donut" style="--p:0%"><div class="donut-inner"><strong>—</strong><span>chưa có dữ liệu</span></div></div><div class="breakdown-list">${empty("Dữ liệu thành phần sẽ chỉ hiện khi digiLQD cung cấp.")}</div>`; return; }
  const magnitude = mine.plus + Math.abs(mine.minus), pct = magnitude ? (mine.plus / magnitude * 100).toFixed(0) : 0;
  $("breakdown").innerHTML = `<div class="donut" style="--p:${pct}%"><div class="donut-inner"><strong>${formatNumber(mine.total)}</strong><span>tổng điểm</span></div></div><div class="breakdown-list"><div class="breakdown-item"><span><i class="dot-plus"></i>Điểm cộng</span><strong class="positive">+${formatNumber(mine.plus)}</strong></div><div class="breakdown-item"><span><i class="dot-red"></i>Điểm trừ</span><strong class="negative">${formatNumber(mine.minus)}</strong></div><div class="breakdown-item"><span><i class="dot-blue"></i>Phần điểm cộng</span><strong>${pct}%</strong></div></div>`;
}
function chartColors() { return root.dataset.theme === "light" ? { text:"#5c6f86", grid:"rgba(34,60,95,.09)" } : { text:"#93a7bf", grid:"rgba(148,183,219,.09)" }; }
function renderChart(weeks) {
  const entries = Object.entries(weeks || {}).map(([key,item]) => ({ week:Number(key.slice(1)), total:Number(item.cong || 0)+Number(item.tru || 0) })).filter(item => Number.isFinite(item.week)).sort((a,b) => a.week-b.week);
  if (!entries.length) { $("chartState").className="data-state"; $("chartState").innerHTML=`<i class="bi bi-bar-chart-line"></i><strong>Chưa phát sinh điểm theo tuần.</strong><span>Hiện chưa có lượt cộng hoặc trừ điểm nào cho 11 Tin.</span>`; $("chartBadge").textContent="0 ĐIỂM"; return; }
  $("chartState").classList.add("d-none"); $("chartBadge").textContent=`${entries.length} TUẦN`; $("chartLegend").textContent=`Tuần ${entries[0].week} → Tuần ${entries.at(-1).week}`;
  if (chart) chart.destroy(); const colors=chartColors(); chart = new Chart($("scoreChart"), { type:"line", data:{ labels:entries.map(item => `Tuần ${item.week}`), datasets:[{data:entries.map(item=>item.total),borderColor:"#55d6ff",backgroundColor:"rgba(85,214,255,.18)",borderWidth:3,tension:.35,fill:true,pointRadius:4}]}, options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{color:colors.text}},y:{beginAtZero:true,ticks:{color:colors.text},grid:{color:colors.grid}}}} });
}
function updateChartTheme() { if (!chart) return; const colors=chartColors(); chart.options.scales.x.ticks.color=colors.text; chart.options.scales.y.ticks.color=colors.text; chart.options.scales.y.grid.color=colors.grid; chart.update(); }
function activity(item) { const positive=Number(item.diem)>=0; return `<div class="activity-item"><div class="activity-icon ${positive ? "success" : "warning"}"><i class="bi bi-${positive ? "plus-lg" : "exclamation-lg"}"></i></div><div class="activity-content"><div class="activity-top"><strong>${text(item.tenLoi || "Sự kiện thi đua")}</strong><span>${text(item.ngay || "—")}</span></div><p>${text(item.hoTen || "Lớp 11 Tin")}${item.ghiChu ? ` · ${text(item.ghiChu)}` : ""}</p></div><div class="activity-points ${positive ? "positive" : "negative"}">${positive ? "+" : ""}${formatNumber(Number(item.diem || 0))}</div></div>`; }
function renderRows(rows) { $("violationRows").innerHTML=rows.map(item => `<tr><td><div class="person-cell"><span class="avatar avatar-a">${text((item.hoTen || "—").trim().charAt(0))}</span><div><strong>${text(item.hoTen || "—")}</strong><small>11 Tin</small></div></div></td><td><span class="tag ${Number(item.diem)<0 ? "tag-danger":"tag-warning"}">${text(item.tenLoi || "—")}</span></td><td>${text(item.ngay || "—")}</td><td class="text-end ${Number(item.diem)<0 ? "points-minus":"positive"}">${Number(item.diem)>0 ? "+":""}${formatNumber(Number(item.diem || 0))}</td></tr>`).join(""); }
function renderLogs(log) { records=[...log].sort((a,b)=>String(b.ngay||"").localeCompare(String(a.ngay||""))); if (!records.length) { const message="Nguồn chưa có nhật ký công khai của 11 Tin trong năm học này."; $("activityList").innerHTML=empty(message); $("violationRows").innerHTML=`<tr><td colspan="4">${empty(message)}</td></tr>`; return; } $("searchInput").disabled=false; $("activityList").innerHTML=records.slice(0,4).map(activity).join(""); renderRows(records); }
function setStatus(status, detail) { $("sourceStatus").textContent=status; $("updatedAt").innerHTML=`<i class="bi bi-clock-history"></i> ${detail}`; }
async function load(force=false) { try { setStatus("Đang tải", "Đang kết nối Firestore công khai…"); const cached=!force && getCache(), data=cached || await loadFromApi(); if (!cached) putCache(data); $("schoolYear").textContent=data.config.nienHoc || "Chưa xác định"; const hasEvents=Boolean(data.summary[API_CONFIG.classId] && Object.keys(data.summary[API_CONFIG.classId]).length); setStatus(hasEvents ? "Đã đồng bộ":"Chưa phát sinh điểm", `Cập nhật nguồn: ${formatDate(data.updatedAt)}`); renderSummary(data); renderLogs(data.log); } catch (error) { console.error("Không thể tải dữ liệu thi đua",error); setStatus("Lỗi tải dữ liệu","Không thể kết nối nguồn dữ liệu"); ["rankList","activityList"].forEach(id => $(id).innerHTML=empty("Không thể tải dữ liệu thi đua. Vui lòng thử lại.")); $("chartState").className="data-state"; $("chartState").innerHTML=empty("Không thể tải dữ liệu thi đua."); $("violationRows").innerHTML=`<tr><td colspan="4">${empty("Không thể tải dữ liệu thi đua.")}</td></tr>`; } }
$("retryBtn").addEventListener("click",()=>load(true));
$("searchInput").addEventListener("input",event=>{ const term=event.target.value.trim().toLocaleLowerCase("vi"); renderRows(records.filter(row=>`${row.hoTen || ""} ${row.tenLoi || ""} ${row.ghiChu || ""}`.toLocaleLowerCase("vi").includes(term))); });
load();
