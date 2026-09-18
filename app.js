/* ==========================================================================
   Schichtprotokoll – App-Logik
   Alle Daten werden ausschliesslich lokal im Browser (localStorage)
   gespeichert. Kein Server, keine Übertragung.
   ========================================================================== */
"use strict";

(function () {
  var STORAGE_KEY = "schichtprotokoll_v1";
  var MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  var WEEKDAYS_LONG = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
  var SHIFT_PRESETS = ["Früh", "Spät", "Nacht", "Tag"];
  var COLOR_SWATCHES = ["#3B7DD8","#7C4FE0","#C7862A","#2E9E6D","#D8546F","#4FA8A0","#8A6D4F","#5C6BC0","#C2554A","#4C8C3C"];

  /* ---------------------------------------------------------------------
     State
     --------------------------------------------------------------------- */
  var state = null;

  function defaultState() {
    return {
      categories: [
        { id: "kat_kollege", name: "Kollege", color: "#3B7DD8", builtin: true },
        { id: "kat_arzt", name: "Arzt/Ärztin", color: "#7C4FE0", builtin: true },
        { id: "kat_leitung", name: "Leitung", color: "#C7862A", builtin: true }
      ],
      people: [],
      entries: [],
      shifts: [],
      settings: { theme: "system", lastShiftType: "Früh" }
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();
      parsed.categories = parsed.categories || defaultState().categories;
      parsed.people = parsed.people || [];
      parsed.entries = parsed.entries || [];
      parsed.shifts = parsed.shifts || [];
      parsed.settings = parsed.settings || { theme: "system", lastShiftType: "Früh" };
      return parsed;
    } catch (e) {
      console.error("Fehler beim Laden der Daten:", e);
      return defaultState();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Fehler beim Speichern:", e);
      toast("Speichern fehlgeschlagen – Speicher evtl. voll.");
    }
  }

  /* ---------------------------------------------------------------------
     Helpers
     --------------------------------------------------------------------- */
  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function dateToKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function todayKey() { return dateToKey(new Date()); }

  function formatTime(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  function formatDateShort(d) { return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear(); }

  function formatDateTimeLabel(d) {
    var key = dateToKey(d);
    if (key === todayKey()) return "Heute · " + formatTime(d);
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (key === dateToKey(y)) return "Gestern · " + formatTime(d);
    return formatDateShort(d) + " · " + formatTime(d);
  }

  function formatDayHeading(key) {
    if (key === todayKey()) return "Heute";
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (key === dateToKey(y)) return "Gestern";
    var parts = key.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return WEEKDAYS_LONG[d.getDay()] + ", " + d.getDate() + ". " + MONTHS[d.getMonth()];
  }

  function toDateInputValue(d) { return dateToKey(d); }

  function toDateTimeLocalValue(d) {
    return dateToKey(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function getCategory(id) {
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i];
    return null;
  }
  function getPerson(id) {
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === id) return state.people[i];
    return null;
  }
  function categoryColorForPerson(personId) {
    var p = getPerson(personId);
    if (!p) return null;
    var c = getCategory(p.categoryId);
    return c ? c.color : null;
  }
  function entryAccentColor(entry) {
    if (entry.personIds && entry.personIds.length) {
      var col = categoryColorForPerson(entry.personIds[0]);
      if (col) return col;
    }
    return null;
  }

  /* ---------------------------------------------------------------------
     Hashtags (optional, frei getippt im Eintragstext, z. B. #Station3,
     #Zimmer12, #Sturz). Werden beim Speichern aus dem Text extrahiert und
     lassen sich im Kalender-Filter durchsuchen.
     --------------------------------------------------------------------- */
  var HASHTAG_RE = /#([\p{L}\p{N}_-]+)/gu;

  function extractHashtags(text) {
    var seen = {}, result = [];
    HASHTAG_RE.lastIndex = 0;
    var m;
    while ((m = HASHTAG_RE.exec(text || ""))) {
      var key = m[1].toLowerCase();
      if (!seen[key]) { seen[key] = true; result.push(key); }
    }
    return result;
  }

  function getHashtagCounts() {
    var counts = {};
    state.entries.forEach(function (e) {
      (e.hashtags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    return counts;
  }

  function getTopHashtags(limit) {
    var counts = getHashtagCounts();
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    return typeof limit === "number" ? tags.slice(0, limit) : tags;
  }

  /* ---------------------------------------------------------------------
     Toast
     --------------------------------------------------------------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  /* ---------------------------------------------------------------------
     Onboarding (Einführungs-Wizard)
     Erscheint automatisch beim allerersten Start (eigener localStorage-
     Schlüssel, unabhängig vom Daten-State – bleibt also auch nach
     "Alle Daten löschen" auf "gesehen"). Über "Mehr" jederzeit erneut
     aufrufbar. Weist explizit auf die rein lokale Datenspeicherung hin.
     --------------------------------------------------------------------- */
  var ONBOARDING_KEY = "schichtprotokoll_onboarding_v1";
  var ONBOARDING_STEPS = [
    {
      icon: "👋",
      title: "Willkommen beim Schichtprotokoll",
      body: [
        "Dieses Tool hilft dir, während der Arbeit im Spital schnell festzuhalten, was passiert ist – und wer wann involviert war.",
        "Kurz, einfach und für unterwegs am Smartphone gemacht."
      ]
    },
    {
      icon: "✎",
      title: "Schnell erfassen",
      body: [
        "Unter „Neu“ tippst du kurz ein, was passiert ist, wählst beteiligte Personen per Chip aus (Kollege, Arzt, Leitung oder eigene Kategorien) und kannst mit #Hashtags z. B. Station, Zimmer oder Thema markieren.",
        "Log und Kalender helfen dir später, alles wiederzufinden und zu filtern."
      ]
    },
    {
      icon: "🔒",
      title: "Wichtig: Wo deine Daten liegen",
      highlight: true,
      body: [
        "Alle Einträge, Kontakte und Schicht-Fotos werden ausschliesslich lokal in diesem Browser auf diesem Gerät gespeichert – nichts wird an einen Server übertragen.",
        "Das heisst aber auch: Die Daten erscheinen nicht automatisch auf einem anderen Gerät oder in einem anderen Browser. Werden Browserdaten gelöscht oder ein privater/Inkognito-Modus genutzt, können Einträge verloren gehen.",
        "Tipp: Exportiere deine Daten regelmässig als JSON (unter „Mehr“) – das ist dein Backup und enthält auch die Schicht-Fotos. Über „Importieren“ spielst du sie auf einem anderen Gerät wieder ein."
      ]
    },
    {
      icon: "🚀",
      title: "Los geht's",
      body: [
        "Export, Import und diese Einführung findest du jederzeit unter „Mehr“.",
        "Viel Erfolg im Dienst!"
      ]
    }
  ];

  function renderOnboarding(step) {
    var root = document.getElementById("onboardingRoot");
    var total = ONBOARDING_STEPS.length;
    var s = ONBOARDING_STEPS[step];
    var isFirst = step === 0;
    var isLast = step === total - 1;

    var dots = ONBOARDING_STEPS.map(function (_, i) {
      return '<span class="onboarding-dot' + (i === step ? " is-active" : "") + '"></span>';
    }).join("");
    var bodyHtml = s.body.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");

    root.innerHTML =
      '<div class="onboarding-overlay" id="onboardingOverlay" role="dialog" aria-modal="true" aria-label="Einführung">' +
        '<div class="onboarding-card">' +
          '<button type="button" class="onboarding-skip" id="onboardingSkip">Überspringen</button>' +
          '<div class="onboarding-icon-badge" aria-hidden="true">' + s.icon + '</div>' +
          '<h2 class="onboarding-title">' + esc(s.title) + '</h2>' +
          '<div class="onboarding-body' + (s.highlight ? " onboarding-highlight" : "") + '">' + bodyHtml + '</div>' +
          '<div class="onboarding-dots">' + dots + '</div>' +
          '<div class="onboarding-nav">' +
            (isFirst ? "<span></span>" : '<button type="button" class="btn btn--ghost" id="onboardingBack">Zurück</button>') +
            '<button type="button" class="btn btn--primary" id="onboardingNext">' + (isLast ? "Los geht's" : "Weiter") + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById("onboardingSkip").addEventListener("click", closeOnboarding);
    document.getElementById("onboardingOverlay").addEventListener("click", function (e) {
      if (e.target.id === "onboardingOverlay") closeOnboarding();
    });
    if (!isFirst) {
      document.getElementById("onboardingBack").addEventListener("click", function () { renderOnboarding(step - 1); });
    }
    document.getElementById("onboardingNext").addEventListener("click", function () {
      if (isLast) closeOnboarding(); else renderOnboarding(step + 1);
    });
  }

  function closeOnboarding() {
    document.getElementById("onboardingRoot").innerHTML = "";
    try { localStorage.setItem(ONBOARDING_KEY, "seen"); } catch (e) { /* ignore */ }
  }

  function maybeShowOnboarding() {
    var seen = null;
    try { seen = localStorage.getItem(ONBOARDING_KEY); } catch (e) { /* ignore */ }
    if (!seen) renderOnboarding(0);
  }

  /* ---------------------------------------------------------------------
     Modal system
     --------------------------------------------------------------------- */
  function closeModal() {
    var root = document.getElementById("modalRoot");
    root.innerHTML = "";
  }

  function openModal(titleHTML, bodyHTML) {
    var root = document.getElementById("modalRoot");
    root.innerHTML =
      '<div class="modal-overlay" data-overlay>' +
        '<div class="modal-sheet" role="dialog" aria-modal="true">' +
          '<div class="modal-sheet__handle"></div>' +
          '<h3>' + titleHTML + '</h3>' +
          bodyHTML +
        '</div>' +
      '</div>';
    var overlay = root.querySelector("[data-overlay]");
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    root.querySelectorAll("[data-close-modal]").forEach(function (b) {
      b.addEventListener("click", closeModal);
    });
    return root.querySelector(".modal-sheet");
  }

  function confirmDialog(message, confirmLabel, danger) {
    return new Promise(function (resolve) {
      var sheet = openModal("Bitte bestätigen", '<p class="modal-text">' + esc(message) + '</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn--ghost" data-cancel>Abbrechen</button>' +
          '<button type="button" class="btn ' + (danger ? "btn--danger" : "btn--primary") + '" data-ok>' + esc(confirmLabel || "OK") + '</button>' +
        '</div>');
      sheet.querySelector("[data-cancel]").addEventListener("click", function () { closeModal(); resolve(false); });
      sheet.querySelector("[data-ok]").addEventListener("click", function () { closeModal(); resolve(true); });
    });
  }

  /* ---------------------------------------------------------------------
     Navigation
     --------------------------------------------------------------------- */
  function showView(name) {
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll(".nav-btn").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.nav === name);
    });
    if (name === "log") renderLog();
    if (name === "kalender") renderCalendar();
    if (name === "kontakte") renderKontakte();
    if (name === "mehr") renderMehr();
    if (name === "start") { renderPersonChips(); renderHashtagSuggestions(); }
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------------
     START – Schnellerfassung
     --------------------------------------------------------------------- */
  var ui = {
    shift: { date: todayKey(), type: "Früh" },
    selectedPersonIds: [],
    entryTimestamp: new Date()
  };

  function renderShiftBar() {
    var parts = ui.shift.date.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    var label = (ui.shift.date === todayKey()) ? "Heute" : d.getDate() + ". " + MONTHS[d.getMonth()];
    document.getElementById("shiftDateLabel").textContent = label;
    document.getElementById("shiftTypeLabel").textContent = ui.shift.type;
  }

  function renderTimestampLabel() {
    document.getElementById("timestampLabel").textContent = formatDateTimeLabel(ui.entryTimestamp);
  }

  function renderPersonChips() {
    var wrap = document.getElementById("personChips");
    var html = "";
    state.categories.forEach(function (cat) {
      state.people.filter(function (p) { return p.categoryId === cat.id; }).forEach(function (p) {
        var selected = ui.selectedPersonIds.indexOf(p.id) !== -1;
        html += chipHTML(p.id, p.name, cat.color, selected);
      });
    });
    state.people.filter(function (p) { return !getCategory(p.categoryId); }).forEach(function (p) {
      var selected = ui.selectedPersonIds.indexOf(p.id) !== -1;
      html += chipHTML(p.id, p.name, "#8A9793", selected);
    });
    html += '<button type="button" class="chip chip--add" id="quickAddPersonBtn">+ Person</button>';
    wrap.innerHTML = html;

    wrap.querySelectorAll(".chip[data-person]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var id = chip.dataset.person;
        var idx = ui.selectedPersonIds.indexOf(id);
        if (idx === -1) ui.selectedPersonIds.push(id); else ui.selectedPersonIds.splice(idx, 1);
        chip.classList.toggle("is-selected");
      });
    });
    var addBtn = document.getElementById("quickAddPersonBtn");
    if (addBtn) addBtn.addEventListener("click", function () {
      openPersonModal(null, { autoSelect: true });
    });
  }

  function chipHTML(personId, name, color, selected) {
    return '<button type="button" class="chip' + (selected ? " is-selected" : "") + '" style="--chip-color:' + color + '" data-person="' + personId + '">' +
      '<span class="chip__dot"></span>' + esc(name) + '</button>';
  }

  function renderHashtagSuggestions() {
    var wrap = document.getElementById("hashtagChips");
    var top = getTopHashtags(10);
    if (!top.length) {
      wrap.innerHTML = '<span class="category-empty">Tippe im Text z. B. #Station3, #Zimmer12, #Sturz …</span>';
      return;
    }
    wrap.innerHTML = top.map(function (t) {
      return '<button type="button" class="chip" style="--chip-color:var(--accent)" data-hashtag="' + esc(t) + '">#' + esc(t) + '</button>';
    }).join("");
    wrap.querySelectorAll("[data-hashtag]").forEach(function (chip) {
      chip.addEventListener("click", function () { insertHashtagIntoTextarea(chip.dataset.hashtag); });
    });
  }

  function insertHashtagIntoTextarea(tag) {
    var ta = document.getElementById("entryText");
    var insertion = "#" + tag;
    var text = ta.value;
    if (document.activeElement === ta && typeof ta.selectionStart === "number") {
      var start = ta.selectionStart, end = ta.selectionEnd;
      var before = text.slice(0, start), after = text.slice(end);
      var prefix = before.length && !/\s$/.test(before) ? " " : "";
      var newText = before + prefix + insertion + " " + after;
      ta.value = newText;
      var pos = (before + prefix + insertion + " ").length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    } else {
      var sep = text.length && !/\s$/.test(text) ? " " : "";
      ta.value = text + sep + insertion + " ";
      ta.focus();
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    state = loadState();
    ui.shift.type = state.settings.lastShiftType || "Früh";
    applyTheme();

    renderShiftBar();
    renderTimestampLabel();
    renderPersonChips();
    renderHashtagSuggestions();

    // Navigation
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { showView(btn.dataset.nav); });
    });

    document.getElementById("themeToggle").addEventListener("click", function () {
      var effective = getEffectiveTheme();
      state.settings.theme = effective === "dark" ? "light" : "dark";
      applyTheme();
      persist();
      renderMehrThemeOptions();
    });

    document.getElementById("shiftTypeBtn").addEventListener("click", openShiftTypeModal);
    document.getElementById("shiftPhotoBtn").addEventListener("click", function () {
      openShiftPhotoModal({ date: ui.shift.date, type: ui.shift.type });
    });
    document.getElementById("timeStampBtn").addEventListener("click", openTimestampModal);

    document.getElementById("entryForm").addEventListener("submit", function (e) {
      e.preventDefault();
      saveEntry();
    });

    // Log
    document.getElementById("logSearch").addEventListener("input", renderLog);

    // Kalender
    document.getElementById("calPrev").addEventListener("click", function () { shiftCalMonth(-1); });
    document.getElementById("calNext").addEventListener("click", function () { shiftCalMonth(1); });
    document.getElementById("calFilterToggle").addEventListener("click", toggleFilterPanel);
    document.getElementById("filterReset").addEventListener("click", resetFilters);
    document.getElementById("calDayClear").addEventListener("click", function () {
      calState.selectedDay = null;
      renderCalendar();
    });

    // Kontakte
    document.getElementById("addPersonBtn").addEventListener("click", function () { openPersonModal(null); });
    document.getElementById("addCategoryBtn").addEventListener("click", function () { openCategoryModal(null); });

    // Mehr
    document.getElementById("addShiftPhotoBtn").addEventListener("click", function () {
      openShiftPhotoModal({ date: todayKey(), type: state.settings.lastShiftType || "Früh" });
    });
    document.getElementById("exportBtn").addEventListener("click", exportData);
    document.getElementById("exportWordBtn").addEventListener("click", exportWord);
    document.getElementById("importInput").addEventListener("change", importData);
    document.getElementById("clearAllBtn").addEventListener("click", clearAllData);
    document.getElementById("showOnboardingBtn").addEventListener("click", function () { renderOnboarding(0); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.getElementById("onboardingRoot").innerHTML.trim() !== "") {
        closeOnboarding();
      }
    });

    maybeShowOnboarding();
  }

  function saveEntry() {
    var textarea = document.getElementById("entryText");
    var text = textarea.value.trim();
    if (!text) { toast("Bitte kurz beschreiben, was passiert ist."); textarea.focus(); return; }

    state.entries.push({
      id: uid("entry"),
      timestamp: ui.entryTimestamp.toISOString(),
      text: text,
      personIds: ui.selectedPersonIds.slice(),
      hashtags: extractHashtags(text),
      shiftDate: ui.shift.date,
      shiftType: ui.shift.type
    });
    persist();

    textarea.value = "";
    ui.entryTimestamp = new Date();
    renderTimestampLabel();
    renderHashtagSuggestions();
    toast("Gespeichert");
  }

  /* ---------------------------------------------------------------------
     Schicht-Typ & Zeitstempel Modals
     --------------------------------------------------------------------- */
  function openShiftTypeModal() {
    var customVal = SHIFT_PRESETS.indexOf(ui.shift.type) === -1 ? ui.shift.type : "";
    var chips = SHIFT_PRESETS.map(function (t) {
      return '<button type="button" class="chip' + (ui.shift.type === t ? " is-selected" : "") + '" data-shift-type="' + esc(t) + '">' + esc(t) + '</button>';
    }).join("");

    var sheet = openModal("Schicht", '' +
      '<div class="modal-field"><label for="shiftDateInput">Datum</label>' +
      '<input type="date" id="shiftDateInput" value="' + ui.shift.date + '"></div>' +
      '<div class="modal-field"><label>Schichttyp</label><div class="chip-row" id="shiftTypeChips">' + chips + '</div></div>' +
      '<div class="modal-field"><label for="shiftCustomInput">Eigene Bezeichnung (optional)</label>' +
      '<input type="text" id="shiftCustomInput" placeholder="z. B. Bereitschaft" value="' + esc(customVal) + '"></div>' +
      '<div class="modal-actions"><button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
      '<button type="button" class="btn btn--primary" id="shiftSaveBtn">Übernehmen</button></div>');

    var selectedType = ui.shift.type;
    sheet.querySelectorAll("[data-shift-type]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        selectedType = chip.dataset.shiftType;
        sheet.querySelectorAll("[data-shift-type]").forEach(function (c) { c.classList.toggle("is-selected", c === chip); });
        sheet.querySelector("#shiftCustomInput").value = "";
      });
    });
    sheet.querySelector("#shiftCustomInput").addEventListener("input", function (e) {
      if (e.target.value.trim()) {
        selectedType = e.target.value.trim();
        sheet.querySelectorAll("[data-shift-type]").forEach(function (c) { c.classList.remove("is-selected"); });
      }
    });
    sheet.querySelector("#shiftSaveBtn").addEventListener("click", function () {
      var customText = sheet.querySelector("#shiftCustomInput").value.trim();
      ui.shift.date = sheet.querySelector("#shiftDateInput").value || todayKey();
      ui.shift.type = customText || selectedType || "Früh";
      state.settings.lastShiftType = ui.shift.type;
      persist();
      renderShiftBar();
      closeModal();
    });
  }

  function openTimestampModal() {
    var sheet = openModal("Zeitpunkt", '' +
      '<div class="modal-field"><label for="tsInput">Datum &amp; Uhrzeit</label>' +
      '<input type="datetime-local" id="tsInput" value="' + toDateTimeLocalValue(ui.entryTimestamp) + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" id="tsNowBtn">Jetzt</button>' +
        '<button type="button" class="btn btn--primary" id="tsSaveBtn">Übernehmen</button>' +
      '</div>');
    sheet.querySelector("#tsNowBtn").addEventListener("click", function () {
      ui.entryTimestamp = new Date();
      renderTimestampLabel();
      closeModal();
    });
    sheet.querySelector("#tsSaveBtn").addEventListener("click", function () {
      var val = sheet.querySelector("#tsInput").value;
      if (val) ui.entryTimestamp = new Date(val);
      renderTimestampLabel();
      closeModal();
    });
  }

  /* ---------------------------------------------------------------------
     Gemeinsame Eintrags-Liste (Log & Kalender)
     --------------------------------------------------------------------- */
  function buildEntryListHTML(entries) {
    if (!entries.length) return "";
    var sorted = entries.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    var html = "";
    var lastDay = null;
    sorted.forEach(function (entry) {
      var d = new Date(entry.timestamp);
      var key = dateToKey(d);
      if (key !== lastDay) {
        html += '<div class="entry-day-heading">' + esc(formatDayHeading(key)) + '</div>';
        lastDay = key;
      }
      var accent = entryAccentColor(entry) || "";
      var peopleHTML = (entry.personIds || []).map(function (pid) {
        var p = getPerson(pid);
        if (!p) return "";
        var col = categoryColorForPerson(pid) || "#8A9793";
        return '<span class="mini-dot" style="--dot-color:' + col + '">' + esc(p.name) + '</span>';
      }).join("");
      var tagsHTML = (entry.hashtags || []).map(function (t) {
        return '<span class="mini-tag">#' + esc(t) + '</span>';
      }).join("");
      html +=
        '<div class="entry-item" data-entry="' + entry.id + '">' +
          '<div class="entry-item__row" style="' + (accent ? "--entry-color:" + accent : "") + '" data-toggle="' + entry.id + '">' +
            '<div class="entry-item__time">' + esc(formatTime(d)) + '</div>' +
            '<div class="entry-item__body">' +
              '<div class="entry-item__text">' + esc(entry.text) + '</div>' +
              (peopleHTML ? '<div class="entry-item__people">' + peopleHTML + '</div>' : '') +
              (tagsHTML ? '<div class="entry-item__tags">' + tagsHTML + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="entry-item__detail">' +
            '<div class="entry-item__actions">' +
              '<button type="button" class="btn btn--ghost btn--small" data-edit="' + entry.id + '">Bearbeiten</button>' +
              '<button type="button" class="btn btn--danger btn--small" data-delete="' + entry.id + '">Löschen</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    return html;
  }

  function bindEntryListEvents(container) {
    container.querySelectorAll("[data-toggle]").forEach(function (row) {
      row.addEventListener("click", function () {
        row.closest(".entry-item").classList.toggle("is-open");
      });
    });
    container.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        openEditEntryModal(btn.dataset.edit);
      });
    });
    container.querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        confirmDialog("Diesen Eintrag löschen?", "Löschen", true).then(function (ok) {
          if (!ok) return;
          state.entries = state.entries.filter(function (en) { return en.id !== btn.dataset.delete; });
          persist();
          renderLog();
          renderCalendar();
          renderHashtagSuggestions();
          toast("Eintrag gelöscht");
        });
      });
    });
  }

  function openEditEntryModal(entryId) {
    var entry = state.entries.filter(function (e) { return e.id === entryId; })[0];
    if (!entry) return;
    var d = new Date(entry.timestamp);
    var selected = (entry.personIds || []).slice();

    var chips = "";
    state.categories.forEach(function (cat) {
      state.people.filter(function (p) { return p.categoryId === cat.id; }).forEach(function (p) {
        chips += chipHTML(p.id, p.name, cat.color, selected.indexOf(p.id) !== -1);
      });
    });

    var sheet = openModal("Eintrag bearbeiten", '' +
      '<div class="modal-field"><label for="editText">Situation</label>' +
      '<textarea id="editText">' + esc(entry.text) + '</textarea></div>' +
      '<div class="modal-field"><label for="editTs">Zeitpunkt</label>' +
      '<input type="datetime-local" id="editTs" value="' + toDateTimeLocalValue(d) + '"></div>' +
      '<div class="modal-field"><label>Beteiligt</label><div class="chip-row" id="editChips">' + chips + '</div></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="editSaveBtn">Speichern</button>' +
      '</div>');

    sheet.querySelectorAll("#editChips .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var id = chip.dataset.person;
        var idx = selected.indexOf(id);
        if (idx === -1) selected.push(id); else selected.splice(idx, 1);
        chip.classList.toggle("is-selected");
      });
    });
    sheet.querySelector("#editSaveBtn").addEventListener("click", function () {
      var newText = sheet.querySelector("#editText").value.trim();
      if (!newText) { toast("Text darf nicht leer sein."); return; }
      entry.text = newText;
      var tsVal = sheet.querySelector("#editTs").value;
      if (tsVal) entry.timestamp = new Date(tsVal).toISOString();
      entry.personIds = selected;
      entry.hashtags = extractHashtags(newText);
      persist();
      closeModal();
      renderLog();
      renderCalendar();
      renderHashtagSuggestions();
      toast("Änderungen gespeichert");
    });
  }

  /* ---------------------------------------------------------------------
     LOG
     --------------------------------------------------------------------- */
  function renderLog() {
    var q = document.getElementById("logSearch").value.trim().toLowerCase();
    var entries = state.entries.filter(function (entry) {
      if (!q) return true;
      if (entry.text.toLowerCase().indexOf(q) !== -1) return true;
      return (entry.personIds || []).some(function (pid) {
        var p = getPerson(pid);
        return p && p.name.toLowerCase().indexOf(q) !== -1;
      });
    });
    var list = document.getElementById("logList");
    list.innerHTML = buildEntryListHTML(entries);
    bindEntryListEvents(list);
    document.getElementById("logEmpty").hidden = state.entries.length !== 0;
    if (state.entries.length && !entries.length) {
      list.innerHTML = '<p class="empty-state">Keine Treffer für „' + esc(q) + '“.</p>';
    }
  }

  /* ---------------------------------------------------------------------
     KALENDER
     --------------------------------------------------------------------- */
  var now = new Date();
  var calState = {
    year: now.getFullYear(),
    month: now.getMonth(),
    selectedDay: null,
    filterCategories: [],
    filterPeople: [],
    filterHashtags: []
  };

  function shiftCalMonth(delta) {
    calState.month += delta;
    if (calState.month < 0) { calState.month = 11; calState.year--; }
    if (calState.month > 11) { calState.month = 0; calState.year++; }
    renderCalendar();
  }

  function toggleFilterPanel() {
    var panel = document.getElementById("calFilterPanel");
    var btn = document.getElementById("calFilterToggle");
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
  }

  function resetFilters() {
    calState.filterCategories = [];
    calState.filterPeople = [];
    calState.filterHashtags = [];
    renderCalendar();
  }

  function entryMatchesFilters(entry) {
    var pIds = entry.personIds || [];
    if (calState.filterCategories.length) {
      var okCat = pIds.some(function (pid) {
        var p = getPerson(pid);
        return p && calState.filterCategories.indexOf(p.categoryId) !== -1;
      });
      if (!okCat) return false;
    }
    if (calState.filterPeople.length) {
      var okPerson = pIds.some(function (pid) { return calState.filterPeople.indexOf(pid) !== -1; });
      if (!okPerson) return false;
    }
    if (calState.filterHashtags.length) {
      var tags = entry.hashtags || [];
      var okTag = calState.filterHashtags.some(function (t) { return tags.indexOf(t) !== -1; });
      if (!okTag) return false;
    }
    return true;
  }

  function renderCalendar() {
    document.getElementById("calMonthLabel").textContent = MONTHS[calState.month] + " " + calState.year;

    // Filter chips
    var catWrap = document.getElementById("filterCategories");
    catWrap.innerHTML = state.categories.map(function (c) {
      var sel = calState.filterCategories.indexOf(c.id) !== -1;
      return '<button type="button" class="chip' + (sel ? " is-selected" : "") + '" style="--chip-color:' + c.color + '" data-cat="' + c.id + '"><span class="chip__dot"></span>' + esc(c.name) + '</button>';
    }).join("");
    catWrap.querySelectorAll("[data-cat]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var id = chip.dataset.cat;
        var idx = calState.filterCategories.indexOf(id);
        if (idx === -1) calState.filterCategories.push(id); else calState.filterCategories.splice(idx, 1);
        renderCalendar();
      });
    });

    var peopleWrap = document.getElementById("filterPeople");
    if (!state.people.length) {
      peopleWrap.innerHTML = '<span class="category-empty">Noch keine Personen angelegt.</span>';
    } else {
      peopleWrap.innerHTML = state.people.map(function (p) {
        var sel = calState.filterPeople.indexOf(p.id) !== -1;
        var col = categoryColorForPerson(p.id) || "#8A9793";
        return '<button type="button" class="chip' + (sel ? " is-selected" : "") + '" style="--chip-color:' + col + '" data-person="' + p.id + '"><span class="chip__dot"></span>' + esc(p.name) + '</button>';
      }).join("");
      peopleWrap.querySelectorAll("[data-person]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          var id = chip.dataset.person;
          var idx = calState.filterPeople.indexOf(id);
          if (idx === -1) calState.filterPeople.push(id); else calState.filterPeople.splice(idx, 1);
          renderCalendar();
        });
      });
    }

    var tagWrap = document.getElementById("filterHashtags");
    var allTags = getTopHashtags().sort();
    if (!allTags.length) {
      tagWrap.innerHTML = '<span class="category-empty">Noch keine Hashtags verwendet.</span>';
    } else {
      tagWrap.innerHTML = allTags.map(function (t) {
        var sel = calState.filterHashtags.indexOf(t) !== -1;
        return '<button type="button" class="chip' + (sel ? " is-selected" : "") + '" style="--chip-color:var(--accent)" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
      }).join("");
      tagWrap.querySelectorAll("[data-tag]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          var t = chip.dataset.tag;
          var idx = calState.filterHashtags.indexOf(t);
          if (idx === -1) calState.filterHashtags.push(t); else calState.filterHashtags.splice(idx, 1);
          renderCalendar();
        });
      });
    }

    var filterCount = calState.filterCategories.length + calState.filterPeople.length + calState.filterHashtags.length;
    var countEl = document.getElementById("calFilterCount");
    countEl.hidden = filterCount === 0;
    countEl.textContent = filterCount;

    // Grid
    var filteredEntries = state.entries.filter(entryMatchesFilters);
    var entriesByDay = {};
    filteredEntries.forEach(function (entry) {
      var key = dateToKey(new Date(entry.timestamp));
      (entriesByDay[key] = entriesByDay[key] || []).push(entry);
    });

    var first = new Date(calState.year, calState.month, 1);
    var startOffset = (first.getDay() + 6) % 7; // Montag = 0
    var daysInMonth = new Date(calState.year, calState.month + 1, 0).getDate();
    var gridStart = new Date(calState.year, calState.month, 1 - startOffset);

    var gridHTML = "";
    for (var i = 0; i < 42; i++) {
      var cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      var key = dateToKey(cellDate);
      var muted = cellDate.getMonth() !== calState.month;
      var isToday = key === todayKey();
      var isSelected = key === calState.selectedDay;
      var count = (entriesByDay[key] || []).length;
      var dots = "";
      for (var d = 0; d < Math.min(count, 3); d++) dots += "<span></span>";
      gridHTML += '<button type="button" class="cal-day' + (muted ? " is-muted" : "") + (isToday ? " is-today" : "") + (isSelected ? " is-selected" : "") + '" data-day="' + key + '">' +
        '<span>' + cellDate.getDate() + '</span>' +
        '<span class="cal-day__dots">' + dots + '</span>' +
      '</button>';
      if (i >= startOffset + daysInMonth - 1 && (i + 1) % 7 === 0) break;
    }
    var grid = document.getElementById("calGrid");
    grid.innerHTML = gridHTML;
    grid.querySelectorAll("[data-day]").forEach(function (cell) {
      cell.addEventListener("click", function () {
        var key = cell.dataset.day;
        calState.selectedDay = (calState.selectedDay === key) ? null : key;
        renderCalendar();
      });
    });

    // List
    var listEntries = calState.selectedDay
      ? filteredEntries.filter(function (e) { return dateToKey(new Date(e.timestamp)) === calState.selectedDay; })
      : filteredEntries;

    document.getElementById("calListLabel").textContent = calState.selectedDay
      ? formatDayHeading(calState.selectedDay)
      : "Alle Ereignisse";
    document.getElementById("calDayClear").hidden = !calState.selectedDay;

    var calList = document.getElementById("calList");
    calList.innerHTML = buildEntryListHTML(listEntries);
    bindEntryListEvents(calList);
    document.getElementById("calEmpty").hidden = listEntries.length !== 0;
  }

  /* ---------------------------------------------------------------------
     KONTAKTE
     --------------------------------------------------------------------- */
  function renderKontakte() {
    var wrap = document.getElementById("categoryList");
    var html = "";
    state.categories.forEach(function (cat) {
      var people = state.people.filter(function (p) { return p.categoryId === cat.id; });
      html += '<div class="category-block">' +
        '<div class="category-block__head">' +
          '<span class="category-block__dot" style="background:' + cat.color + '"></span>' +
          '<span class="category-block__name">' + esc(cat.name) + '</span>' +
          '<button type="button" class="category-block__edit" data-edit-cat="' + cat.id + '">Bearbeiten</button>' +
        '</div>' +
        (people.length ? people.map(personRowHTML).join("") : '<p class="category-empty">Noch niemand zugeteilt.</p>') +
      '</div>';
    });
    var orphans = state.people.filter(function (p) { return !getCategory(p.categoryId); });
    if (orphans.length) {
      html += '<div class="category-block">' +
        '<div class="category-block__head">' +
          '<span class="category-block__dot" style="background:#8A9793"></span>' +
          '<span class="category-block__name">Ohne Kategorie</span>' +
        '</div>' +
        orphans.map(personRowHTML).join("") +
      '</div>';
    }
    wrap.innerHTML = html;

    wrap.querySelectorAll("[data-edit-cat]").forEach(function (btn) {
      btn.addEventListener("click", function () { openCategoryModal(getCategory(btn.dataset.editCat)); });
    });
    wrap.querySelectorAll("[data-edit-person]").forEach(function (btn) {
      btn.addEventListener("click", function () { openPersonModal(getPerson(btn.dataset.editPerson)); });
    });
  }

  function personRowHTML(p) {
    return '<div class="person-row">' +
      '<div class="person-row__name">' + esc(p.name) + (p.note ? '<span class="person-row__note">' + esc(p.note) + '</span>' : '') + '</div>' +
      '<button type="button" class="person-row__edit" data-edit-person="' + p.id + '" aria-label="Person bearbeiten">✎</button>' +
    '</div>';
  }

  function openPersonModal(person, opts) {
    opts = opts || {};
    var isNew = !person;
    var catOptions = state.categories.map(function (c) {
      var sel = person ? person.categoryId === c.id : c.id === "kat_kollege";
      return '<option value="' + c.id + '"' + (sel ? " selected" : "") + '>' + esc(c.name) + '</option>';
    }).join("");

    var sheet = openModal(isNew ? "Person hinzufügen" : "Person bearbeiten", '' +
      '<div class="modal-field"><label for="personName">Name</label>' +
      '<input type="text" id="personName" placeholder="z. B. Frau Müller" value="' + esc(person ? person.name : "") + '"></div>' +
      '<div class="modal-field"><label for="personCat">Kategorie</label>' +
      '<select id="personCat">' + catOptions + '</select></div>' +
      '<div class="modal-field"><label for="personNote">Notiz (optional)</label>' +
      '<input type="text" id="personNote" placeholder="z. B. Station B, Tel. intern 123" value="' + esc(person && person.note ? person.note : "") + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="personSaveBtn">Speichern</button>' +
      '</div>' +
      (isNew ? '' : '<button type="button" class="btn btn--danger btn--block" id="personDeleteBtn" style="margin-top:10px;">Person löschen</button>'));

    sheet.querySelector("#personSaveBtn").addEventListener("click", function () {
      var name = sheet.querySelector("#personName").value.trim();
      if (!name) { toast("Bitte einen Namen eingeben."); return; }
      var categoryId = sheet.querySelector("#personCat").value;
      var note = sheet.querySelector("#personNote").value.trim();
      if (isNew) {
        var p = { id: uid("person"), name: name, categoryId: categoryId, note: note };
        state.people.push(p);
        persist();
        closeModal();
        renderKontakte();
        renderPersonChips();
        if (opts.autoSelect) {
          ui.selectedPersonIds.push(p.id);
          renderPersonChips();
        }
        toast("Person hinzugefügt");
      } else {
        person.name = name;
        person.categoryId = categoryId;
        person.note = note;
        persist();
        closeModal();
        renderKontakte();
        renderPersonChips();
        renderLog();
        renderCalendar();
        toast("Änderungen gespeichert");
      }
    });

    if (!isNew) {
      sheet.querySelector("#personDeleteBtn").addEventListener("click", function () {
        confirmDialog("„" + person.name + "“ löschen? Bestehende Einträge bleiben erhalten, verlieren aber diese Zuordnung.", "Löschen", true).then(function (ok) {
          if (!ok) return;
          state.people = state.people.filter(function (p) { return p.id !== person.id; });
          state.entries.forEach(function (e) { e.personIds = (e.personIds || []).filter(function (id) { return id !== person.id; }); });
          state.shifts.forEach(function (s) { if (s.leitungId === person.id) s.leitungId = ""; });
          ui.selectedPersonIds = ui.selectedPersonIds.filter(function (id) { return id !== person.id; });
          persist();
          closeModal();
          renderKontakte();
          renderPersonChips();
          renderLog();
          renderCalendar();
          renderMehr();
          toast("Person gelöscht");
        });
      });
    }
  }

  function openCategoryModal(category) {
    var isNew = !category;
    var selectedColor = category ? category.color : COLOR_SWATCHES[0];
    var swatches = COLOR_SWATCHES.map(function (c) {
      return '<button type="button" class="color-swatch' + (c === selectedColor ? " is-selected" : "") + '" style="background:' + c + '" data-color="' + c + '" aria-label="Farbe wählen"></button>';
    }).join("");

    var sheet = openModal(isNew ? "Eigene Kategorie" : "Kategorie bearbeiten", '' +
      '<div class="modal-field"><label for="catName">Name</label>' +
      '<input type="text" id="catName" placeholder="z. B. Angehörige" value="' + esc(category ? category.name : "") + '"></div>' +
      '<div class="modal-field"><label>Farbe</label><div class="color-swatch-row" id="catColors">' + swatches + '</div></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="catSaveBtn">Speichern</button>' +
      '</div>' +
      (!isNew && !category.builtin ? '<button type="button" class="btn btn--danger btn--block" id="catDeleteBtn" style="margin-top:10px;">Kategorie löschen</button>' : ''));

    sheet.querySelectorAll("[data-color]").forEach(function (sw) {
      sw.addEventListener("click", function () {
        selectedColor = sw.dataset.color;
        sheet.querySelectorAll("[data-color]").forEach(function (s) { s.classList.toggle("is-selected", s === sw); });
      });
    });

    sheet.querySelector("#catSaveBtn").addEventListener("click", function () {
      var name = sheet.querySelector("#catName").value.trim();
      if (!name) { toast("Bitte einen Namen eingeben."); return; }
      if (isNew) {
        state.categories.push({ id: uid("kat"), name: name, color: selectedColor, builtin: false });
        toast("Kategorie hinzugefügt");
      } else {
        category.name = name;
        category.color = selectedColor;
        toast("Änderungen gespeichert");
      }
      persist();
      closeModal();
      renderKontakte();
      renderPersonChips();
      renderLog();
      renderCalendar();
    });

    if (!isNew && !category.builtin) {
      sheet.querySelector("#catDeleteBtn").addEventListener("click", function () {
        var affected = state.people.filter(function (p) { return p.categoryId === category.id; }).length;
        var msg = affected
          ? "Kategorie „" + category.name + "“ löschen? " + affected + " Person(en) werden zu „Ohne Kategorie“ verschoben."
          : "Kategorie „" + category.name + "“ löschen?";
        confirmDialog(msg, "Löschen", true).then(function (ok) {
          if (!ok) return;
          state.people.forEach(function (p) { if (p.categoryId === category.id) p.categoryId = null; });
          state.categories = state.categories.filter(function (c) { return c.id !== category.id; });
          persist();
          closeModal();
          renderKontakte();
          renderPersonChips();
          renderLog();
          renderCalendar();
          toast("Kategorie gelöscht");
        });
      });
    }
  }

  /* ---------------------------------------------------------------------
     SCHICHTFOTOS
     --------------------------------------------------------------------- */
  function findShift(date, type) {
    return state.shifts.filter(function (s) { return s.date === date && s.type === type; })[0] || null;
  }

  // Für Dateinamen: Sonderzeichen/Leerzeichen entfernen bzw. durch "-" ersetzen,
  // Umlaute bleiben erhalten (auf modernen Systemen unproblematisch).
  function slugifyForFilename(s) {
    return String(s || "")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function shiftPhotoFileName(shift) {
    var parts = [];
    if (shift.station && String(shift.station).trim()) parts.push(slugifyForFilename(shift.station));
    var leader = shift.leitungId ? getPerson(shift.leitungId) : null;
    if (leader) parts.push(slugifyForFilename(leader.name));
    parts.push(shift.date || todayKey());
    return "Schichtplan_" + parts.join("_") + ".jpeg";
  }

  function leitungOptionsHtml(selectedId) {
    var leitungPeople = state.people.filter(function (p) { return p.categoryId === "kat_leitung"; });
    var opts = '<option value="">— keine Angabe —</option>';
    opts += leitungPeople.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === selectedId ? " selected" : "") + '>' + esc(p.name) + '</option>';
    }).join("");
    return opts;
  }

  function fileToCompressedDataURL(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Datei konnte nicht gelesen werden.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("Bild konnte nicht geladen werden.")); };
        img.onload = function () {
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var canvas = document.createElement("canvas");
          canvas.width = cw; canvas.height = ch;
          canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function openShiftPhotoModal(seed) {
    var existing = findShift(seed.date, seed.type);
    var data = existing || { id: null, date: seed.date, type: seed.type, photo: null, note: "", station: "", leitungId: "" };
    var pendingPhoto = data.photo;

    var typeOptions = SHIFT_PRESETS.concat(
      SHIFT_PRESETS.indexOf(data.type) === -1 && data.type ? [data.type] : []
    ).map(function (t) {
      return '<option value="' + esc(t) + '"' + (t === data.type ? " selected" : "") + '>' + esc(t) + '</option>';
    }).join("");

    var sheet = openModal(existing ? "Schicht-Foto" : "Schicht-Foto hinzufügen", '' +
      '<div id="shiftPhotoFieldSlot"></div>' +
      '<div class="modal-field"><label for="shiftPhotoDate">Datum</label>' +
      '<input type="date" id="shiftPhotoDate" value="' + data.date + '"></div>' +
      '<div class="modal-field"><label for="shiftPhotoType">Schicht</label>' +
      '<select id="shiftPhotoType">' + typeOptions + '</select></div>' +
      '<div class="modal-field"><label for="shiftPhotoStation">Station (optional)</label>' +
      '<input type="text" id="shiftPhotoStation" placeholder="z. B. Station 3" value="' + esc(data.station || "") + '"></div>' +
      '<div class="modal-field"><label for="shiftPhotoLeitung">Stationsleitung (optional)</label>' +
      '<select id="shiftPhotoLeitung">' + leitungOptionsHtml(data.leitungId || "") + '</select></div>' +
      '<button type="button" class="btn btn--ghost btn--block" id="shiftPhotoDownloadBtn" style="margin-bottom:14px;">Foto herunterladen (.jpeg)</button>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="shiftPhotoSaveBtn">Speichern</button>' +
      '</div>' +
      (existing ? '<button type="button" class="btn btn--danger btn--block" id="shiftPhotoDeleteBtn" style="margin-top:8px;">Foto löschen</button>' : ''));

    function showPickField(container) {
      container.innerHTML = '<div class="modal-field"><label for="shiftPhotoFile">Foto (Zuteilungsplan)</label>' +
        '<input type="file" id="shiftPhotoFile" accept="image/*" capture="environment"></div>';
      container.querySelector("#shiftPhotoFile").addEventListener("change", function (ev) {
        var file = ev.target.files[0];
        if (!file) return;
        fileToCompressedDataURL(file, 1280, 0.72).then(function (dataUrl) {
          pendingPhoto = dataUrl;
          showPreviewField(container);
        }).catch(function (err) {
          toast(err.message || "Foto konnte nicht verarbeitet werden.");
        });
      });
    }
    function showPreviewField(container) {
      container.innerHTML = '<img class="photo-preview" src="' + pendingPhoto + '" alt="Zuteilungsplan">' +
        '<button type="button" class="btn btn--ghost btn--block" id="shiftPhotoChangeBtn" style="margin-bottom:12px;">Anderes Foto wählen</button>';
      container.querySelector("#shiftPhotoChangeBtn").addEventListener("click", function () { showPickField(container); });
    }

    var photoFieldWrap = sheet.querySelector("#shiftPhotoFieldSlot");
    if (pendingPhoto) showPreviewField(photoFieldWrap); else showPickField(photoFieldWrap);

    sheet.querySelector("#shiftPhotoDownloadBtn").addEventListener("click", function () {
      if (!pendingPhoto) { toast("Bitte zuerst ein Foto auswählen."); return; }
      var tempShift = {
        date: sheet.querySelector("#shiftPhotoDate").value || todayKey(),
        station: sheet.querySelector("#shiftPhotoStation").value,
        leitungId: sheet.querySelector("#shiftPhotoLeitung").value
      };
      var filename = shiftPhotoFileName(tempShift);
      var blob = new Blob([dataUrlToBytes(pendingPhoto)], { type: "image/jpeg" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      toast("Foto wird heruntergeladen");
    });

    sheet.querySelector("#shiftPhotoSaveBtn").addEventListener("click", function () {
      var date = sheet.querySelector("#shiftPhotoDate").value || todayKey();
      var type = sheet.querySelector("#shiftPhotoType").value;
      var station = sheet.querySelector("#shiftPhotoStation").value.trim();
      var leitungId = sheet.querySelector("#shiftPhotoLeitung").value;
      if (!pendingPhoto) { toast("Bitte zuerst ein Foto auswählen."); return; }
      // Bewusst frisch anhand von Datum+Typ nachschlagen (nicht die beim Öffnen
      // gefundene "existing"-Referenz verwenden): falls Datum/Typ im Dialog
      // geändert wurden, verhindert das ein versehentliches Verschieben eines
      // bereits bestehenden Fotos auf den neuen Tag.
      var target = findShift(date, type);
      if (target) {
        target.photo = pendingPhoto;
        target.station = station;
        target.leitungId = leitungId;
      } else {
        state.shifts.push({ id: uid("shift"), date: date, type: type, photo: pendingPhoto, note: "", station: station, leitungId: leitungId });
      }
      persist();
      closeModal();
      renderMehr();
      toast("Schicht-Foto gespeichert");
    });

    if (existing) {
      sheet.querySelector("#shiftPhotoDeleteBtn").addEventListener("click", function () {
        confirmDialog("Dieses Schicht-Foto löschen?", "Löschen", true).then(function (ok) {
          if (!ok) return;
          state.shifts = state.shifts.filter(function (s) { return s.id !== existing.id; });
          persist();
          closeModal();
          renderMehr();
          toast("Foto gelöscht");
        });
      });
    }
  }

  /* ---------------------------------------------------------------------
     MEHR (Einstellungen)
     --------------------------------------------------------------------- */
  function renderMehr() {
    var list = document.getElementById("shiftPhotoList");
    var sorted = state.shifts.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (!sorted.length) {
      list.innerHTML = '<p class="category-empty">Noch keine Schicht-Fotos hinterlegt.</p>';
    } else {
      list.innerHTML = sorted.map(function (s) {
        var parts = s.date.split("-").map(Number);
        var d = new Date(parts[0], parts[1] - 1, parts[2]);
        var thumb = s.photo
          ? '<img class="shift-photo-row__thumb" src="' + s.photo + '" alt="">'
          : '<div class="shift-photo-row__thumb shift-photo-row__thumb--placeholder">📷</div>';
        var metaBits = [s.type];
        if (s.station) metaBits.push(s.station);
        var leader = s.leitungId ? getPerson(s.leitungId) : null;
        if (leader) metaBits.push("Leitung: " + leader.name);
        return '<div class="shift-photo-row" data-shift="' + s.id + '">' + thumb +
          '<div class="shift-photo-row__meta"><div class="shift-photo-row__date">' + esc(formatDateShort(d)) + '</div>' +
          '<div class="shift-photo-row__type">' + esc(metaBits.join(" · ")) + '</div></div></div>';
      }).join("");
      list.querySelectorAll("[data-shift]").forEach(function (row) {
        row.addEventListener("click", function () {
          var s = state.shifts.filter(function (x) { return x.id === row.dataset.shift; })[0];
          if (s) openShiftPhotoModal({ date: s.date, type: s.type });
        });
      });
    }
    renderMehrThemeOptions();
  }

  function renderMehrThemeOptions() {
    var wrap = document.getElementById("themeOptions");
    var options = [["system", "System"], ["light", "Hell"], ["dark", "Dunkel"]];
    wrap.innerHTML = options.map(function (o) {
      return '<button type="button" role="radio" aria-checked="' + (state.settings.theme === o[0]) + '" class="' + (state.settings.theme === o[0] ? "is-active" : "") + '" data-theme-opt="' + o[0] + '">' + o[1] + '</button>';
    }).join("");
    wrap.querySelectorAll("[data-theme-opt]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.settings.theme = btn.dataset.themeOpt;
        persist();
        applyTheme();
        renderMehrThemeOptions();
      });
    });
  }

  function getEffectiveTheme() {
    if (state.settings.theme === "light" || state.settings.theme === "dark") return state.settings.theme;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme() {
    if (state.settings.theme === "light" || state.settings.theme === "dark") {
      document.documentElement.setAttribute("data-theme", state.settings.theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  /* ---------------------------------------------------------------------
     WORD-EXPORT (.docx)
     Baut ein echtes OOXML-Word-Dokument (ZIP-Container) direkt im Browser,
     ganz ohne externe Bibliothek – damit der Export auch ohne Internet-
     verbindung im Spital funktioniert. Enthält alle Log-Einträge sowie
     die hinterlegten Schicht-Fotos.
     --------------------------------------------------------------------- */
  var CRC_TABLE = (function () {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16le(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
  function u32le(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >> 24) & 0xFF]; }

  function concatBytes(arrays) {
    var total = 0;
    for (var i = 0; i < arrays.length; i++) total += arrays[i].length;
    var result = new Uint8Array(total);
    var pos = 0;
    for (var j = 0; j < arrays.length; j++) { result.set(arrays[j], pos); pos += arrays[j].length; }
    return result;
  }

  function dosTimeOf(d) { return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | (Math.floor(d.getSeconds() / 2) & 0x1F); }
  function dosDateOf(d) { return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F); }

  // Baut ein ZIP-Archiv (Methode "store", unkomprimiert) – reicht für ein
  // gültiges .docx und benötigt keine Deflate-Implementierung.
  function buildZip(entries) {
    var d = new Date();
    var dTime = dosTimeOf(d), dDate = dosDateOf(d);
    var localParts = [], centralParts = [], offset = 0;

    entries.forEach(function (entry) {
      var nameBytes = new TextEncoder().encode(entry.name);
      var data = entry.data;
      var crc = crc32(data);

      var localHeader = new Uint8Array([].concat(
        u32le(0x04034b50), u16le(20), u16le(0), u16le(0), u16le(dTime), u16le(dDate),
        u32le(crc), u32le(data.length), u32le(data.length),
        u16le(nameBytes.length), u16le(0)
      ));
      var localEntry = concatBytes([localHeader, nameBytes, data]);
      localParts.push(localEntry);

      var centralHeader = new Uint8Array([].concat(
        u32le(0x02014b50), u16le(20), u16le(20), u16le(0), u16le(0), u16le(dTime), u16le(dDate),
        u32le(crc), u32le(data.length), u32le(data.length),
        u16le(nameBytes.length), u16le(0), u16le(0), u16le(0), u16le(0), u32le(0),
        u32le(offset)
      ));
      centralParts.push(concatBytes([centralHeader, nameBytes]));

      offset += localEntry.length;
    });

    var centralDirStart = offset;
    var centralDirBytes = concatBytes(centralParts);
    var eocd = new Uint8Array([].concat(
      u32le(0x06054b50), u16le(0), u16le(0),
      u16le(entries.length), u16le(entries.length),
      u32le(centralDirBytes.length), u32le(centralDirStart), u16le(0)
    ));

    return concatBytes(localParts.concat([centralDirBytes, eocd]));
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function dataUrlToBytes(dataUrl) { return base64ToBytes(dataUrl.split(",")[1]); }

  function getImageNaturalSize(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve({ width: img.naturalWidth || 640, height: img.naturalHeight || 480 }); };
      img.onerror = function () { resolve({ width: 640, height: 480 }); };
      img.src = dataUrl;
    });
  }

  function xmlEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
  }

  function formatDateFullAbsolute(key) {
    var parts = key.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return WEEKDAYS_LONG[d.getDay()] + ", " + d.getDate() + ". " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function wHeadingXml(text, level) {
    return '<w:p><w:pPr><w:pStyle w:val="Heading' + level + '"/></w:pPr><w:r><w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r></w:p>';
  }

  function wTextRunsXml(text) {
    var lines = String(text || "").split(/\r\n|\r|\n/);
    return lines.map(function (line) {
      return '<w:r><w:t xml:space="preserve">' + xmlEsc(line) + '</w:t></w:r>';
    }).join('<w:r><w:br/></w:r>');
  }

  function wEntryXml(entry) {
    var d = new Date(entry.timestamp);
    var timeRun = '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">' + xmlEsc(formatTime(d)) + '  </w:t></w:r>';
    var mainPara = '<w:p><w:pPr><w:spacing w:before="120" w:after="40"/></w:pPr>' + timeRun + wTextRunsXml(entry.text) + '</w:p>';

    var names = (entry.personIds || []).map(function (pid) {
      var p = getPerson(pid);
      if (!p) return null;
      var cat = getCategory(p.categoryId);
      return p.name + (cat ? " (" + cat.name + ")" : "");
    }).filter(function (x) { return x; });

    var peoplePara = "";
    if (names.length) {
      peoplePara = '<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr>' +
        '<w:t xml:space="preserve">Beteiligt: ' + xmlEsc(names.join(", ")) + '</w:t></w:r></w:p>';
    }
    return mainPara + peoplePara;
  }

  function wImageXml(img) {
    return '<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + img.emuW + '" cy="' + img.emuH + '"/>' +
        '<wp:docPr id="' + img.docPrId + '" name="Bild' + img.docPrId + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
          '<pic:pic>' +
            '<pic:nvPicPr><pic:cNvPr id="' + img.docPrId + '" name="Bild' + img.docPrId + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
            '<pic:blipFill><a:blip r:embed="' + img.relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + img.emuW + '" cy="' + img.emuH + '"/></a:xfrm>' +
              '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
          '</pic:pic>' +
        '</a:graphicData></a:graphic>' +
      '</wp:inline>' +
    '</w:drawing></w:r></w:p>';
  }

  function buildWordBodyXml(imageRelMap) {
    var body = "";
    body += wHeadingXml("Schichtprotokoll", 1);
    var now = new Date();
    body += '<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr>' +
      '<w:t xml:space="preserve">Export erstellt am ' + xmlEsc(formatDateShort(now) + " · " + formatTime(now)) + '</w:t></w:r></w:p>';

    body += wHeadingXml("Log", 2);
    var sorted = state.entries.slice().sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    if (!sorted.length) {
      body += '<w:p><w:r><w:t xml:space="preserve">Keine Einträge vorhanden.</w:t></w:r></w:p>';
    } else {
      var lastDay = null;
      sorted.forEach(function (entry) {
        var key = dateToKey(new Date(entry.timestamp));
        if (key !== lastDay) { body += wHeadingXml(formatDateFullAbsolute(key), 3); lastDay = key; }
        body += wEntryXml(entry);
      });
    }

    body += wHeadingXml("Schichtfotos", 2);
    if (!imageRelMap.length) {
      body += '<w:p><w:r><w:t xml:space="preserve">Keine Schicht-Fotos vorhanden.</w:t></w:r></w:p>';
    } else {
      imageRelMap.forEach(function (img) {
        var parts = img.shift.date.split("-").map(Number);
        var d = new Date(parts[0], parts[1] - 1, parts[2]);
        var headingBits = [formatDateShort(d), img.shift.type];
        if (img.shift.station) headingBits.push(img.shift.station);
        var leader = img.shift.leitungId ? getPerson(img.shift.leitungId) : null;
        if (leader) headingBits.push("Leitung: " + leader.name);
        body += wHeadingXml(headingBits.join(" · "), 3);
        body += wImageXml(img);
      });
    }

    body += '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>';
    return body;
  }

  function exportWord() {
    toast("Word-Dokument wird erstellt …");
    var shiftsWithPhotos = state.shifts.filter(function (s) { return s.photo; })
      .slice().sort(function (a, b) { return a.date.localeCompare(b.date) || a.type.localeCompare(b.type); });

    Promise.all(shiftsWithPhotos.map(function (s) { return getImageNaturalSize(s.photo); }))
      .then(function (sizes) {
        var MAX_W_PX = 580;  // ~6.1in, passt in den Satzspiegel bei A4
        var MAX_H_PX = 700;  // verhindert, dass Hochformat-Fotos die ganze Seite füllen
        var mediaFiles = [], relEntries = [], imageRelMap = [];

        shiftsWithPhotos.forEach(function (s, idx) {
          var nat = sizes[idx];
          var scale = Math.min(1, MAX_W_PX / nat.width, MAX_H_PX / nat.height);
          var emuW = Math.round(nat.width * scale * 9525);
          var emuH = Math.round(nat.height * scale * 9525);
          var relId = "rIdImg" + (idx + 1);
          var fileName = "image" + (idx + 1) + ".jpeg";
          mediaFiles.push({ name: "word/media/" + fileName, data: dataUrlToBytes(s.photo) });
          relEntries.push('<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + fileName + '"/>');
          imageRelMap.push({ shift: s, relId: relId, emuW: emuW, emuH: emuH, docPrId: idx + 10 });
        });

        var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
          'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
          'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<w:body>' + buildWordBodyXml(imageRelMap) + '</w:body></w:document>';

        relEntries.unshift('<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');

        var documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relEntries.join("") + '</Relationships>';

        // Minimale, aber explizite Formatvorlagen – ohne sie würden Word bzw.
        // andere Reader (z. B. python-docx) die Heading-Verweise ignorieren
        // und alles als "Normal" darstellen.
        var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>' +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
            '<w:pPr><w:keepNext/><w:spacing w:before="0" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="34"/><w:color w:val="0F5C56"/></w:rPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
            '<w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="27"/><w:color w:val="0F5C56"/></w:rPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
            '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="23"/><w:color w:val="333333"/></w:rPr></w:style>' +
          '</w:styles>';

        var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
          '</Types>';

        var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
          '</Relationships>';

        var nowIso = new Date().toISOString();
        var coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          '<dc:title>Schichtprotokoll Export</dc:title><dc:creator>Schichtprotokoll</dc:creator>' +
          '<dcterms:created xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:created>' +
          '<dcterms:modified xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:modified>' +
          '</cp:coreProperties>';

        var appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Schichtprotokoll</Application></Properties>';

        var enc = new TextEncoder();
        var files = [
          { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
          { name: "_rels/.rels", data: enc.encode(rootRels) },
          { name: "docProps/core.xml", data: enc.encode(coreXml) },
          { name: "docProps/app.xml", data: enc.encode(appXml) },
          { name: "word/document.xml", data: enc.encode(documentXml) },
          { name: "word/styles.xml", data: enc.encode(stylesXml) },
          { name: "word/_rels/document.xml.rels", data: enc.encode(documentRels) }
        ].concat(mediaFiles);

        var zipBytes = buildZip(files);
        var blob = new Blob([zipBytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "schichtprotokoll-export-" + todayKey() + ".docx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast("Word-Dokument erstellt");
      })
      .catch(function (err) {
        console.error(err);
        toast("Word-Export fehlgeschlagen.");
      });
  }

  /* ---------------------------------------------------------------------
     Export / Import
     --------------------------------------------------------------------- */
  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = todayKey();
    a.href = url;
    a.download = "schichtprotokoll-export-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast("Export gestartet");
  }

  function importData(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var imported;
      try {
        imported = JSON.parse(reader.result);
      } catch (err) {
        toast("Datei ist kein gültiges JSON.");
        e.target.value = "";
        return;
      }
      if (!imported || typeof imported !== "object" || !Array.isArray(imported.entries)) {
        toast("Datei hat kein passendes Format.");
        e.target.value = "";
        return;
      }
      var sheet = openModal("Daten importieren", '' +
        '<p class="modal-text">Wie sollen die Daten aus der Datei übernommen werden?<br>' +
        '<strong>Zusammenführen</strong>: bestehende Daten bleiben, neue werden ergänzt.<br>' +
        '<strong>Ersetzen</strong>: alle aktuellen Daten werden überschrieben.</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
          '<button type="button" class="btn btn--ghost" id="mergeBtn">Zusammenführen</button>' +
          '<button type="button" class="btn btn--danger" id="replaceBtn">Ersetzen</button>' +
        '</div>');
      sheet.querySelector("#mergeBtn").addEventListener("click", function () {
        mergeImported(imported);
        closeModal();
        e.target.value = "";
      });
      sheet.querySelector("#replaceBtn").addEventListener("click", function () {
        confirmDialog("Wirklich alle aktuellen Daten überschreiben?", "Ersetzen", true).then(function (ok) {
          if (!ok) { e.target.value = ""; return; }
          state = {
            categories: Array.isArray(imported.categories) && imported.categories.length ? imported.categories : defaultState().categories,
            people: Array.isArray(imported.people) ? imported.people : [],
            entries: Array.isArray(imported.entries) ? imported.entries : [],
            shifts: Array.isArray(imported.shifts) ? imported.shifts : [],
            settings: imported.settings || defaultState().settings
          };
          persist();
          closeModal();
          refreshAllViews();
          toast("Daten ersetzt");
          e.target.value = "";
        });
      });
    };
    reader.onerror = function () { toast("Datei konnte nicht gelesen werden."); };
    reader.readAsText(file);
  }

  function mergeImported(imported) {
    function mergeArray(existing, incoming) {
      var byId = {};
      existing.forEach(function (item) { byId[item.id] = item; });
      (incoming || []).forEach(function (item) { if (item && item.id) byId[item.id] = item; });
      return Object.keys(byId).map(function (k) { return byId[k]; });
    }
    state.categories = mergeArray(state.categories, imported.categories);
    state.people = mergeArray(state.people, imported.people);
    state.entries = mergeArray(state.entries, imported.entries);
    state.shifts = mergeArray(state.shifts, imported.shifts);
    persist();
    refreshAllViews();
    toast("Daten zusammengeführt");
  }

  function clearAllData() {
    confirmDialog("Wirklich alle Daten unwiderruflich löschen? Ein Export vorher wird empfohlen.", "Alles löschen", true).then(function (ok) {
      if (!ok) return;
      state = defaultState();
      persist();
      ui.selectedPersonIds = [];
      refreshAllViews();
      toast("Alle Daten gelöscht");
    });
  }

  function refreshAllViews() {
    renderShiftBar();
    renderPersonChips();
    renderHashtagSuggestions();
    renderLog();
    renderCalendar();
    renderKontakte();
    renderMehr();
  }

})();
