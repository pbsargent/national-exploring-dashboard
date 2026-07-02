const state = {
  data: null,
  posts: [],
  filtered: [],
  quickFilter: "all",
  openCsts: new Set(),
  openCouncils: new Set(),
  selectedUnitId: null,
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en-US");
const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function asNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function shortDate(value) {
  if (!value) return "No date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function optionList(select, values, allLabel) {
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = allLabel;
  select.appendChild(all);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function metricBar(label, value, max, detail = "") {
  const row = document.createElement("div");
  row.className = "bar-row";
  row.innerHTML = `
    <div class="bar-label"><span>${label}</span><strong>${detail || fmt.format(value)}</strong></div>
    <div class="bar-track"><span style="width:${max ? Math.max(2, (value / max) * 100) : 0}%"></span></div>
  `;
  return row;
}

function renderBars(id, items, valueKey, labelKey, formatter = (v) => fmt.format(v)) {
  const target = $(id);
  target.innerHTML = "";
  const max = Math.max(...items.map((item) => asNumber(item[valueKey])), 1);
  items.forEach((item) => {
    target.appendChild(metricBar(item[labelKey], asNumber(item[valueKey]), max, formatter(item[valueKey], item)));
  });
}

function renderSummary() {
  const summary = state.data.summary;
  setText("updatedAt", `Source saved ${shortDate(state.data.sourceModifiedAt?.slice(0, 10))}`);
  setText("postCount", fmt.format(summary.posts));
  setText("needsAttention", `${fmt.format(summary.needsAttention)} need attention`);
  setText("youthCount", fmt.format(summary.totalYouth));
  setText("primaryYouth", fmt.format(summary.primaryYouth));
  setText("primaryDelta", `${summary.primaryYoy >= 0 ? "+" : ""}${fmt.format(summary.primaryYoy)} YOY`);
  setText("avgMetric", oneDecimal.format(summary.averageMetric));
  setText("trainingRate", `${pct.format(summary.trainingRate)} with metric credit`);
  setText("councilCount", fmt.format(summary.councils));
}

function passesQuickFilter(post) {
  if (state.quickFilter === "growth") return post.primaryYoy > 0;
  if (state.quickFilter === "attention") return post.health === "Needs attention";
  if (state.quickFilter === "renewal") {
    if (!post.renewalDate) return false;
    const renewal = new Date(`${post.renewalDate}T00:00:00`);
    const cutoff = new Date("2026-11-01T00:00:00");
    return renewal <= cutoff;
  }
  return true;
}

function applyFilters() {
  const search = $("searchInput").value.trim().toLowerCase();
  const cst = $("cstFilter").value;
  const focus = $("focusFilter").value;
  const health = $("healthFilter").value;

  state.filtered = state.posts.filter((post) => {
    const haystack = [
      post.postName,
      post.council,
      post.district,
      post.charterOrg,
      post.unitNumber,
    ].join(" ").toLowerCase();
    return (!search || haystack.includes(search))
      && (cst === "all" || String(post.cst) === cst)
      && (focus === "all" || post.focus === focus)
      && (health === "all" || post.health === health)
      && passesQuickFilter(post);
  });

  setText("filteredCount", `${fmt.format(state.filtered.length)} posts in current view`);
  setText("visibleCount", `${fmt.format(state.filtered.length)} posts`);
  renderBoard();
}

function groupByCst(posts) {
  return posts.reduce((groups, post) => {
    const key = `CST ${post.cst || "Unassigned"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
    return groups;
  }, new Map());
}

function groupRows(rows, key) {
  const groups = new Map();
  rows.forEach((row) => {
    const name = row[key] || "Unassigned";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  });
  return Array.from(groups, ([name, groupRowsForName]) => ({
    name,
    rows: groupRowsForName,
    youth: groupRowsForName.reduce((sum, post) => sum + asNumber(post.totalYouth), 0),
  }));
}

function metricLabel(post) {
  if (post.unitMetric >= 4) return "Strong";
  if (post.unitMetric >= 2) return "Watch";
  return "Risk";
}

function healthLabel(value) {
  return value ? "Healthy" : "Needs Attention";
}

function trainingLabel(post) {
  if (post.ulTrained && post.ccTrained) return "Complete";
  if (post.ulTrained || post.ccTrained || post.trained) return "Partial";
  return "Gap";
}

function renewalLabel(post) {
  if (!post.renewalDate) return "Unscheduled";
  const generated = new Date(state.data.generatedAt);
  const renewal = new Date(`${post.renewalDate}T00:00:00`);
  const days = (renewal - generated) / 86400000;
  if (days >= 0 && days <= 120) return "Next 120";
  if (renewal < generated) return "Past";
  return "Later";
}

function statusClass(label) {
  const normalized = String(label).toLowerCase();
  if (["healthy", "complete", "strong"].includes(normalized)) return "good";
  if (["partial", "watch", "next 120"].includes(normalized)) return "warn";
  if (["needs attention", "gap", "risk", "past"].includes(normalized)) return "bad";
  return "neutral";
}

function countsFor(rows, getter) {
  const counts = new Map();
  rows.forEach((row) => {
    const label = getter(row);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const order = {
    Healthy: 0,
    Complete: 0,
    Strong: 0,
    "Next 120": 1,
    Partial: 1,
    Watch: 1,
    Later: 2,
    "Needs Attention": 3,
    Gap: 3,
    Risk: 3,
    Past: 3,
    Unscheduled: 4,
  };
  return Array.from(counts, ([label, count]) => ({ label, count })).sort(
    (a, b) => (order[a.label] ?? 9) - (order[b.label] ?? 9) || a.label.localeCompare(b.label)
  );
}

function stageCell(rows, label, getter) {
  const counts = countsFor(rows, getter);
  const total = rows.length || 1;
  const main = counts[0] || { label: "None", count: 0 };
  return `
    <div class="stage-cell" title="${escapeHtml(counts.map((item) => `${item.label}: ${item.count}`).join("; "))}">
      <div class="stage-label"><span>${escapeHtml(label)}</span><span>${escapeHtml(main.label)} ${fmt.format(main.count)}</span></div>
      <div class="track stacked">
        ${counts.map((item) => `<span class="seg ${statusClass(item.label)}" style="width:${(item.count / total) * 100}%"></span>`).join("")}
      </div>
    </div>
  `;
}

function rowStages(rows) {
  return `
    ${stageCell(rows, "Size", (post) => healthLabel(post.sizeHealthy))}
    ${stageCell(rows, "Growth", (post) => healthLabel(post.growthHealthy))}
    ${stageCell(rows, "Leadership", (post) => healthLabel(post.youthLeadershipHealthy))}
    ${stageCell(rows, "Outdoor", (post) => healthLabel(post.outdoorHealthy))}
    ${stageCell(rows, "Training", trainingLabel)}
    ${stageCell(rows, "Renewal", renewalLabel)}
    ${stageCell(rows, "Metric", metricLabel)}
  `;
}

function progressFor(rows) {
  if (!rows.length) return 0;
  const signals = rows.reduce((total, post) => {
    return total
      + Number(Boolean(post.sizeHealthy))
      + Number(Boolean(post.growthHealthy))
      + Number(Boolean(post.youthLeadershipHealthy))
      + Number(Boolean(post.outdoorHealthy))
      + Number(trainingLabel(post) === "Complete")
      + Number(post.unitMetric >= 3);
  }, 0);
  return Math.round((signals / (rows.length * 6)) * 100);
}

function postPills(post) {
  return [
    ["Size", healthLabel(post.sizeHealthy)],
    ["Growth", healthLabel(post.growthHealthy)],
    ["Leadership", healthLabel(post.youthLeadershipHealthy)],
    ["Outdoor", healthLabel(post.outdoorHealthy)],
    ["Training", trainingLabel(post)],
    ["Renewal", renewalLabel(post)],
    ["Metric", metricLabel(post)],
  ].map(([label, value]) => `<span class="status-chip ${statusClass(value)}" title="${escapeHtml(label)}">${escapeHtml(value)}</span>`).join("");
}

function renderBoard() {
  const target = $("groupRows");
  const cstGroups = groupRows(state.filtered, "cst").sort((a, b) => Number(a.name) - Number(b.name));
  target.innerHTML = `
    <div class="board-header" aria-hidden="true">
      <span>Group</span><span>Progress</span><span>Size</span><span>Growth</span><span>Leadership</span><span>Outdoor</span><span>Training</span><span>Renewal</span><span>Metric</span>
    </div>
    ${cstGroups.map((cstGroup) => renderCstGroup(cstGroup)).join("") || `<div class="empty-state">No posts match the current filters.</div>`}
  `;
}

function renderCstGroup(cstGroup) {
  const cstKey = String(cstGroup.name);
  const open = state.openCsts.has(cstKey);
  const councilGroups = groupRows(cstGroup.rows, "council").sort((a, b) => b.rows.length - a.rows.length || b.youth - a.youth);
  const progress = progressFor(cstGroup.rows);
  return `
    <article class="service-block${open ? " open" : ""}">
      <button class="service-row" type="button" data-cst="${escapeHtml(cstKey)}" aria-expanded="${open}">
        <div class="district-cell">
          <span class="district-stripe"></span>
          <span class="disclosure" aria-hidden="true">›</span>
          <span class="district-title">
            <strong>CST ${escapeHtml(cstKey)}</strong>
            <span>${fmt.format(cstGroup.rows.length)} posts · ${fmt.format(councilGroups.length)} councils · ${fmt.format(cstGroup.youth)} youth</span>
          </span>
        </div>
        <div class="progress-cell">
          <span class="progress-number">${progress}%</span>
          <div class="track"><div class="fill" style="--w:${progress}%"></div></div>
        </div>
        ${rowStages(cstGroup.rows)}
      </button>
      <div class="district-list">
        ${councilGroups.map((group) => renderCouncilGroup(group, cstKey)).join("")}
      </div>
    </article>
  `;
}

function renderCouncilGroup(group, cstKey) {
  const councilKey = `${cstKey}|${group.name}`;
  const open = state.openCouncils.has(councilKey);
  const progress = progressFor(group.rows);
  return `
    <article class="council-block${open ? " open" : ""}">
      <button class="council-row" type="button" data-council="${escapeHtml(councilKey)}" aria-expanded="${open}">
        <div class="district-cell">
          <span class="district-stripe"></span>
          <span class="disclosure" aria-hidden="true">›</span>
          <span class="district-title">
            <strong>${escapeHtml(group.name)}</strong>
            <span>${fmt.format(group.rows.length)} posts · ${fmt.format(group.youth)} youth</span>
          </span>
        </div>
        <div class="progress-cell">
          <span class="progress-number">${progress}%</span>
          <div class="track"><div class="fill" style="--w:${progress}%"></div></div>
        </div>
        ${rowStages(group.rows)}
      </button>
      <div class="post-list">
        ${group.rows.slice().sort((a, b) => b.totalYouth - a.totalYouth).map(renderPostRow).join("")}
      </div>
    </article>
  `;
}

function renderPostRow(post) {
  return `
    <button class="post-row${state.selectedUnitId === post.unitId ? " selected" : ""}" type="button" data-unit-id="${escapeHtml(post.unitId)}">
      <strong>${escapeHtml(post.unitType)} ${escapeHtml(post.unitNumber || post.unitId)}</strong>
      <span class="post-descriptor">
        <span class="row-meta"><b>Name:</b> ${escapeHtml(post.postName)}</span>
        <span class="row-meta"><b>Focus:</b> ${escapeHtml(post.focus || "General")}</span>
      </span>
      <span class="row-meta">${fmt.format(post.totalYouth)} youth · ${post.metricYouthYoy >= 0 ? "+" : ""}${fmt.format(post.metricYouthYoy)}</span>
      <span class="row-meta">${shortDate(post.renewalDate)}</span>
      <span class="post-statuses">${postPills(post)}</span>
    </button>
  `;
}

function renderDetail(post) {
  const target = $("postDetail");
  state.selectedUnitId = post.unitId;
  target.className = "post-detail";
  target.innerHTML = `
    <p class="eyebrow">Post detail</p>
    <h2>${post.postName}</h2>
    <dl>
      <dt>Council</dt><dd>${post.council}</dd>
      <dt>District</dt><dd>${post.district || "Not listed"}</dd>
      <dt>Charter org</dt><dd>${post.charterOrg || "Not listed"}</dd>
      <dt>Renewal</dt><dd>${shortDate(post.renewalDate)} ${post.renewalStatus ? `(${post.renewalStatus})` : ""}</dd>
      <dt>Youth</dt><dd>${fmt.format(post.totalYouth)} total, ${fmt.format(post.primaryYouth)} primary</dd>
      <dt>YOY</dt><dd>${post.primaryYoy >= 0 ? "+" : ""}${fmt.format(post.primaryYoy)}</dd>
      <dt>Unit metric</dt><dd>${oneDecimal.format(post.unitMetric)}</dd>
      <dt>Size</dt><dd>${healthLabel(post.sizeHealthy)}</dd>
      <dt>Growth</dt><dd>${healthLabel(post.growthHealthy)}</dd>
      <dt>Leadership</dt><dd>${healthLabel(post.youthLeadershipHealthy)}</dd>
      <dt>Outdoor</dt><dd>${healthLabel(post.outdoorHealthy)}</dd>
      <dt>Training</dt><dd>${trainingLabel(post)} (UL ${post.ulTrained ? "Yes" : "No"}, CC ${post.ccTrained ? "Yes" : "No"})</dd>
      <dt>Retention</dt><dd>${pct.format(post.retention || 0)}</dd>
      <dt>Focus</dt><dd>${post.focus}</dd>
    </dl>
  `;
}

function renderBreakdowns() {
  renderBars(
    "cstBars",
    state.data.cstSummary,
    "totalYouth",
    "cst",
    (value, item) => `${fmt.format(value)} youth | ${fmt.format(item.posts)} posts`,
  );
  document.querySelectorAll("#cstBars .bar-label span").forEach((span) => {
    span.textContent = `CST ${span.textContent}`;
  });
  renderBars(
    "councilBars",
    state.data.councilSummary.slice(0, 12),
    "totalYouth",
    "council",
    (value, item) => `${fmt.format(value)} youth | ${fmt.format(item.posts)} posts`,
  );
  const focusItems = Object.entries(state.data.breakdowns.focusCounts).map(([focus, count]) => ({ focus, count }));
  renderBars("focusBars", focusItems, "count", "focus");
  const renewalItems = Object.entries(state.data.breakdowns.renewalStatusCounts)
    .slice(0, 10)
    .map(([status, count]) => ({ status, count }));
  renderBars("renewalBars", renewalItems, "count", "status");
  renderBars(
    "metricBars",
    state.data.metricByCst,
    "averageMetric",
    "cst",
    (value, item) => `${oneDecimal.format(value)} avg | ${pct.format(item.growthRate)} growth`,
  );
  document.querySelectorAll("#metricBars .bar-label span").forEach((span) => {
    span.textContent = `CST ${span.textContent}`;
  });
}

function initFilters() {
  optionList($("cstFilter"), state.data.cstSummary.map((row) => String(row.cst)), "All CSTs");
  optionList($("focusFilter"), state.data.filters.focuses, "All focus areas");
  optionList($("healthFilter"), ["Strong", "Watch", "Needs attention"], "All health");
  ["searchInput", "cstFilter", "focusFilter", "healthFilter"].forEach((id) => {
    $(id).addEventListener("input", applyFilters);
    $(id).addEventListener("change", applyFilters);
  });
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((item) => item.classList.remove("active"));
      chip.classList.add("active");
      state.quickFilter = chip.dataset.filter;
      applyFilters();
    });
  });
  $("collapseAll").addEventListener("click", () => {
    state.openCsts.clear();
    state.openCouncils.clear();
    renderBoard();
  });
  $("expandAll").addEventListener("click", () => {
    groupRows(state.filtered, "cst").forEach((cstGroup) => {
      const cstKey = String(cstGroup.name);
      state.openCsts.add(cstKey);
      groupRows(cstGroup.rows, "council").forEach((councilGroup) => {
        state.openCouncils.add(`${cstKey}|${councilGroup.name}`);
      });
    });
    renderBoard();
  });
  $("groupRows").addEventListener("click", (event) => {
    const serviceRow = event.target.closest(".service-row");
    const councilRow = event.target.closest(".council-row");
    const postButton = event.target.closest(".post-row");
    if (serviceRow) {
      const cst = serviceRow.dataset.cst;
      if (state.openCsts.has(cst)) state.openCsts.delete(cst);
      else state.openCsts.add(cst);
      renderBoard();
      return;
    }
    if (councilRow) {
      const council = councilRow.dataset.council;
      if (state.openCouncils.has(council)) state.openCouncils.delete(council);
      else state.openCouncils.add(council);
      renderBoard();
      return;
    }
    if (postButton) {
      const post = state.posts.find((item) => String(item.unitId) === postButton.dataset.unitId);
      if (post) {
        document.querySelectorAll(".post-row.selected").forEach((row) => row.classList.remove("selected"));
        postButton.classList.add("selected");
        renderDetail(post);
      }
    }
  });
}

async function start() {
  const response = await fetch("../data/national-exploring-dashboard-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load dashboard data: ${response.status}`);
  state.data = await response.json();
  state.posts = state.data.posts;
  state.filtered = state.posts;
  state.data.cstSummary.forEach((row) => state.openCsts.add(String(row.cst)));
  renderSummary();
  renderBreakdowns();
  initFilters();
  applyFilters();
}

start().catch((error) => {
  document.body.innerHTML = `<main class="load-error"><h1>Dashboard failed to load</h1><p>${error.message}</p></main>`;
});
