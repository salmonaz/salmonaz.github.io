/* Frontend for Cloudflare Pages. Class competition data remains read-only from the school's public source. */
const SCHOOL_API = Object.freeze({
  firebaseConfig: {
    apiKey: "AIzaSyBZjf4cej0daDmPiL5JhjH_bFX7kQpKX0w",
    authDomain: "doanthptchuyenlequydon.firebaseapp.com",
    projectId: "doanthptchuyenlequydon",
    storageBucket: "doanthptchuyenlequydon.firebasestorage.app",
    messagingSenderId: "970274151332",
    appId: "1:970274151332:web:84eabed1b31b424173bf31"
  },
  classId: "MM2KGZwgLGLHDvod10ZW",
  summaryCacheKey: "thidua-11tin-summary-v4",
  individualCacheKey: "thidua-11tin-individual-v4",
  cacheMs: 5 * 60 * 1000,
  individualCacheMs: 60 * 1000
});

const $ = id => document.getElementById(id);
const root = document.documentElement;
const GROUP_NUMBERS = Object.freeze([1, 2, 3, 4]);
const defaultGroupLayout = () => ({ 1: 1, 2: 2, 3: 3, 4: 4 });
const state = {
  chart: null,
  records: [],
  students: [],
  manualLeaderboard: [],
  leaderboard: [],
  schoolRecordsState: "loading",
  schoolSummaryState: "loading",
  schoolSummaryPromise: null,
  schoolIndividualPromise: null,
  schoolEventsByStudent: new Map(),
  unmatchedSchoolRecords: [],
  seating: {},
  groupLayout: defaultGroupLayout(),
  adminToken: sessionStorage.getItem("11tin-admin-token") || "",
  adminExpiresAt: Number(sessionStorage.getItem("11tin-admin-expires-at") || 0),
  seatMonth: monthNow(),
  seatingDirty: false,
  activeStudentId: null,
  selectedStudentId: null,
  selectedGroupNo: null,
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
function normalizeSearchText(value) { return String(value || "").toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d"); }
function groupLayoutOrDefault(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaultGroupLayout();
  const layout = {};
  for (const position of GROUP_NUMBERS) {
    const group = Number(input[position]);
    if (!GROUP_NUMBERS.includes(group)) return defaultGroupLayout();
    layout[position] = group;
  }
  return new Set(Object.values(layout)).size === GROUP_NUMBERS.length ? layout : defaultGroupLayout();
}

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
  if (name === "individual") loadIndividualSchoolData();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll("[data-view-target]").forEach(element => element.addEventListener("click", event => { event.preventDefault(); showView(element.dataset.viewTarget); }));

/* School public data — same Firestore web client used by the school dashboard. */
let firebaseSchoolClientPromise;
async function getFirebaseSchoolClient() {
  if (!firebaseSchoolClientPromise) {
    firebaseSchoolClientPromise = Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js")
    ]).then(([appSdk, firestore]) => {
      const appName = "11tin-public-source";
      const app = appSdk.getApps().find(item => item.name === appName) || appSdk.initializeApp(SCHOOL_API.firebaseConfig, appName);
      return { db: firestore.getFirestore(app), firestore };
    });
  }
  return firebaseSchoolClientPromise;
}
function schoolTimestamp(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000).toISOString();
  return typeof value === "string" ? value : null;
}
function cacheSchoolData(key, data) { try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch {} }
function getCachedSchoolData(key, maxAge) {
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    return cached && Date.now() - cached.at < maxAge ? cached.data : null;
  } catch {
    return null;
  }
}
async function getSchoolData() {
  const { db, firestore } = await getFirebaseSchoolClient();
  const configSnapshot = await firestore.getDoc(firestore.doc(db, "site", "thidua"));
  if (!configSnapshot.exists()) throw new Error("Không tìm thấy cấu hình thi đua công khai.");
  const config = configSnapshot.data();
  if (!config.nienHoc) throw new Error("Nguồn chưa xác định niên học.");
  const [summarySnapshot, classesSnapshot] = await Promise.all([
    firestore.getDoc(firestore.doc(db, "thidua_tonghop", config.nienHoc)),
    firestore.getDocs(firestore.collection(db, "thidua_lops"))
  ]);
  const summaryData = summarySnapshot.exists() ? summarySnapshot.data() : {};
  return {
    config,
    classes: classesSnapshot.docs.map(item => ({ id: item.id, ...item.data() })),
    summary: summaryData.data || {},
    updatedAt: schoolTimestamp(summaryData.capNhat)
  };
}
async function getIndividualSchoolData() {
  const { db, firestore } = await getFirebaseSchoolClient();
  const [configSnapshot, recordsSnapshot] = await Promise.all([
    firestore.getDoc(firestore.doc(db, "site", "thidua")),
    firestore.getDocs(firestore.query(firestore.collection(db, "thidua_ghi"), firestore.where("lopId", "==", SCHOOL_API.classId)))
  ]);
  if (!configSnapshot.exists()) throw new Error("Không tìm thấy cấu hình thi đua công khai.");
  const config = configSnapshot.data();
  if (!config.nienHoc) throw new Error("Nguồn chưa xác định niên học.");
  const records = recordsSnapshot.docs.map(item => item.data()).filter(record => record.nienHoc === config.nienHoc && !record.daXoa);
  return { config, records };
}
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
function hasNumericScore(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }
function scoreClass(value) { return !hasNumericScore(value) ? "" : Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : ""; }
function signedScore(value) { return hasNumericScore(value) ? `${Number(value) > 0 ? "+" : ""}${formatNumber(value)}` : "—"; }
function hasManualAdjustment(value) { return hasNumericScore(value) && Number(value) !== 0; }
function schoolRecordsAvailable() { return ["ready", "refreshing", "stale"].includes(state.schoolRecordsState); }
function schoolPointData(students) {
  const aliases = new Map(); const totals = new Map(); const events = new Map(); const unmatched = [];
  students.forEach(student => {
    totals.set(student.id, 0); events.set(student.id, []);
    const key = normalizeSearchText(student.schoolName || student.fullName);
    if (!key) return;
    aliases.set(key, [...(aliases.get(key) || []), student.id]);
  });
  if (!schoolRecordsAvailable()) return { totals, events, unmatched };
  state.records.forEach(record => {
    const key = normalizeSearchText(record.hoTen); const score = Number(record.diem); const matches = aliases.get(key);
    if (!key || !Number.isFinite(score)) return;
    if (!matches || matches.length !== 1) { unmatched.push(record); return; }
    const studentId = matches[0]; totals.set(studentId, totals.get(studentId) + score); events.get(studentId).push(record);
  });
  return { totals, events, unmatched };
}
function refreshLeaderboard() {
  const sourceRows = state.manualLeaderboard || [];
  if (!sourceRows.length) { state.leaderboard = []; return; }
  const sourceReady = schoolRecordsAvailable(); const school = schoolPointData(sourceRows);
  state.schoolEventsByStudent = school.events; state.unmatchedSchoolRecords = school.unmatched;
  const rows = sourceRows.map(student => {
    const schoolTotal = sourceReady ? school.totals.get(student.id) || 0 : null;
    const manualTotal = Number(student.manualTotal ?? student.total ?? 0);
    const overrideTotal = hasNumericScore(student.overrideTotal) ? Number(student.overrideTotal) : null;
    const total = overrideTotal !== null ? overrideTotal : sourceReady ? schoolTotal + manualTotal : null;
    return { ...student, schoolTotal, manualTotal, overrideTotal, total };
  }).sort((left, right) => {
    const leftScore = hasNumericScore(left.total) ? Number(left.total) : Number.NEGATIVE_INFINITY;
    const rightScore = hasNumericScore(right.total) ? Number(right.total) : Number.NEGATIVE_INFINITY;
    return rightScore - leftScore || left.fullName.localeCompare(right.fullName, "vi");
  });
  let rank = 0; let previous;
  state.leaderboard = rows.map((student, index) => {
    if (!sourceReady || !hasNumericScore(student.total)) return { ...student, rank: null };
    if (previous === undefined || student.total !== previous) rank = index + 1;
    previous = student.total;
    return { ...student, rank };
  });
}
function renderSchoolRecords(records) {
  state.records = [...records].sort((a, b) => String(b.ngay || "").localeCompare(String(a.ngay || "")));
  refreshLeaderboard();
  if (!state.records.length) { const message = "Nguồn chưa có nhật ký công khai của 11 Tin trong năm học này."; $("activityList").innerHTML = emptyState(message); return; }
  $("activityList").innerHTML = state.records.slice(0, 4).map(item => { const positive = Number(item.diem) >= 0; return `<div class="activity-item"><div class="activity-icon ${positive ? "success" : "warning"}"><i class="bi bi-${positive ? "plus-lg" : "exclamation-lg"}"></i></div><div class="activity-content"><div class="activity-top"><strong>${escapeHtml(item.tenLoi || "Sự kiện thi đua")}</strong><span>${escapeHtml(item.ngay || "—")}</span></div><p>${escapeHtml(item.hoTen || "Lớp 11 Tin")}${item.ghiChu ? ` · ${escapeHtml(item.ghiChu)}` : ""}</p></div><div class="activity-points ${positive ? "positive" : "negative"}">${positive ? "+" : ""}${formatNumber(item.diem)}</div></div>`; }).join("");
}
function sourceStatus(name, message) { $("sourceStatus").textContent = name; $("updatedAt").innerHTML = `<i class="bi bi-clock-history"></i> ${message}`; }
async function loadSchoolData(force = false) {
  if (state.schoolSummaryPromise) return state.schoolSummaryPromise;

  const task = (async () => {
    const cached = getCachedSchoolData(SCHOOL_API.summaryCacheKey, SCHOOL_API.cacheMs);
    state.schoolSummaryState = cached ? "refreshing" : "loading";

    try {
      sourceStatus("Đang tải", "Đang kết nối nguồn dữ liệu");
      let data = !force ? cached : null;
      let usingCachedData = Boolean(data);

      if (!data) {
        try {
          data = await getSchoolData();
          cacheSchoolData(SCHOOL_API.summaryCacheKey, data);
        } catch (error) {
          if (!cached) throw error;
          console.warn("Không thể làm mới nguồn trường; dùng dữ liệu công khai đã lưu gần nhất.", error);
          data = cached;
          usingCachedData = true;
        }
      }

      state.schoolSummaryState = usingCachedData ? "stale" : "ready";
      $("schoolYear").textContent = data.config.nienHoc || "Chưa xác định";
      const hasEvents = Boolean(data.summary[SCHOOL_API.classId] && Object.keys(data.summary[SCHOOL_API.classId]).length);
      const updated = data.updatedAt ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(data.updatedAt)) : "chưa có thời điểm";
      const label = usingCachedData ? "Dữ liệu gần nhất" : hasEvents ? "Đã đồng bộ" : "Chưa phát sinh điểm";
      const message = usingCachedData ? `Đang dùng bản công khai gần nhất: ${updated}` : `Cập nhật nguồn: ${updated}`;
      sourceStatus(label, message);
      renderSchoolSummary(data);
    } catch (error) {
      console.error(error);
      state.schoolSummaryState = "error";
      const personalDataReady = schoolRecordsAvailable();
      sourceStatus(
        personalDataReady ? "Đồng bộ một phần" : "Lỗi tải dữ liệu",
        personalDataReady
          ? "Đã tải điểm cá nhân; bảng tổng hợp của trường đang chưa phản hồi"
          : "Không thể kết nối bảng tổng hợp của trường"
      );
      $("rankList").innerHTML = emptyState("Không thể tải dữ liệu thi đua. Vui lòng thử lại.");
      $("chartState").className = "data-state";
      $("chartState").innerHTML = emptyState("Không thể tải biểu đồ.");
    }
  })();

  state.schoolSummaryPromise = task.finally(() => { state.schoolSummaryPromise = null; });
  return state.schoolSummaryPromise;
}
async function loadIndividualSchoolData(force = false) {
  if (state.schoolIndividualPromise) return state.schoolIndividualPromise;

  const task = (async () => {
    const hadSchoolData = schoolRecordsAvailable();
    const cached = getCachedSchoolData(SCHOOL_API.individualCacheKey, SCHOOL_API.individualCacheMs);
    state.schoolRecordsState = hadSchoolData ? "refreshing" : "loading";
    refreshLeaderboard();
    if (state.manualLeaderboard.length) renderLeaderboard();

    try {
      let data = !force ? cached : null;
      let usingCachedData = Boolean(data);
      if (!data) {
        try {
          data = await getIndividualSchoolData();
          cacheSchoolData(SCHOOL_API.individualCacheKey, data);
        } catch (error) {
          if (!cached) throw error;
          console.warn("Không thể làm mới điểm cá nhân từ trường; dùng bản công khai gần nhất.", error);
          data = cached;
          usingCachedData = true;
          state.schoolRecordsState = "stale";
        }
      }

      if (state.schoolRecordsState !== "stale") state.schoolRecordsState = "ready";
      $("schoolYear").textContent = data.config.nienHoc || "Chưa xác định";
      renderSchoolRecords(data.records);
      if (state.manualLeaderboard.length) renderLeaderboard();
      if (state.schoolSummaryState === "error") {
        sourceStatus(
          "Đồng bộ một phần",
          usingCachedData
            ? "Đang dùng nhật ký điểm cá nhân gần nhất; bảng tổng hợp của trường đang chưa phản hồi"
            : "Đã tải điểm cá nhân; bảng tổng hợp của trường đang chưa phản hồi"
        );
      } else if (usingCachedData && state.schoolSummaryState === "stale") {
        sourceStatus("Dữ liệu gần nhất", "Đang dùng nhật ký công khai gần nhất của trường");
      }
    } catch (error) {
      console.error(error);
      state.schoolRecordsState = hadSchoolData ? "stale" : "error";
      refreshLeaderboard();
      if (!hadSchoolData) $("activityList").innerHTML = emptyState("Không thể đồng bộ nhật ký thi đua cá nhân từ trường.");
      if (state.manualLeaderboard.length) renderLeaderboard();
    }
  })();

  state.schoolIndividualPromise = task.finally(() => { state.schoolIndividualPromise = null; });
  return state.schoolIndividualPromise;
}
$("retryBtn").addEventListener("click", () => { loadSchoolData(true); loadIndividualSchoolData(true); });

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
  const admin = isAdmin();
  document.querySelectorAll(".admin-only").forEach(item => item.classList.toggle("d-none", !admin));
  $("seatingLayout")?.classList.toggle("public-seating", !admin);
}
async function logoutAdmin() {
  if (state.seatingDirty) {
    const shouldSave = confirm("Bạn đã thay đổi sơ đồ chỗ ngồi. Nhấn OK để lưu rồi đăng xuất; nhấn Hủy để ở lại.");
    if (!shouldSave || !await saveSeating()) return;
  }
  clearAdminSession();
  state.selectedStudentId = null;
  state.selectedGroupNo = null;
  state.dragFromSeatId = null;
  $("seatingSearch").value = "";
  if ($("studentDialog").open) $("studentDialog").close();
  setAdminUI();
  renderSeating();
  renderLeaderboard();
}
async function loadClassData() {
  try {
    const [studentsPayload, seatingPayload, boardPayload] = await Promise.all([api("/students"), api(`/seating?month=${encodeURIComponent(state.seatMonth)}`), api("/leaderboard")]);
    state.students = studentsPayload.students || []; state.seating = seatingPayload.assignments || {}; state.groupLayout = groupLayoutOrDefault(seatingPayload.groupLayout); state.manualLeaderboard = boardPayload.students || [];
    refreshLeaderboard(); setBackendProblem(false); renderSeating(); renderLeaderboard(); setAdminUI();
  } catch (error) { console.error(error); setBackendProblem(true); $("unseatedRoster").innerHTML = emptyState("Chưa thể tải dữ liệu lớp."); $("groupsGrid").innerHTML = emptyState("Chưa thể tải sơ đồ chỗ ngồi."); $("leaderboardRows").innerHTML = `<tr><td colspan="5">${emptyState("Chưa thể tải thi đua cá nhân.")}</td></tr>`; }
}
function photoMarkup(student) { return student.photoUrl ? `<img class="student-avatar" src="${escapeHtml(student.photoUrl)}" alt="Ảnh ${escapeHtml(student.fullName)}">` : `<span class="student-avatar">${escapeHtml(initials(student.fullName))}</span>`; }
function findStudent(id) { return state.students.find(student => student.id === id); }
function seatId(group, desk, side) { return `g${group}-d${desk}-s${side}`; }
const GROUP_DRAG_TYPE = "application/x-11tin-group";
function groupForSeatId(value) {
  const match = /^g([1-4])-d[1-5]-s[1-2]$/.exec(String(value || ""));
  return match ? Number(match[1]) : null;
}
function groupAtPosition(position) { return state.groupLayout[position] || position; }
function positionForGroup(group) { return GROUP_NUMBERS.find(position => groupAtPosition(position) === group) || group; }
function studentGroupLabel(student) { return student.groupNo ? `Tổ ${student.groupNo}` : isAdmin() ? "Chưa phân tổ" : ""; }
function syncGroupsFromSeating() {
  const groupsByStudent = new Map();
  Object.entries(state.seating).forEach(([seat, studentId]) => {
    const group = groupForSeatId(seat);
    if (group && studentId) groupsByStudent.set(studentId, group);
  });
  const applyGroups = students => students.map(student => groupsByStudent.has(student.id) ? { ...student, groupNo: groupsByStudent.get(student.id) } : student);
  state.students = applyGroups(state.students);
  state.manualLeaderboard = applyGroups(state.manualLeaderboard);
  refreshLeaderboard();
}
function swapGroupPositions(sourceGroup, targetGroup) {
  if (sourceGroup === targetGroup || !GROUP_NUMBERS.includes(sourceGroup) || !GROUP_NUMBERS.includes(targetGroup)) return;
  const sourcePosition = positionForGroup(sourceGroup);
  const targetPosition = positionForGroup(targetGroup);
  state.groupLayout = {
    ...state.groupLayout,
    [sourcePosition]: targetGroup,
    [targetPosition]: sourceGroup
  };
  state.selectedStudentId = null;
  state.selectedGroupNo = null;
  markSeatingDirty();
  renderSeating();
}
function renderSeating() {
  const assigned = new Set(Object.values(state.seating).filter(Boolean));
  const unseated = state.students.filter(student => !assigned.has(student.id));
  const term = normalizeSearchText($("seatingSearch").value.trim());
  const visibleStudents = term ? state.students.filter(student => normalizeSearchText(`${student.fullName} ${student.schoolName || ""}`).includes(term)) : unseated;
  $("rosterTitle").textContent = term ? "Kết quả tìm" : "Chưa xếp chỗ";
  $("unseatedCount").textContent = `${visibleStudents.length} HS`;
  $("unseatedRoster").innerHTML = visibleStudents.length ? visibleStudents.map(studentChip).join("") : term ? emptyState("Không tìm thấy học sinh phù hợp.") : `<div class="data-state"><i class="bi bi-check-circle"></i><strong>Đã xếp đủ chỗ.</strong><span>Toàn bộ học sinh đang ở trên sơ đồ.</span></div>`;
  $("groupsGrid").innerHTML = GROUP_NUMBERS.map(position => {
    const group = groupAtPosition(position);
    const selected = state.selectedGroupNo === group;
    const title = isAdmin() ? `<button class="group-drag-handle ${selected ? "is-selected" : ""}" type="button" data-group-drag="${group}" draggable="true" aria-pressed="${selected}" aria-label="Đổi vị trí Tổ ${group}" title="Kéo hoặc chạm để đổi vị trí tổ"><i class="bi bi-grip-vertical"></i><span>Tổ ${group}</span></button>` : `<span>Tổ ${group}</span>`;
    return `<section class="group-card ${selected ? "is-group-selected" : ""}" data-group-target="${group}" data-group-position="${position}"><div class="group-label">${title}<small>5 bàn · 10 chỗ</small></div><div class="desks">${Array.from({ length: 5 }, (_, deskIndex) => { const desk = deskIndex + 1; return `<div class="desk" data-desk="B${desk}"><div class="seat ${state.seating[seatId(group, desk, 1)] ? "" : "empty"}" data-seat-id="${seatId(group, desk, 1)}">${seatContent(state.seating[seatId(group, desk, 1)])}</div><div class="seat ${state.seating[seatId(group, desk, 2)] ? "" : "empty"}" data-seat-id="${seatId(group, desk, 2)}">${seatContent(state.seating[seatId(group, desk, 2)])}</div></div>`; }).join("")}</div></section>`;
  }).join("");
  bindSeatingEvents();
}
function studentChip(student) {
  const groupLabel = studentGroupLabel(student);
  return `<button class="student-chip ${state.selectedStudentId === student.id ? "is-selected" : ""}" data-student-id="${student.id}" draggable="${isAdmin() ? "true" : "false"}">${photoMarkup(student)}<span class="student-chip-text"><strong>${escapeHtml(student.fullName)}</strong>${groupLabel ? `<small>${escapeHtml(groupLabel)}</small>` : ""}</span></button>`;
}
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
  state.selectedGroupNo = null;
  state.dragFromSeatId = null;
  syncGroupsFromSeating();
  markSeatingDirty();
  renderSeating();
}
function selectStudentForSeat(studentId) {
  state.selectedGroupNo = null;
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
  document.querySelectorAll("[data-group-drag]").forEach(handle => {
    handle.addEventListener("click", event => {
      event.stopPropagation();
      const group = Number(handle.dataset.groupDrag);
      if (state.selectedGroupNo && state.selectedGroupNo !== group) return swapGroupPositions(state.selectedGroupNo, group);
      state.selectedStudentId = null;
      state.selectedGroupNo = state.selectedGroupNo === group ? null : group;
      renderSeating();
    });
    handle.addEventListener("dragstart", event => {
      event.dataTransfer.setData(GROUP_DRAG_TYPE, handle.dataset.groupDrag);
      event.dataTransfer.effectAllowed = "move";
      handle.classList.add("is-dragging");
    });
    handle.addEventListener("dragend", () => handle.classList.remove("is-dragging"));
  });
  document.querySelectorAll("[data-group-target]").forEach(card => {
    card.addEventListener("dragover", event => {
      if (!Array.from(event.dataTransfer?.types || []).includes(GROUP_DRAG_TYPE)) return;
      event.preventDefault();
      card.classList.add("group-drag-over");
    });
    card.addEventListener("dragleave", event => {
      if (!event.relatedTarget || !card.contains(event.relatedTarget)) card.classList.remove("group-drag-over");
    });
    card.addEventListener("drop", event => {
      const sourceGroup = Number(event.dataTransfer.getData(GROUP_DRAG_TYPE));
      const targetGroup = Number(card.dataset.groupTarget);
      if (!sourceGroup || !targetGroup) return;
      event.preventDefault();
      card.classList.remove("group-drag-over");
      swapGroupPositions(sourceGroup, targetGroup);
    });
  });
  document.querySelectorAll(".seat").forEach(seat => {
    seat.addEventListener("click", () => { if (state.selectedStudentId) placeStudentInSeat(state.selectedStudentId, seat.dataset.seatId); });
    seat.addEventListener("dragover", event => { if (!Array.from(event.dataTransfer?.types || []).includes("text/plain")) return; event.preventDefault(); seat.classList.add("drag-over"); });
    seat.addEventListener("dragleave", () => seat.classList.remove("drag-over"));
    seat.addEventListener("drop", event => {
      event.preventDefault();
      seat.classList.remove("drag-over");
      const studentId = event.dataTransfer.getData("text/plain");
      if (studentId) placeStudentInSeat(studentId, seat.dataset.seatId);
    });
  });
}
async function saveSeating() { try { await api("/admin/seating", { method: "PUT", body: JSON.stringify({ month: state.seatMonth, assignments: state.seating, groupLayout: state.groupLayout }) }); state.seatingDirty = false; $("saveSeatsBtn").innerHTML = '<i class="bi bi-check-lg me-1"></i>Đã lưu'; return true; } catch (error) { alert(error.message); return false; } }
function autoSeat() { const seats = Array.from({ length: 4 }, (_, g) => Array.from({ length: 5 }, (_, d) => [seatId(g + 1, d + 1, 1), seatId(g + 1, d + 1, 2)])).flat(2); state.seating = {}; state.students.slice().sort((a, b) => a.fullName.localeCompare(b.fullName, "vi")).forEach((student, index) => { if (seats[index]) state.seating[seats[index]] = student.id; }); state.selectedStudentId = null; state.selectedGroupNo = null; syncGroupsFromSeating(); markSeatingDirty(); renderSeating(); }
$("saveSeatsBtn").addEventListener("click", saveSeating);
$("autoSeatBtn").addEventListener("click", autoSeat);
$("seatingSearch").addEventListener("input", renderSeating);

function individualSourceText() {
  const count = state.leaderboard.length;
  if (state.schoolRecordsState === "loading") return `${count} học sinh · Đang đồng bộ điểm cá nhân từ trường…`;
  if (state.schoolRecordsState === "error") return `${count} học sinh · Không thể đồng bộ điểm trường, nên chưa xếp hạng.`;
  const source = state.schoolRecordsState === "refreshing" ? "Đang làm mới điểm trường" : state.schoolRecordsState === "stale" ? "Đang dùng lần đồng bộ trường gần nhất" : "Điểm trường đã đồng bộ";
  const unmatched = state.unmatchedSchoolRecords.length ? ` · ${state.unmatchedSchoolRecords.length} bản ghi chưa ghép tên` : "";
  return `${count} học sinh · ${source}${unmatched}.`;
}
function studentSourceNote(student) {
  if (!schoolRecordsAvailable()) return state.schoolRecordsState === "error" ? "Không thể đồng bộ điểm trường" : "Đang đồng bộ điểm trường";
  const pieces = [`Điểm trường ${signedScore(student.schoolTotal)}`];
  if (hasManualAdjustment(student.manualTotal)) pieces.push(`Điều chỉnh ${signedScore(student.manualTotal)}`);
  return student.overrideTotal !== null ? `Đang ghi đè · ${pieces.join(" · ")}` : pieces.join(" · ");
}
function renderLeaderboard() {
  const term = normalizeSearchText($("studentSearch").value.trim()); const rows = state.leaderboard.filter(student => normalizeSearchText(student.fullName).includes(term));
  $("leaderboardInfo").textContent = individualSourceText();
  $("leaderboardRows").innerHTML = rows.length ? rows.map(student => `<tr><td><strong>${student.rank ?? "—"}</strong></td><td><button class="student-chip p-0" data-student-id="${student.id}">${photoMarkup(student)}<span class="student-chip-text"><strong>${escapeHtml(student.fullName)}</strong><small>${student.groupNo ? `Tổ ${student.groupNo} · ` : ""}${escapeHtml(studentSourceNote(student))}</small></span></button></td><td>${student.groupNo ? `Tổ ${student.groupNo}` : "—"}</td><td class="text-end"><strong class="${scoreClass(student.total)}">${signedScore(student.total)}</strong>${student.overrideTotal !== null ? '<small class="score-value-note">Ghi đè</small>' : ""}</td><td class="admin-only ${isAdmin() ? "" : "d-none"} text-end"><button class="score-button plus" data-score="plus" data-student-id="${student.id}" aria-label="Cộng điểm">+</button><button class="score-button minus ms-1" data-score="minus" data-student-id="${student.id}" aria-label="Trừ điểm">−</button></td></tr>`).join("") : `<tr><td colspan="5">${emptyState("Không tìm thấy học sinh phù hợp.")}</td></tr>`;
  document.querySelectorAll("#leaderboardRows [data-student-id]").forEach(item => item.addEventListener("click", event => { const button = event.target.closest("[data-student-id]"); if (!button) return; if (button.dataset.score) { changeScore(button.dataset.studentId, button.dataset.score === "plus" ? 1 : -1); } else openStudent(button.dataset.studentId); }));
}
$("studentSearch").addEventListener("input", renderLeaderboard);
async function changeScore(studentId, direction) {
  const student = findStudent(studentId); if (!student) return;
  const raw = prompt(`${direction > 0 ? "Cộng" : "Trừ"} điểm thủ công cho ${student.fullName}. Nhập số điểm dương:`, "1");
  if (raw === null) return;
  const amount = Number(raw); if (!Number.isFinite(amount) || amount <= 0) return alert("Điểm phải là một số dương.");
  const reason = prompt("Nội dung / lý do (không bắt buộc):", "") ?? "";
  const reopen = state.activeStudentId === studentId && $("studentDialog").open;
  try {
    await api("/admin/scores", { method: "POST", body: JSON.stringify({ studentId, delta: direction * amount, reason }) });
    await loadClassData(); if (reopen) openStudent(studentId);
  } catch (error) { alert(error.message); }
}

/* Student profile and photo / group tools */
function leaderboardStudent(studentId) { return state.leaderboard.find(student => student.id === studentId); }
function studentScore(studentId) { return leaderboardStudent(studentId)?.total ?? null; }
function formatEventTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(date);
}
function schoolHistoryMarkup(studentId) {
  if (!schoolRecordsAvailable()) return `<div class="score-history-empty">${state.schoolRecordsState === "error" ? "Không thể tải điểm từ trường." : "Đang tải điểm từ trường…"}</div>`;
  const events = state.schoolEventsByStudent.get(studentId) || [];
  if (!events.length) return `<div class="score-history-empty">Chưa có bản ghi cá nhân từ trường.</div>`;
  return events.map(event => `<div class="score-event school-event"><div><strong class="${scoreClass(event.diem)}">${signedScore(event.diem)}</strong><span>${escapeHtml(event.tenLoi || "Sự kiện thi đua")}</span><small>${escapeHtml(event.ngay || "—")}${event.tuan ? ` · Tuần ${escapeHtml(event.tuan)}` : ""}${event.ghiChu ? ` · ${escapeHtml(event.ghiChu)}` : ""}</small></div></div>`).join("");
}
function manualHistoryMarkup(events) {
  if (!events.length) return `<div class="score-history-empty">Chưa có điều chỉnh thủ công.</div>`;
  return events.map(event => `<div class="score-event"><div><strong class="${scoreClass(event.delta)}">${signedScore(event.delta)}</strong><span>${escapeHtml(event.reason || "Không ghi nội dung")}</span><small>${formatEventTime(event.createdAt)}</small></div><button class="remove-score-event" type="button" data-delete-score-id="${event.id}" aria-label="Xóa lượt điểm"><i class="bi bi-trash3"></i></button></div>`).join("");
}
function renderScoreHistory(events, student, override) {
  const container = $("studentScoreHistory");
  if (!container) return;
  const overrideNotice = override ? `<div class="score-override-notice"><i class="bi bi-pencil-square"></i><span>Đang ghi đè: <strong class="${scoreClass(override.finalScore)}">${signedScore(override.finalScore)}</strong>${override.reason ? ` · ${escapeHtml(override.reason)}` : ""}</span></div>` : "";
  container.innerHTML = `<section class="score-history-section"><div class="history-heading"><strong>Điểm từ trường</strong><small>Đồng bộ từ nhật ký công khai</small></div>${schoolHistoryMarkup(student.id)}</section><section class="score-history-section"><div class="history-heading"><strong>Điều chỉnh thủ công</strong><small>Có thể xóa từng lượt nếu nhập nhầm.</small></div>${overrideNotice}${manualHistoryMarkup(events)}</section>`;
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
    const student = findStudent(studentId);
    if (state.activeStudentId === studentId && student) renderScoreHistory(payload.events || [], student, payload.override || null);
  } catch (error) {
    if (state.activeStudentId === studentId && $("studentScoreHistory")) {
      $("studentScoreHistory").innerHTML = `<div class="score-history-empty">Không thể tải lịch sử điểm.</div>`;
    }
  }
}
function scoreSummaryMarkup(score) {
  if (!score) return `<div class="student-score-summary pending"><span>Đang đồng bộ điểm từ trường…</span></div>`;
  const sourceReady = schoolRecordsAvailable();
  const sourceScore = sourceReady ? `<strong class="${scoreClass(score.schoolTotal)}">${signedScore(score.schoolTotal)}</strong>` : "<strong>—</strong>";
  const sourceNote = sourceReady ? "" : `<div class="student-score-source-note">${state.schoolRecordsState === "error" ? "Không thể tải điểm từ trường; chưa thể xếp hạng." : "Đang đồng bộ điểm từ trường; xếp hạng sẽ xuất hiện khi hoàn tất."}</div>`;
  const manualScore = hasManualAdjustment(score.manualTotal) ? `<span><small>Điều chỉnh</small><strong class="${scoreClass(score.manualTotal)}">${signedScore(score.manualTotal)}</strong></span>` : "";
  return `<div class="student-score-summary${score.overrideTotal !== null ? " is-overridden" : ""}"><span><small>Điểm</small>${sourceScore}</span>${manualScore}${score.overrideTotal !== null ? `<span><small>Điểm ghi đè</small><strong class="${scoreClass(score.overrideTotal)}">${signedScore(score.overrideTotal)}</strong></span>` : ""}</div>${sourceNote}`;
}
async function setScoreOverride(studentId) {
  const score = leaderboardStudent(studentId); const raw = prompt("Nhập điểm cuối muốn ghi đè (có thể âm hoặc bằng 0):", String(score?.overrideTotal ?? score?.total ?? 0));
  if (raw === null) return;
  const finalScore = Number(raw); if (!Number.isFinite(finalScore) || Math.abs(finalScore) > 1000) return alert("Điểm không hợp lệ.");
  const reason = prompt("Lý do ghi đè (không bắt buộc):", score?.overrideReason || "") ?? "";
  try { await api(`/admin/students/${studentId}/score-override`, { method: "PUT", body: JSON.stringify({ finalScore, reason }) }); await loadClassData(); openStudent(studentId); }
  catch (error) { alert(error.message); }
}
async function clearScoreOverride(studentId) {
  if (!confirm("Bỏ điểm ghi đè? Điểm sẽ trở lại: điểm trường + điều chỉnh thủ công.")) return;
  try { await api(`/admin/students/${studentId}/score-override`, { method: "DELETE" }); await loadClassData(); openStudent(studentId); }
  catch (error) { alert(error.message); }
}
async function resetScoreToSchool(studentId) {
  if (!confirm("Đặt lại điểm theo trường? Toàn bộ điều chỉnh thủ công và điểm ghi đè của học sinh này sẽ bị xóa.")) return;
  try { await api(`/admin/students/${studentId}/scores/reset`, { method: "POST" }); await loadClassData(); openStudent(studentId); }
  catch (error) { alert(error.message); }
}
function openStudent(studentId) {
  const student = findStudent(studentId);
  if (!student) return;
  state.activeStudentId = studentId;
  const score = leaderboardStudent(studentId); const total = studentScore(studentId);
  const groupLabel = studentGroupLabel(student);
  const adminTools = isAdmin() ? `<section class="student-score-tools"><div><strong>Điểm thủ công</strong><small>Cộng/trừ là điều chỉnh riêng; ghi đè thay toàn bộ điểm hiển thị.</small></div><div class="student-score-tool-buttons"><button class="period-btn" type="button" id="manualPlusBtn"><i class="bi bi-plus-lg me-1"></i>Cộng điểm</button><button class="period-btn" type="button" id="manualMinusBtn"><i class="bi bi-dash-lg me-1"></i>Trừ điểm</button><button class="period-btn" type="button" id="setScoreOverrideBtn"><i class="bi bi-pencil-square me-1"></i>Ghi đè điểm</button>${score?.overrideTotal !== null && score?.overrideTotal !== undefined ? `<button class="period-btn" type="button" id="clearScoreOverrideBtn"><i class="bi bi-arrow-counterclockwise me-1"></i>Bỏ ghi đè</button>` : ""}<button class="period-btn danger-outline" type="button" id="resetScoreBtn"><i class="bi bi-arrow-repeat me-1"></i>Đặt lại theo trường</button></div></section><div class="student-detail-actions"><label>Họ và tên<input id="studentNameInput" value="${escapeHtml(student.fullName)}" maxlength="100"></label><label>Tên trên nguồn trường<input id="schoolNameInput" value="${escapeHtml(student.schoolName || student.fullName)}" maxlength="100"></label><button class="period-btn" type="button" id="saveStudentBtn"><i class="bi bi-check2 me-1"></i>Lưu hồ sơ</button><label class="period-btn"><i class="bi bi-image me-1"></i>Chọn ảnh<input id="photoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${student.photoUrl ? `<button class="period-btn" type="button" id="deletePhotoBtn"><i class="bi bi-trash3 me-1"></i>Xóa ảnh</button>` : ""}<button class="period-btn danger-outline" type="button" id="deleteStudentBtn"><i class="bi bi-person-x-fill me-1"></i>Xóa học sinh</button></div><section class="student-score-history-wrap"><div id="studentScoreHistory"><div class="score-history-empty"><span class="spinner-border spinner-border-sm"></span> Đang tải lịch sử điểm…</div></div></section>` : "";
  $("studentDialogContent").innerHTML = `<div class="student-detail">${photoMarkup(student)}<div><div class="panel-kicker">HỌC SINH 11 TIN</div><h2>${escapeHtml(student.fullName)}</h2><p>${groupLabel ? `${escapeHtml(groupLabel)} · ` : ""}<strong class="${scoreClass(total)}">${signedScore(total)} điểm</strong></p>${scoreSummaryMarkup(score)}</div>${adminTools}</div>`;
  const dialog = $("studentDialog");
  if (!dialog.open) dialog.showModal();
  bindStudentDialog();
  if (isAdmin()) loadScoreHistory(studentId);
}
function bindStudentDialog() {
  $("studentDialog").querySelector("[data-close-dialog]")?.addEventListener("click", () => $("studentDialog").close());
  $("manualPlusBtn")?.addEventListener("click", () => changeScore(state.activeStudentId, 1));
  $("manualMinusBtn")?.addEventListener("click", () => changeScore(state.activeStudentId, -1));
  $("setScoreOverrideBtn")?.addEventListener("click", () => setScoreOverride(state.activeStudentId));
  $("clearScoreOverrideBtn")?.addEventListener("click", () => clearScoreOverride(state.activeStudentId));
  $("resetScoreBtn")?.addEventListener("click", () => resetScoreToSchool(state.activeStudentId));
  $("saveStudentBtn")?.addEventListener("click", async () => { try { await api(`/admin/students/${state.activeStudentId}`, { method: "PATCH", body: JSON.stringify({ fullName: $("studentNameInput").value, schoolName: $("schoolNameInput").value }) }); await loadClassData(); openStudent(state.activeStudentId); } catch (error) { alert(error.message); } });
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
$("adminLogoutBtn").addEventListener("click", logoutAdmin);
$("adminForm").addEventListener("submit", async event => { event.preventDefault(); const password = $("adminPassword").value; const error = $("adminError"); try { const session = await api("/admin/session", { method: "POST", body: JSON.stringify({ password }) }); state.adminToken = session.token; state.adminExpiresAt = Number(session.expiresAt) || 0; sessionStorage.setItem("11tin-admin-token", session.token); sessionStorage.setItem("11tin-admin-expires-at", String(state.adminExpiresAt)); $("adminDialog").close(); setAdminUI(); await loadClassData(); } catch (cause) { error.textContent = cause.message || "Không thể xác minh mật khẩu."; error.classList.remove("d-none"); } });
$("adminDialog").addEventListener("close", () => { $("adminPassword").value = ""; });
function closeDialogOnBackdrop(event) { if (event.target === event.currentTarget) event.currentTarget.close(); }
[$("adminDialog"), $("studentDialog")].forEach(dialog => dialog.addEventListener("click", closeDialogOnBackdrop));

setInterval(() => { if (state.adminToken && !isAdmin()) { clearAdminSession(); setAdminUI(); } }, 60 * 1000);
setAdminUI(); loadSchoolData(); loadIndividualSchoolData();
