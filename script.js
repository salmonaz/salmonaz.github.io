/* Frontend for Cloudflare Pages. Class competition data remains read-only from the school's public source. */
const SCHOOL_API = Object.freeze({
  base: "https://firestore.googleapis.com/v1/projects/doanthptchuyenlequydon/databases/(default)/documents",
  apiKey: "AIzaSyBZjf4cej0daDmPiL5JhjH_bFX7kQpKX0w",
  classId: "MM2KGZwgLGLHDvod10ZW",
  cacheKey: "thidua-11tin-public-v2", cacheMs: 5 * 60 * 1000
});

const $ = id => document.getElementById(id);
const root = document.documentElement;
const state = {
  chart: null,
  records: [],
  students: [],
  leaderboard: [],
  seating: {},
  adminToken: sessionStorage.getItem("11tin-admin-token") || "",
  adminExpiresAt: Number(sessionStorage.getItem("11tin-admin-expires-at") || 0),
  seatMonth: monthNow(),
  seatingDirty: false,
  activeStudentId: null,
  selectedStudentId: null,
  dragFromSeatId: null
};

function isAdmin() {
  return Boolean(state.adminToken) && Number.isFinite(state.adminExpiresAt) && state.adminExpiresAt > Date.now();
}
function clearAdminSession() {
  state.adminToken = "";
  state.adminExpiresAt = 0;
  sessionStorage.removeItem("11tin-admin-token");
  sessionStorage.removeItem("11tin-admin-expires-at");
}
if (!isAdmin()) clearAdminSession();

function escapeHtml(input) { return String(input ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char])); }
function formatNumber(value) { return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Number(value || 0)); }
function initials(name) { return String(name || "?").trim().split(/\s+/).slice(-2).map(part => part[0]).join("").toUpperCase(); }
function monthNow() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; }

/* Theme */
function syncTheme() {
  const dark = root.dataset.theme === "dark";
  $("themeIcon").className = dark ? "bi bi-moon-stars-fill" : "bi bi-sun-fill";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#07111f" : "#f4f8ff";
  if (state.chart) updateChartTheme();
}
function setTheme(theme) { root.dataset.theme = theme; localStorage.setItem("11tin-theme", theme); syncTheme(); }
setTheme(localStorage.getItem("11tin-theme") || "light");
$("themeToggle").addEventListener("click", () => setTheme(root.dataset.theme === "dark" ? "light" : "dark"));

/* App navigation */
function showView(name) {
  document.querySelectorAll(".app-view").forEach(view => view.classList.toggle("d-none", view.id !== `${name}View`));
  document.querySelectorAll(".app-tab").forEach(button => button.classList.toggle("active", button.dataset.viewTarget === name));
  if (name === "seating") state.seatMonth = monthNow();
  if (name === "seating" || name === "individual") loadClassData();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-view-target]").forEach(element => element.addEventListener("click", event => { event.preventDefault(); showView(element.dataset.viewTarget); }));

/* School public data */
function schoolEndpoint(path) { return `${SCHOOL_API.base}${path.startsWith(":") ? "" : "/"}${path}?key=${SCHOOL_API.apiKey}`; }
async function schoolRequest(path, options) { const response = await fetch(schoolEndpoint(path), options); if (!response.ok) throw new Error(`Nguồn thi đua trả về ${response.status}`); return response.json(); }
function firestoreValue(field) {
  if (!field) return undefined;
  if ("stringValue" in field) return field.stringValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return Number(field.doubleValue);
  if ("booleanValue" in field) return field.booleanValue;
  if ("timestampValue" in field) return field.timestampValue;
  if ("mapValue" in field) return Object.fromEntries(Object.entries(field.mapValue.fields || {}).map(([key, item]) => [key, firestoreValue(item)]));
  return undefined;
}
function firestoreDocument(doc) { return Object.fromEntries(Object.entries(doc.fields || {}).map(([key, item]) => [key, firestoreValue(item)])); }
async function getSchoolRecords(classId) {
  const body = { structuredQuery: { from: [{ collectionId: "thidua_ghi" }], where: { fieldFilter: { field: { fieldPath: "lopId" }, op: "EQUAL", value: { stringValue: classId } } } } };
  const results = await schoolRequest(":runQuery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return results.filter(item => item.document).map(item => firestoreDocument(item.document));
}
async function getSchoolData() {
  const [configDoc, classesDoc] = await Promise.all([schoolRequest("site/thidua"), schoolRequest("thidua_lops")]);
  const config = firestoreDocument(configDoc);
  const summaryDoc = await schoolRequest(`thidua_tonghop/${encodeURIComponent(config.nienHoc)}`);
  const classes = (classesDoc.documents || []).map(doc => ({ id: doc.name.split("/").pop(), ...firestoreDocument(doc) }));
  const records = await getSchoolRecords(SCHOOL_API.classId);
  return { config, classes, summary: firestoreDocument(summaryDoc).data || {}, updatedAt: firestoreDocument(summaryDoc).capNhat, records: records.filter(record => record.nienHoc === config.nienHoc && !record.daXoa) };
}
function cacheSchoolData(data) { try { localStorage.setItem(SCHOOL_API.cacheKey, JSON.stringify({ at: Date.now(), data })); } catch {} }
function getCachedSchoolData() { try { const cached = JSON.parse(localStorage.getItem(SCHOOL_API.cacheKey)); return cached && Date.now() - cached.at < SCHOOL_API.cacheMs ? cached.data : null; } catch { return null; } }
function totalFor(weeks) { return Object.values(weeks || {}).reduce((total, week) => ({ plus: total.plus + Number(week.cong || 0), minus: total.minus + Number(week.tru || 0) }), { plus: 0, minus: 0 }); }
function calculateRanks(summary, classes) {
  const rows = classes.map(item => ({ ...item, ...totalFor(summary[item.id]) })).map(item => ({ ...item, total: item.plus + item.minus })).sort((a, b) => b.total - a.total);
  let rank = 0, previous;
  return rows.map((item, index) => { if (index === 0 || item.total !== previous) rank = index + 1; previous = item.total; return { ...item, rank }; });
}
function setStat(id, value, note, prefix = "") { $(id).textContent = value == null ? "—" : `${prefix}${formatNumber(value)}`; $(id.replace("Value", "Note")).textContent = note; }
function emptyState(message) { return `<div class="data-state"><i class="bi bi-database-exclamation"></i><strong>Hiện chưa có dữ liệu.</strong><span>${escapeHtml(message)}</span></div>`; }
function chartColors() { return root.dataset.theme === "dark" ? { text: "#93a7bf", grid: "rgba(148,183,219,.09)" } : { text: "#5c6f86", grid: "rgba(34,60,95,.09)" }; }
function renderSchoolSummary(data) {
  const allRanks = calculateRanks(data.summary, data.classes);
  const mine = allRanks.find(item => item.id === SCHOOL_API.classId);
  if (!mine) throw new Error("Không tìm thấy lớp 11 Tin trong danh sách công khai.");
  setStat("rankValue", mine.rank, `Hạng trong ${allRanks.length} lớp`, "#");
  setStat("plusValue", mine.plus, "Tổng điểm cộng", "+");
  setStat("minusValue", mine.minus, "Tổng điểm trừ");
  setStat("totalValue", mine.total, "Điểm cộng + điểm trừ");
  $("rankBadge").textContent = `HẠNG #${mine.rank}`;
  const top = allRanks.slice(0, 3);
  const visible = top.some(item => item.id === mine.id) ? top : [...top, mine];
  $("rankList").innerHTML = visible.map(item => `<div class="rank-row ${item.id === mine.id ? "current" : "faded"}"><span class="rank-number ${item.rank === 1 ? "crown" : ""}">${String(item.rank).padStart(2, "0")}</span><span class="rank-name"><strong>${escapeHtml(item.ten)}</strong>${item.id === mine.id ? "<small>Lớp đang xem</small>" : ""}</span><span class="rank-score">${formatNumber(item.total)}</span></div>`).join("");
  renderBreakdown(mine); renderSchoolChart(data.summary[SCHOOL_API.classId]);
}
function renderBreakdown(mine) {
  const size = mine.plus + Math.abs(mine.minus); const plusPercent = size ? Math.round(mine.plus / size * 100) : 0;
  $("breakdown").innerHTML = `<div class="donut" style="--p:${plusPercent}%"><div class="donut-inner"><strong>${formatNumber(mine.total)}</strong><span>tổng điểm</span></div></div><div class="breakdown-list"><div class="breakdown-item"><span><i class="dot-plus"></i>Điểm cộng</span><strong class="positive">+${formatNumber(mine.plus)}</strong></div><div class="breakdown-item"><span><i class="dot-red"></i>Điểm trừ</span><strong class="negative">${formatNumber(mine.minus)}</strong></div><div class="breakdown-item"><span><i class="dot-blue"></i>Phần điểm cộng</span><strong>${plusPercent}%</strong></div></div>`;
}
function renderSchoolChart(weeks) {
  const points = Object.entries(weeks || {}).map(([key, value]) => ({ week: Number(key.slice(1)), total: Number(value.cong || 0) + Number(value.tru || 0) })).filter(item => Number.isFinite(item.week)).sort((a, b) => a.week - b.week);
  if (!points.length) { $("chartState").className = "data-state"; $("chartState").innerHTML = `<i class="bi bi-bar-chart-line"></i><strong>Chưa phát sinh điểm theo tuần.</strong><span>Hiện chưa có lượt cộng hoặc trừ điểm cho 11 Tin.</span>`; $("chartBadge").textContent = "0 ĐIỂM"; if (state.chart) state.chart.destroy(); state.chart = null; return; }
  $("chartState").classList.add("d-none"); $("chartBadge").textContent = `${points.length} TUẦN`; $("chartLegend").textContent = `Tuần ${points[0].week} → Tuần ${points.at(-1).week}`;
  if (state.chart) state.chart.destroy(); const colors = chartColors();
  state.chart = new Chart($("scoreChart"), { type: "line", data: { labels: points.map(item => `Tuần ${item.week}`), datasets: [{ data: points.map(item => item.total), borderColor: "#55d6ff", backgroundColor: "rgba(85,214,255,.18)", borderWidth: 3, tension: .35, fill: true, pointRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: colors.text } }, y: { beginAtZero: true, ticks: { color: colors.text }, grid: { color: colors.grid } } } } });
}
function updateChartTheme() { if (!state.chart) return; const colors = chartColors(); state.chart.options.scales.x.ticks.color = colors.text; state.chart.options.scales.y.ticks.color = colors.text; state.chart.options.scales.y.grid.color = colors.grid; state.chart.update(); }
function renderSchoolRecords(records) {
  state.records = [...records].sort((a, b) => String(b.ngay || "").localeCompare(String(a.ngay || "")));
  if (!state.records.length) { const message = "Nguồn chưa có nhật ký công khai của 11 Tin trong năm học này."; $("activityList").innerHTML = emptyState(message); return; }
  $("activityList").innerHTML = state.records.slice(0, 4).map(item => { const positive = Number(item.diem) >= 0; return `<div class="activity-item"><div class="activity-icon ${positive ? "success" : "warning"}"><i class="bi bi-${positive ? "plus-lg" : "exclamation-lg"}"></i></div><div class="activity-content"><div class="activity-top"><strong>${escapeHtml(item.tenLoi || "Sự kiện thi đua")}</strong><span>${escapeHtml(item.ngay || "—")}</span></div><p>${escapeHtml(item.hoTen || "Lớp 11 Tin")}${item.ghiChu ? ` · ${escapeHtml(item.ghiChu)}` : ""}</p></div><div class="activity-points ${positive ? "positive" : "negative"}">${positive ? "+" : ""}${formatNumber(item.diem)}</div></div>`; }).join("");
}
function sourceStatus(name, message) { $("sourceStatus").textContent = name; $("updatedAt").innerHTML = `<i class="bi bi-clock-history"></i> ${message}`; }
async function loadSchoolData(force = false) {
  try { sourceStatus("Đang tải", "Đang kết nối nguồn dữ liệu"); const cached = !force && getCachedSchoolData(); const data = cached || await getSchoolData(); if (!cached) cacheSchoolData(data); $("schoolYear").textContent = data.config.nienHoc || "Chưa xác định"; const hasEvents = Boolean(data.summary[SCHOOL_API.classId] && Object.keys(data.summary[SCHOOL_API.classId]).length); const updated = data.updatedAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(data.updatedAt)) : "chưa có thời điểm"; sourceStatus(hasEvents ? "Đã đồng bộ" : "Chưa phát sinh điểm", `Cập nhật nguồn: ${updated}`); renderSchoolSummary(data); renderSchoolRecords(data.records); }
  catch (error) { console.error(error); sourceStatus("Lỗi tải dữ liệu", "Không thể kết nối nguồn dữ liệu"); $("rankList").innerHTML = emptyState("Không thể tải dữ liệu thi đua. Vui lòng thử lại."); $("activityList").innerHTML = emptyState("Không thể tải dữ liệu thi đua. Vui lòng thử lại."); $("chartState").className = "data-state"; $("chartState").innerHTML = emptyState("Không thể tải biểu đồ."); }
}
$("retryBtn").addEventListener("click", () => loadSchoolData(true));

/* Backend class management */
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {}); if (isAdmin()) headers.set("Authorization", `Bearer ${state.adminToken}`); if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) { clearAdminSession(); setAdminUI(); }
    const error = new Error(payload.error || `Máy chủ trả về ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
function setBackendProblem(show) { $("backendAlert").classList.toggle("d-none", !show); }
function setAdminUI() {
  const admin = isAdmin(); document.querySelectorAll(".admin-only").forEach(item => item.classList.toggle("d-none", !admin));
}
async function loadClassData() {
  try {
    const [studentsPayload, seatingPayload, boardPayload] = await Promise.all([api("/students"), api(`/seating?month=${encodeURIComponent(state.seatMonth)}`), api("/leaderboard")]);
    state.students = studentsPayload.students || []; state.seating = seatingPayload.assignments || {}; state.leaderboard = boardPayload.students || [];
    setBackendProblem(false); renderSeating(); renderLeaderboard(); setAdminUI();
  } catch (error) { console.error(error); setBackendProblem(true); $("unseatedRoster").innerHTML = emptyState("Chưa thể tải dữ liệu lớp."); $("groupsGrid").innerHTML = emptyState("Chưa thể tải sơ đồ chỗ ngồi."); $("leaderboardRows").innerHTML = `<tr><td colspan="5">${emptyState("Chưa thể tải thi đua cá nhân.")}</td></tr>`; }
}
function photoMarkup(student) { return student.photoUrl ? `<img class="student-avatar" src="${escapeHtml(student.photoUrl)}" alt="Ảnh ${escapeHtml(student.fullName)}">` : `<span class="student-avatar">${escapeHtml(initials(student.fullName))}</span>`; }
function findStudent(id) { return state.students.find(student => student.id === id); }
function seatId(group, desk, side) { return `g${group}-d${desk}-s${side}`; }
function renderSeating() {
  const assigned = new Set(Object.values(state.seating).filter(Boolean)); const unseated = state.students.filter(student => !assigned.has(student.id));
  $("unseatedCount").textContent = `${unseated.length} HS`;
  $("unseatedRoster").innerHTML = unseated.length ? unseated.map(studentChip).join("") : `<div class="data-state"><i class="bi bi-check-circle"></i><strong>Đã xếp đủ chỗ.</strong><span>Toàn bộ học sinh đang ở trên sơ đồ.</span></div>`;
  $("groupsGrid").innerHTML = [1, 2, 3, 4].map(group => `<section class="group-card"><div class="group-label"><span>Tổ ${group}</span><small>5 bàn · 10 chỗ</small></div><div class="desks">${Array.from({ length: 5 }, (_, deskIndex) => { const desk = deskIndex + 1; return `<div class="desk" data-desk="B${desk}"><div class="seat ${state.seating[seatId(group, desk, 1)] ? "" : "empty"}" data-seat-id="${seatId(group, desk, 1)}">${seatContent(state.seating[seatId(group, desk, 1)])}</div><div class="seat ${state.seating[seatId(group, desk, 2)] ? "" : "empty"}" data-seat-id="${seatId(group, desk, 2)}">${seatContent(state.seating[seatId(group, desk, 2)])}</div></div>`; }).join("")}</div></section>`).join("");
  bindSeatingEvents();
}
function studentChip(student) { return `<button class="student-chip ${state.selectedStudentId === student.id ? "is-selected" : ""}" data-student-id="${student.id}" draggable="${isAdmin() ? "true" : "false"}">${photoMarkup(student)}<span class="student-chip-text"><strong>${escapeHtml(student.fullName)}</strong><small>${student.groupNo ? `Tổ ${student.groupNo}` : "Chưa phân tổ"}</small></span></button>`; }
function seatContent(studentId) { const student = findStudent(studentId); return student ? `<span class="seat-student ${state.selectedStudentId === student.id ? "is-selected" : ""}" data-student-id="${student.id}" draggable="${isAdmin() ? "true" : "false"}">${photoMarkup(student)}<span class="seat-name">${escapeHtml(student.fullName.split(" ").slice(-2).join(" "))}</span></span>` : `<span>Trống</span>`; }
function markSeatingDirty() {
  state.seatingDirty = true;
  $("saveSeatsBtn").innerHTML = '<i class="bi bi-floppy-fill me-1"></i>Lưu thay đổi';
}
function placeStudentInSeat(studentId, targetSeatId) {
  const sourceSeatId = Object.entries(state.seating).find(([, id]) => id === studentId)?.[0];
  const displacedStudentId = state.seating[targetSeatId];
  if (sourceSeatId === targetSeatId) { state.selectedStudentId = null; renderSeating(); return; }
  if (sourceSeatId) {
    if (displacedStudentId) state.seating[sourceSeatId] = displacedStudentId;
    else delete state.seating[sourceSeatId];
  }
  state.seating[targetSeatId] = studentId;
  state.selectedStudentId = null;
  state.dragFromSeatId = null;
  markSeatingDirty();
  renderSeating();
}
function selectStudentForSeat(studentId) {
  state.selectedStudentId = state.selectedStudentId === studentId ? null : studentId;
  renderSeating();
}
function bindSeatingEvents() {
  document.querySelectorAll("#seatingView [data-student-id]").forEach(element => {
    element.addEventListener("click", event => {
      event.stopPropagation();
      if (isAdmin()) selectStudentForSeat(element.dataset.studentId);
      else openStudent(element.dataset.studentId);
    });
    if (isAdmin()) {
      element.addEventListener("dragstart", event => {
        state.dragFromSeatId = element.closest(".seat")?.dataset.seatId || null;
        event.dataTransfer.setData("text/plain", element.dataset.studentId);
        event.dataTransfer.effectAllowed = "move";
      });
      element.addEventListener("dragend", () => { state.dragFromSeatId = null; });
    }
  });
  if (!isAdmin()) return;
  document.querySelectorAll(".seat").forEach(seat => {
    seat.addEventListener("click", () => { if (state.selectedStudentId) placeStudentInSeat(state.selectedStudentId, seat.dataset.seatId); });
    seat.addEventListener("dragover", event => { event.preventDefault(); seat.classList.add("drag-over"); });
    seat.addEventListener("dragleave", () => seat.classList.remove("drag-over"));
    seat.addEventListener("drop", event => {
      event.preventDefault();
      seat.classList.remove("drag-over");
      const studentId = event.dataTransfer.getData("text/plain");
      if (studentId) placeStudentInSeat(studentId, seat.dataset.seatId);
    });
  });
}
async function saveSeating() { try { await api("/admin/seating", { method: "PUT", body: JSON.stringify({ month: state.seatMonth, assignments: state.seating }) }); state.seatingDirty = false; $("saveSeatsBtn").innerHTML = '<i class="bi bi-check-lg me-1"></i>Đã lưu'; } catch (error) { alert(error.message); } }
function autoSeat() { const seats = Array.from({ length: 4 }, (_, g) => Array.from({ length: 5 }, (_, d) => [seatId(g + 1, d + 1, 1), seatId(g + 1, d + 1, 2)])).flat(2); state.seating = {}; state.students.slice().sort((a, b) => a.fullName.localeCompare(b.fullName, "vi")).forEach((student, index) => { if (seats[index]) state.seating[seats[index]] = student.id; }); state.selectedStudentId = null; markSeatingDirty(); renderSeating(); }
$("saveSeatsBtn").addEventListener("click", saveSeating); $("autoSeatBtn").addEventListener("click", autoSeat);

function renderLeaderboard() {
  const term = $("studentSearch").value.trim().toLocaleLowerCase("vi"); const rows = state.leaderboard.filter(student => student.fullName.toLocaleLowerCase("vi").includes(term));
  $("leaderboardInfo").textContent = `${state.leaderboard.length} học sinh · điểm được tính từ các lượt cộng/trừ đã lưu.`;
  $("leaderboardRows").innerHTML = rows.length ? rows.map(student => `<tr><td><strong>${student.rank}</strong></td><td><button class="student-chip p-0" data-student-id="${student.id}">${photoMarkup(student)}<span class="student-chip-text"><strong>${escapeHtml(student.fullName)}</strong><small>${student.groupNo ? `Tổ ${student.groupNo}` : "Chưa phân tổ"}</small></span></button></td><td>${student.groupNo ? `Tổ ${student.groupNo}` : "—"}</td><td class="text-end"><strong class="${student.total > 0 ? "positive" : student.total < 0 ? "negative" : ""}">${student.total > 0 ? "+" : ""}${formatNumber(student.total)}</strong></td><td class="admin-only ${isAdmin() ? "" : "d-none"} text-end"><button class="score-button plus" data-score="plus" data-student-id="${student.id}" aria-label="Cộng điểm">+</button><button class="score-button minus ms-1" data-score="minus" data-student-id="${student.id}" aria-label="Trừ điểm">−</button></td></tr>`).join("") : `<tr><td colspan="5">${emptyState("Không tìm thấy học sinh phù hợp.")}</td></tr>`;
  document.querySelectorAll("#leaderboardRows [data-student-id]").forEach(item => item.addEventListener("click", event => { const button = event.target.closest("[data-student-id]"); if (!button) return; if (button.dataset.score) { changeScore(button.dataset.studentId, button.dataset.score === "plus" ? 1 : -1); } else openStudent(button.dataset.studentId); }));
}
$("studentSearch").addEventListener("input", renderLeaderboard);
async function changeScore(studentId, direction) { const student = findStudent(studentId); const raw = prompt(`${direction > 0 ? "Cộng" : "Trừ"} điểm cho ${student.fullName}. Nhập số điểm dương:`, "1"); if (raw === null) return; const amount = Number(raw); if (!Number.isFinite(amount) || amount <= 0) return alert("Điểm phải là một số dương."); const reason = prompt("Nội dung / lý do (không bắt buộc):", "") ?? ""; try { await api("/admin/scores", { method: "POST", body: JSON.stringify({ studentId, delta: direction * amount, reason }) }); await loadClassData(); } catch (error) { alert(error.message); } }

/* Student profile and photo / group tools */
function studentScore(studentId) {
  return Number(state.leaderboard.find(student => student.id === studentId)?.total || 0);
}
function formatEventTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}
function renderScoreHistory(events) {
  const container = $("studentScoreHistory");
  if (!container) return;
  if (!events.length) {
    container.innerHTML = `<div class="score-history-empty">Chưa có lượt cộng hoặc trừ điểm.</div>`;
    return;
  }
  container.innerHTML = events.map(event => `<div class="score-event"><div><strong class="${event.delta > 0 ? "positive" : "negative"}">${event.delta > 0 ? "+" : ""}${formatNumber(event.delta)}</strong><span>${escapeHtml(event.reason || "Không ghi nội dung")}</span><small>${formatEventTime(event.createdAt)}</small></div><button class="remove-score-event" type="button" data-delete-score-id="${event.id}" aria-label="Xóa lượt điểm"><i class="bi bi-trash3"></i></button></div>`).join("");
  container.querySelectorAll("[data-delete-score-id]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Xóa lượt điểm này?")) return;
    try {
      await api(`/admin/scores/${button.dataset.deleteScoreId}`, { method: "DELETE" });
      await loadClassData();
      openStudent(state.activeStudentId);
    } catch (error) {
      alert(error.message);
    }
  }));
}
async function loadScoreHistory(studentId) {
  const container = $("studentScoreHistory");
  if (!container || !isAdmin()) return;
  try {
    const payload = await api(`/admin/students/${studentId}/scores`);
    if (state.activeStudentId === studentId) renderScoreHistory(payload.events || []);
  } catch (error) {
    if (state.activeStudentId === studentId && $("studentScoreHistory")) {
      $("studentScoreHistory").innerHTML = `<div class="score-history-empty">Không thể tải lịch sử điểm.</div>`;
    }
  }
}
function openStudent(studentId) {
  const student = findStudent(studentId);
  if (!student) return;
  state.activeStudentId = studentId;
  const total = studentScore(studentId);
  const adminTools = isAdmin() ? `<div class="student-detail-actions"><label>Họ và tên<input id="studentNameInput" value="${escapeHtml(student.fullName)}" maxlength="100"></label><label>Tổ<select id="groupSelect"><option value="">Chưa phân tổ</option>${[1, 2, 3, 4].map(group => `<option value="${group}" ${Number(student.groupNo) === group ? "selected" : ""}>Tổ ${group}</option>`).join("")}</select></label><button class="period-btn" type="button" id="saveStudentBtn"><i class="bi bi-check2 me-1"></i>Lưu hồ sơ</button><label class="period-btn"><i class="bi bi-image me-1"></i>Chọn ảnh<input id="photoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${student.photoUrl ? `<button class="period-btn" type="button" id="deletePhotoBtn"><i class="bi bi-trash3 me-1"></i>Xóa ảnh</button>` : ""}<button class="period-btn danger-outline" type="button" id="deleteStudentBtn"><i class="bi bi-person-x-fill me-1"></i>Xóa học sinh</button></div><section class="student-score-history-wrap"><div class="history-heading"><strong>Lịch sử điểm</strong><small>Có thể xóa từng lượt nếu nhập nhầm.</small></div><div id="studentScoreHistory"><div class="score-history-empty"><span class="spinner-border spinner-border-sm"></span> Đang tải lịch sử điểm…</div></div></section>` : "";
  $("studentDialogContent").innerHTML = `<div class="student-detail">${photoMarkup(student)}<div><div class="panel-kicker">HỌC SINH 11 TIN</div><h2>${escapeHtml(student.fullName)}</h2><p>${student.groupNo ? `Tổ ${student.groupNo}` : "Chưa phân tổ"} · <strong class="${total > 0 ? "positive" : total < 0 ? "negative" : ""}">${total > 0 ? "+" : ""}${formatNumber(total)} điểm</strong></p></div>${adminTools}</div>`;
  const dialog = $("studentDialog");
  if (!dialog.open) dialog.showModal();
  bindStudentDialog();
  if (isAdmin()) loadScoreHistory(studentId);
}
function bindStudentDialog() {
  $("studentDialog").querySelector("[data-close-dialog]")?.addEventListener("click", () => $("studentDialog").close());
  $("saveStudentBtn")?.addEventListener("click", async () => { try { await api(`/admin/students/${state.activeStudentId}`, { method: "PATCH", body: JSON.stringify({ fullName: $("studentNameInput").value, groupNo: $("groupSelect").value || null }) }); await loadClassData(); openStudent(state.activeStudentId); } catch (error) { alert(error.message); } });
  $("photoInput")?.addEventListener("change", async event => { const file = event.target.files[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) return alert("Ảnh không được vượt quá 5 MB."); const form = new FormData(); form.append("photo", file); try { await api(`/admin/students/${state.activeStudentId}/photo`, { method: "POST", body: form }); await loadClassData(); openStudent(state.activeStudentId); } catch (error) { alert(error.message); } });
  $("deletePhotoBtn")?.addEventListener("click", async () => { if (!confirm("Xóa ảnh của học sinh này?")) return; try { await api(`/admin/students/${state.activeStudentId}/photo`, { method: "DELETE" }); await loadClassData(); openStudent(state.activeStudentId); } catch (error) { alert(error.message); } });
  $("deleteStudentBtn")?.addEventListener("click", async () => { const student = findStudent(state.activeStudentId); if (!student || !confirm(`Xóa ${student.fullName} khỏi danh sách lớp?`)) return; try { await api(`/admin/students/${state.activeStudentId}`, { method: "DELETE" }); $("studentDialog").close(); state.activeStudentId = null; await loadClassData(); } catch (error) { alert(error.message); } });
}

$("addStudentBtn").addEventListener("click", async () => {
  const fullName = prompt("Nhập họ và tên học sinh mới:", "");
  if (fullName === null || !fullName.trim()) return;
  try {
    await api("/admin/students", { method: "POST", body: JSON.stringify({ fullName }) });
    await loadClassData();
  } catch (error) {
    alert(error.message);
  }
});

/* Hidden two-step admin entry. This is a convenience layer; server-side password validation is the protection. */
let triggerTimer;
$("adminTriggerOne").addEventListener("click", () => { $("adminTriggerTwo").classList.remove("d-none"); clearTimeout(triggerTimer); triggerTimer = setTimeout(() => $("adminTriggerTwo").classList.add("d-none"), 6000); });
$("adminTriggerTwo").addEventListener("click", () => { clearTimeout(triggerTimer); $("adminTriggerTwo").classList.add("d-none"); $("adminError").classList.add("d-none"); $("adminPassword").value = ""; $("adminDialog").showModal(); $("adminPassword").focus(); });
$("closeAdminDialog").addEventListener("click", () => $("adminDialog").close());
$("adminForm").addEventListener("submit", async event => { event.preventDefault(); const password = $("adminPassword").value; const error = $("adminError"); try { const session = await api("/admin/session", { method: "POST", body: JSON.stringify({ password }) }); state.adminToken = session.token; state.adminExpiresAt = Number(session.expiresAt) || 0; sessionStorage.setItem("11tin-admin-token", session.token); sessionStorage.setItem("11tin-admin-expires-at", String(state.adminExpiresAt)); $("adminDialog").close(); setAdminUI(); await loadClassData(); } catch (cause) { error.textContent = cause.message || "Không thể xác minh mật khẩu."; error.classList.remove("d-none"); } });
$("adminDialog").addEventListener("close", () => { $("adminPassword").value = ""; });

setInterval(() => { if (state.adminToken && !isAdmin()) { clearAdminSession(); setAdminUI(); } }, 60 * 1000);
setAdminUI(); loadSchoolData();
