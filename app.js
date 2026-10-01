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
      templates: [
        { id: "tpl_vital", name: "✅ Vitalzeichen", text: "Vitalzeichen kontrolliert, unauffällig." },
        { id: "tpl_med", name: "💊 Medikamente verabreicht", text: "Medikamente verabreicht wie verordnet." },
        { id: "tpl_rundgang", name: "🚶 Rundgang", text: "Rundgang durchgeführt, keine Auffälligkeiten." },
        { id: "tpl_schlaeft", name: "😴 Schläft", text: "Patient/in schläft." },
        { id: "tpl_arzt", name: "👨‍⚕️ Arzt informiert", text: "{Person} informiert." },
        { id: "tpl_ruecksprache", name: "🗣️ Rücksprache", text: "Rücksprache mit {Person} gehalten bezüglich {Thema}." },
        { id: "tpl_wunde", name: "🩹 Wundversorgung", text: "Wundversorgung durchgeführt, Wunde reizlos. {Hashtag}" },
        { id: "tpl_sturz", name: "⚠️ Sturzereignis", text: "Sturzereignis, {Person} verständigt. {Hashtag}" }
      ],
      patients: [],
      effortLevels: [
        { id: "eff_gering", label: "Gering" },
        { id: "eff_mittel", label: "Mittel" },
        { id: "eff_hoch", label: "Hoch" },
        { id: "eff_sehrhoch", label: "Sehr hoch" }
      ],
      timeLevels: [
        { id: "zeit_5", label: "< 5 Min" },
        { id: "zeit_15", label: "5–15 Min" },
        { id: "zeit_30", label: "15–30 Min" },
        { id: "zeit_ueber30", label: "> 30 Min" }
      ],
      medications: [
        { id: "med_paracetamol", name: "Paracetamol" },
        { id: "med_ibuprofen", name: "Ibuprofen" },
        { id: "med_novalgin", name: "Novalgin" }
      ],
      measurementTypes: [
        { id: "meas_rr", name: "Blutdruck", unit: "mmHg" },
        { id: "meas_puls", name: "Puls", unit: "/min" },
        { id: "meas_temp", name: "Temperatur", unit: "°C" },
        { id: "meas_spo2", name: "Sättigung", unit: "%" },
        { id: "meas_bz", name: "Blutzucker", unit: "mg/dl" }
      ],
      settings: { theme: "system", lastShiftType: "Früh", lastEntryMode: "shift" }
    };
  }

  var GENDER_OPTIONS = ["Weiblich", "Männlich", "Divers", "Keine Angabe"];
  var MED_STATUS_OPTIONS = [
    { id: "angenommen", label: "Angenommen" },
    { id: "teilweise", label: "Teilweise" },
    { id: "abgelehnt", label: "Abgelehnt" }
  ];

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();
      var d = defaultState();
      parsed.categories = parsed.categories || d.categories;
      parsed.people = parsed.people || [];
      parsed.entries = parsed.entries || [];
      parsed.shifts = parsed.shifts || [];
      parsed.templates = parsed.templates || d.templates;
      parsed.patients = parsed.patients || [];
      parsed.effortLevels = parsed.effortLevels || d.effortLevels;
      parsed.timeLevels = parsed.timeLevels || d.timeLevels;
      parsed.medications = parsed.medications || d.medications;
      parsed.measurementTypes = parsed.measurementTypes || d.measurementTypes;
      parsed.settings = parsed.settings || d.settings;
      if (!parsed.settings.lastEntryMode) parsed.settings.lastEntryMode = "shift";
      return parsed;
    } catch (e) {
      console.error("Fehler beim Laden der Daten:", e);
      return defaultState();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      checkStorageSize();
    } catch (e) {
      console.error("Fehler beim Speichern:", e);
      toast("Speichern fehlgeschlagen – Speicher evtl. voll.");
      showStorageWarningModal(true);
    }
  }

  // Grobe Näherung: Zeichenlänge des serialisierten States als Proxy für die
  // tatsächliche Speichernutzung. Reicht als früher Hinweis, bevor der
  // Browser-Speicher (typischerweise 5–10 MB je Ursprung) wirklich voll ist –
  // meist verursacht durch viele Schicht-Fotos.
  var STORAGE_WARN_THRESHOLD = 4 * 1024 * 1024;
  var storageWarningShownThisSession = false;

  function checkStorageSize() {
    try {
      var size = JSON.stringify(state).length;
      if (size > STORAGE_WARN_THRESHOLD && !storageWarningShownThisSession) {
        storageWarningShownThisSession = true;
        showStorageWarningModal(false);
      }
    } catch (e) { /* ignore */ }
  }

  function getOldPhotoShifts(days) {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var cutoffKey = dateToKey(cutoff);
    return state.shifts.filter(function (s) { return s.photo && s.date < cutoffKey; });
  }

  function showStorageWarningModal(isCriticalFailure) {
    var title = isCriticalFailure ? "Speicher voll" : "Speicherplatz wird knapp";
    var message = isCriticalFailure
      ? "Deine letzte Änderung konnte nicht gespeichert werden – der lokale Speicher dieses Browsers ist voll (oft durch viele Schicht-Fotos). Sichere deine Daten jetzt per Export und lösche danach ggf. ältere Schicht-Fotos."
      : "Der lokale Speicher dieses Browsers wird durch deine Einträge und Schicht-Fotos langsam knapp. Sichere deine Daten am besten jetzt per Export, bevor Speicherplatz-Probleme auftreten.";

    var sheet = openModal(title, '' +
      '<p class="modal-text">' + esc(message) + '</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Später</button>' +
        '<button type="button" class="btn btn--primary" id="storageWarnExportBtn">Jetzt exportieren (JSON + Fotos-ZIP)</button>' +
      '</div>' +
      '<div class="modal-field" style="margin-top:18px;">' +
        '<label for="cleanupDaysInput">Alte Schicht-Fotos aufräumen (Fotos werden entfernt, Log-Einträge bleiben erhalten)</label>' +
        '<input type="number" id="cleanupDaysInput" value="90" min="1">' +
        '<p class="settings-hint" id="cleanupPreviewText" style="margin-top:8px; margin-bottom:0;"></p>' +
      '</div>' +
      '<button type="button" class="btn btn--danger btn--block" id="cleanupPhotosBtn" style="margin-top:10px;">Alte Fotos jetzt löschen</button>');

    sheet.querySelector("#storageWarnExportBtn").addEventListener("click", function () {
      closeModal();
      exportData(true); // force: unabhängig von einem evtl. gesetzten Export-Zeitraum wirklich ALLES sichern
    });

    var daysInput = sheet.querySelector("#cleanupDaysInput");
    var previewEl = sheet.querySelector("#cleanupPreviewText");
    var cleanupBtn = sheet.querySelector("#cleanupPhotosBtn");
    function updateCleanupPreview() {
      var days = parseInt(daysInput.value, 10) || 0;
      var affected = getOldPhotoShifts(days);
      previewEl.textContent = affected.length
        ? affected.length + " Foto(s) älter als " + days + " Tage gefunden."
        : "Keine Fotos älter als " + days + " Tage.";
      cleanupBtn.disabled = affected.length === 0;
    }
    daysInput.addEventListener("input", updateCleanupPreview);
    updateCleanupPreview();

    cleanupBtn.addEventListener("click", function () {
      var days = parseInt(daysInput.value, 10) || 0;
      var affected = getOldPhotoShifts(days);
      if (!affected.length) return;
      confirmDialog(
        affected.length + " Foto(s) älter als " + days + " Tage löschen? Die zugehörigen Log-Einträge und Schicht-Angaben bleiben erhalten – nur das Bild selbst wird entfernt.",
        "Fotos löschen", true
      ).then(function (ok) {
        if (!ok) return;
        var backup = affected.map(function (s) { return { id: s.id, photo: s.photo }; });
        affected.forEach(function (s) { s.photo = null; });
        persist();
        closeModal();
        renderMehr(); renderLog(); renderCalendar();
        showUndoToast(backup.length + " Foto(s) gelöscht", function () {
          backup.forEach(function (b) {
            var s = state.shifts.filter(function (x) { return x.id === b.id; })[0];
            if (s) s.photo = b.photo;
          });
          persist();
          renderMehr(); renderLog(); renderCalendar();
        });
      });
    });
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
    if (entry.mode === "patient") return "var(--patient-accent)";
    if (entry.personIds && entry.personIds.length) {
      var col = categoryColorForPerson(entry.personIds[0]);
      if (col) return col;
    }
    return null;
  }

  function getPatient(id) {
    for (var i = 0; i < state.patients.length; i++) if (state.patients[i].id === id) return state.patients[i];
    return null;
  }
  function getEffortLevel(id) {
    for (var i = 0; i < state.effortLevels.length; i++) if (state.effortLevels[i].id === id) return state.effortLevels[i];
    return null;
  }
  function getTimeLevel(id) {
    for (var i = 0; i < state.timeLevels.length; i++) if (state.timeLevels[i].id === id) return state.timeLevels[i];
    return null;
  }
  function getMedication(id) {
    for (var i = 0; i < state.medications.length; i++) if (state.medications[i].id === id) return state.medications[i];
    return null;
  }
  function getMeasurementType(id) {
    for (var i = 0; i < state.measurementTypes.length; i++) if (state.measurementTypes[i].id === id) return state.measurementTypes[i];
    return null;
  }
  function medStatusLabel(id) {
    var s = MED_STATUS_OPTIONS.filter(function (x) { return x.id === id; })[0];
    return s ? s.label : id;
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

  // ---- Übergabe-Zusammenfassung: kompakter Text der Einträge zum Vorlesen,
  // Kopieren oder Weiterleiten (automatische Foto-Notizen bleiben draussen) ----
  function keyToDate(key) {
    var p = key.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function buildHandoverText(scope) {
    var now = new Date();
    var entries, label;
    if (scope === "shift") {
      entries = state.entries.filter(function (e) { return e.shiftDate === ui.shift.date && e.shiftType === ui.shift.type; });
      label = ui.shift.type + " · " + formatDateShort(keyToDate(ui.shift.date));
    } else if (scope === "today") {
      var todayK = todayKey();
      entries = state.entries.filter(function (e) { return dateToKey(new Date(e.timestamp)) === todayK; });
      label = "Heute · " + formatDateShort(now);
    } else {
      var cutoff = now.getTime() - 24 * 3600 * 1000;
      entries = state.entries.filter(function (e) { return new Date(e.timestamp).getTime() >= cutoff; });
      label = "Letzte 24 Stunden";
    }
    entries = entries.filter(function (e) { return !e.shiftPhotoId; })
      .sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });

    var lines = ["Übergabe – " + label];
    if (scope === "shift") {
      var shift = findShift(ui.shift.date, ui.shift.type);
      if (shift) {
        var bits = [];
        if (shift.station) bits.push("Station: " + shift.station);
        var leader = shift.leitungId ? getPerson(shift.leitungId) : null;
        if (leader) bits.push("Leitung: " + leader.name);
        if (bits.length) lines.push(bits.join(" · "));
      }
    }
    lines.push("");
    if (!entries.length) {
      lines.push("Keine Einträge im gewählten Zeitraum.");
    } else {
      entries.forEach(function (e) {
        var names = (e.personIds || []).map(function (pid) { var p = getPerson(pid); return p ? p.name : null; })
          .filter(function (x) { return x; });
        var line = "• " + formatTime(new Date(e.timestamp)) + " – " + String(e.text).replace(/\s*\n+\s*/g, " / ");
        if (names.length) line += " (Beteiligt: " + names.join(", ") + ")";
        lines.push(line);
      });
      lines.push("");
      lines.push(entries.length + (entries.length === 1 ? " Eintrag" : " Einträge"));
    }
    return lines.join("\n");
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function openHandoverModal() {
    var scope = "shift";
    var canShare = typeof navigator.share === "function";
    var scopes = [["shift", "Diese Schicht"], ["today", "Heute"], ["24h", "Letzte 24 h"]];
    var sheet = openModal("Übergabe-Zusammenfassung", '' +
      '<div class="segmented" id="handoverScope" role="radiogroup" aria-label="Zeitraum">' +
        scopes.map(function (o) {
          return '<button type="button" role="radio" data-scope="' + o[0] + '" class="' + (o[0] === scope ? "is-active" : "") + '">' + o[1] + "</button>";
        }).join("") +
      '</div>' +
      '<div class="modal-field" style="margin-top:12px;"><label for="handoverText">Text (vor dem Kopieren anpassbar)</label>' +
      '<textarea id="handoverText" class="handover-text"></textarea></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--primary" id="handoverCopyBtn">Kopieren</button>' +
        (canShare ? '<button type="button" class="btn btn--ghost" id="handoverShareBtn">Teilen</button>' : '') +
      '</div>' +
      '<button type="button" class="btn btn--ghost btn--block" data-close-modal style="margin-top:10px;">Schliessen</button>');

    var ta = sheet.querySelector("#handoverText");
    function refresh() { ta.value = buildHandoverText(scope); }
    refresh();

    sheet.querySelectorAll("[data-scope]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        scope = btn.dataset.scope;
        sheet.querySelectorAll("[data-scope]").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        refresh();
      });
    });
    sheet.querySelector("#handoverCopyBtn").addEventListener("click", function () {
      copyText(ta.value).then(function (ok) { toast(ok ? "In die Zwischenablage kopiert" : "Kopieren nicht möglich – Text markieren und manuell kopieren"); });
    });
    if (canShare) {
      sheet.querySelector("#handoverShareBtn").addEventListener("click", function () {
        navigator.share({ title: "Übergabe", text: ta.value }).catch(function () { /* abgebrochen */ });
      });
    }
  }

  function openHashtagStatsModal() {
    var counts = getHashtagCounts();
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    var body;
    if (!tags.length) {
      body = '<p class="modal-text">Noch keine Hashtags verwendet. Tippe im Text z. B. #Station3 oder #Sturz, um sie hier auszuwerten.</p>';
    } else {
      var maxCount = counts[tags[0]];
      body = '<div class="stat-list">' + tags.map(function (t) {
        var pct = Math.max(4, Math.round((counts[t] / maxCount) * 100));
        return '<div class="stat-row">' +
          '<div class="stat-row__label">#' + esc(t) + '</div>' +
          '<div class="stat-row__bar"><div class="stat-row__fill" style="width:' + pct + '%"></div></div>' +
          '<div class="stat-row__count">' + counts[t] + '</div>' +
        '</div>';
      }).join("") + '</div>';
    }
    openModal("Hashtag-Statistik", body +
      '<div class="modal-actions" style="margin-top:16px;"><button type="button" class="btn btn--ghost btn--block" data-close-modal>Schliessen</button></div>');
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

  // Undo-Snackbar: Aktion wird sofort ausgeführt (kein blockierender
  // "wirklich löschen?"-Dialog mehr), lässt sich aber für kurze Zeit
  // rückgängig machen – schneller in der Bedienung und mindestens genauso
  // sicher wie ein Bestätigungsdialog.
  var undoTimer = null;
  var pendingUndoFn = null;
  function showUndoToast(message, undoFn) {
    var el = document.getElementById("undoToast");
    clearTimeout(undoTimer);
    el.innerHTML = '<span class="undo-toast__msg"></span><button type="button" class="undo-toast__btn" id="undoToastBtn">Rückgängig</button>';
    el.querySelector(".undo-toast__msg").textContent = message;
    el.hidden = false;
    pendingUndoFn = undoFn;
    el.querySelector("#undoToastBtn").addEventListener("click", function () {
      clearTimeout(undoTimer);
      el.hidden = true;
      if (pendingUndoFn) { pendingUndoFn(); pendingUndoFn = null; }
    });
    undoTimer = setTimeout(function () { el.hidden = true; pendingUndoFn = null; }, 6000);
  }

  /* ---------------------------------------------------------------------
     Onboarding (Einführungs-Wizard)
     Erscheint automatisch beim allerersten Start (eigener localStorage-
     Schlüssel, unabhängig vom Daten-State – bleibt also auch nach
     "Alle Daten löschen" auf "gesehen"). Über "Mehr" jederzeit erneut
     aufrufbar. Weist explizit auf die rein lokale Datenspeicherung hin.
     --------------------------------------------------------------------- */
  var ONBOARDING_KEY = "schichtprotokoll_onboarding_v1";

  // Kleines eigenes Icon-Set (Strichzeichnungen statt Emoji) für konsistente
  // Darstellung über alle Geräte/Betriebssysteme hinweg. currentColor greift
  // die Textfarbe des jeweiligen Elternelements auf.
  var ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  var ICONS = {
    sparkle: '<svg class="icon-svg" ' + ICON_ATTRS + '><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>',
    pencil: '<svg class="icon-svg" ' + ICON_ATTRS + '><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/></svg>',
    lock: '<svg class="icon-svg" ' + ICON_ATTRS + '><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    rocket: '<svg class="icon-svg" ' + ICON_ATTRS + '><path d="M12 15c-3 0-5-2-5-5 0-4 2-7 5-9 3 2 5 5 5 9 0 3-2 5-5 5z"/><circle cx="12" cy="9" r="1.5"/><path d="M9 15l-2 5 3-2M15 15l2 5-3-2"/></svg>',
    camera: '<svg class="icon-svg" ' + ICON_ATTRS + '><path d="M4 8a2 2 0 0 1 2-2h1.2a2 2 0 0 0 1.6-.8l.8-1.07A2 2 0 0 1 11.2 3h1.6a2 2 0 0 1 1.6.8l.8 1.07a2 2 0 0 0 1.6.8H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>'
  };

  var ONBOARDING_STEPS = [
    {
      icon: ICONS.sparkle,
      title: "Willkommen beim Schichtprotokoll",
      body: [
        "Dieses Tool hilft dir, während der Arbeit im Spital schnell festzuhalten, was passiert ist – und wer wann involviert war.",
        "Kurz, einfach und für unterwegs am Smartphone gemacht."
      ]
    },
    {
      icon: ICONS.pencil,
      title: "Schnell erfassen",
      body: [
        "Unter „Neu“ tippst du kurz ein, was passiert ist, wählst beteiligte Personen per Chip aus (Kollege, Arzt, Leitung oder eigene Kategorien) und kannst mit #Hashtags z. B. Station, Zimmer oder Thema markieren.",
        "Log und Kalender helfen dir später, alles wiederzufinden und zu filtern."
      ]
    },
    {
      icon: ICONS.lock,
      title: "Wichtig: Wo deine Daten liegen",
      highlight: true,
      body: [
        "Alle Einträge, Kontakte und Schicht-Fotos werden ausschliesslich lokal in diesem Browser auf diesem Gerät gespeichert – nichts wird an einen Server übertragen.",
        "Das heisst aber auch: Die Daten erscheinen nicht automatisch auf einem anderen Gerät oder in einem anderen Browser. Werden Browserdaten gelöscht oder ein privater/Inkognito-Modus genutzt, können Einträge verloren gehen.",
        "Tipp: Exportiere deine Daten regelmässig als JSON (unter „Mehr“) – das ist dein Backup und enthält auch die Schicht-Fotos. Über „Importieren“ spielst du sie auf einem anderen Gerät wieder ein."
      ]
    },
    {
      icon: ICONS.rocket,
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
     App-Sperre (PIN)
     Eigener localStorage-Schlüssel, unabhängig vom Daten-State (bleibt also
     auch nach "Alle Daten löschen" bestehen). Wichtig: Das ist ein reiner
     Sichtschutz (Ansicht gesperrt) – die Daten selbst liegen weiterhin
     unverschlüsselt im Browser-Speicher. PIN wird nur gesalzen+gehasht
     gespeichert, nie im Klartext.
     --------------------------------------------------------------------- */
  var LOCK_KEY = "schichtprotokoll_lock_v1";
  var lastActiveTime = Date.now();
  var lastHiddenAt = 0;

  // Einfacher, schneller, deterministischer 53-Bit-Hash (cyrb53-Variante).
  // Bewusst keine echte Kryptografie (Web Crypto wäre async und auf file://
  // teils nicht verfügbar) – für einen reinen Sichtschutz ausreichend.
  function simpleHash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function hashPin(pin, salt) { return simpleHash(salt + "|" + pin + "|" + salt); }

  function getLockConfig() {
    try {
      var raw = localStorage.getItem(LOCK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setLockConfig(cfg) {
    try {
      if (cfg) localStorage.setItem(LOCK_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(LOCK_KEY);
    } catch (e) { /* ignore */ }
  }
  function isLockEnabled() { return !!getLockConfig(); }

  function pinDotsHtml(length) {
    var html = "";
    for (var i = 0; i < length; i++) html += '<span class="pin-dot" data-i="' + i + '"></span>';
    return html;
  }
  function pinKeysHtml() {
    var rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "back"]];
    return rows.map(function (row) {
      return row.map(function (k) {
        if (k === "") return '<span class="pin-key pin-key--empty"></span>';
        if (k === "back") return '<button type="button" class="pin-key pin-key--back" data-key="back" aria-label="Löschen">⌫</button>';
        return '<button type="button" class="pin-key" data-key="' + k + '">' + k + "</button>";
      }).join("");
    }).join("");
  }

  // Baut ein interaktives PIN-Pad innerhalb von `container` (muss die
  // Marker-Klassen .pinpad__dots / [data-key] enthalten, siehe pinDotsHtml/
  // pinKeysHtml). Ruft onSubmit(pin, {shake, reset}) auf, sobald die volle
  // Länge eingetippt wurde; der Aufrufer entscheidet, was mit der PIN
  // passiert (validieren, als "erste Eingabe" merken, etc.).
  function createPinPad(container, length, onSubmit) {
    var buffer = "";
    var dotsWrap = container.querySelector(".pinpad__dots");
    function render() {
      var dots = container.querySelectorAll(".pin-dot");
      dots.forEach(function (d, i) { d.classList.toggle("is-filled", i < buffer.length); });
    }
    function reset() { buffer = ""; render(); }
    function shake() {
      if (!dotsWrap) return;
      dotsWrap.classList.add("is-error");
      setTimeout(function () { dotsWrap.classList.remove("is-error"); }, 400);
    }
    container.querySelectorAll("[data-key]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var k = btn.dataset.key;
        if (k === "back") { buffer = buffer.slice(0, -1); render(); return; }
        if (buffer.length >= length) return;
        buffer += k;
        render();
        if (buffer.length === length) {
          var pin = buffer;
          onSubmit(pin, { shake: shake, reset: reset });
        }
      });
    });
    return { reset: reset, shake: shake };
  }

  // Vollflächiger, blockierender Sperrbildschirm (kein Abbrechen möglich
  // ausser über "PIN vergessen"). onUnlocked wird nach korrekter Eingabe
  // aufgerufen.
  function renderLockScreen(onUnlocked) {
    var cfg = getLockConfig();
    if (!cfg) { onUnlocked(); return; }
    var root = document.getElementById("lockRoot");
    root.innerHTML =
      '<div class="lock-overlay" role="dialog" aria-modal="true" aria-label="App gesperrt">' +
        '<div class="lock-card">' +
          '<div class="onboarding-icon-badge" aria-hidden="true">' + ICONS.lock + '</div>' +
          '<h2 class="onboarding-title">Gesperrt</h2>' +
          '<div class="pinpad" id="lockPad">' +
            '<p class="pinpad__subtitle" id="lockSubtitle">PIN eingeben</p>' +
            '<div class="pinpad__dots">' + pinDotsHtml(cfg.pinLength) + '</div>' +
            '<div class="pinpad__keys">' + pinKeysHtml() + '</div>' +
          '</div>' +
          '<button type="button" class="link-btn" id="lockForgotBtn">PIN vergessen?</button>' +
        '</div>' +
      '</div>';

    createPinPad(root.querySelector("#lockPad"), cfg.pinLength, function (pin, ctrl) {
      if (hashPin(pin, cfg.salt) === cfg.hash) {
        root.innerHTML = "";
        lastActiveTime = Date.now();
        onUnlocked();
      } else {
        ctrl.shake();
        document.getElementById("lockSubtitle").textContent = "Falsche PIN, versuch's nochmal";
        setTimeout(function () {
          document.getElementById("lockSubtitle").textContent = "PIN eingeben";
          ctrl.reset();
        }, 450);
      }
    });

    document.getElementById("lockForgotBtn").addEventListener("click", function () {
      confirmDialog(
        "Eine vergessene PIN kann nicht wiederhergestellt werden. Um die App wieder nutzen zu können, müssen alle lokalen App-Daten auf diesem Gerät gelöscht werden. Hast du ein aktuelles Backup (Export)?",
        "Daten löschen & entsperren",
        true
      ).then(function (ok) {
        if (!ok) return;
        setLockConfig(null);
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        location.reload();
      });
    });
  }

  function lockNow() {
    if (!isLockEnabled()) return;
    if (document.getElementById("lockRoot").innerHTML.trim() !== "") return; // schon gesperrt
    document.getElementById("app").setAttribute("aria-hidden", "true");
    document.getElementById("modalRoot").innerHTML = "";
    document.getElementById("onboardingRoot").innerHTML = "";
    renderLockScreen(function () {
      document.getElementById("app").removeAttribute("aria-hidden");
    });
  }

  function markActivity() { lastActiveTime = Date.now(); }

  function initLockBehavior() {
    ["click", "keydown", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, markActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        lastHiddenAt = Date.now();
      } else if (isLockEnabled()) {
        var cfg = getLockConfig();
        var timeoutMs = (cfg.timeoutMinutes || 0) * 60000;
        if (Date.now() - lastHiddenAt >= timeoutMs) lockNow();
      }
    });
    setInterval(function () {
      if (!isLockEnabled()) return;
      var cfg = getLockConfig();
      var timeoutMs = (cfg.timeoutMinutes || 0) * 60000;
      if (timeoutMs > 0 && Date.now() - lastActiveTime > timeoutMs) lockNow();
    }, 15000);
  }

  function renderLockSettings() {
    var cfg = getLockConfig();
    var hint = document.getElementById("lockStatusHint");
    var setupBtn = document.getElementById("lockSetupBtn");
    var changeBtn = document.getElementById("lockChangeBtn");
    var disableBtn = document.getElementById("lockDisableBtn");
    var timeoutWrap = document.getElementById("lockTimeoutWrap");

    if (cfg) {
      hint.textContent = "PIN-Sperre ist aktiv. Schützt die Ansicht – die Daten im Browser selbst bleiben dabei unverschlüsselt.";
      setupBtn.hidden = true;
      changeBtn.hidden = false;
      disableBtn.hidden = false;
      timeoutWrap.hidden = false;

      var options = [[0, "Sofort"], [1, "1 Min"], [5, "5 Min"], [15, "15 Min"]];
      var wrap = document.getElementById("lockTimeoutOptions");
      wrap.innerHTML = options.map(function (o) {
        return '<button type="button" role="radio" aria-checked="' + (cfg.timeoutMinutes === o[0]) + '" class="' + (cfg.timeoutMinutes === o[0] ? "is-active" : "") + '" data-timeout="' + o[0] + '">' + o[1] + "</button>";
      }).join("");
      wrap.querySelectorAll("[data-timeout]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var c = getLockConfig();
          if (!c) return;
          c.timeoutMinutes = Number(btn.dataset.timeout);
          setLockConfig(c);
          renderLockSettings();
        });
      });
    } else {
      hint.textContent = "Keine PIN-Sperre eingerichtet. Schützt die Ansicht bei kurzem Unbeobachtetsein des Geräts (die Daten im Browser selbst bleiben dabei unverschlüsselt).";
      setupBtn.hidden = false;
      changeBtn.hidden = true;
      disableBtn.hidden = true;
      timeoutWrap.hidden = true;
    }
  }

  function openPinSetupModal() {
    var sheet = openModal("PIN-Sperre einrichten", '' +
      '<p class="modal-text">Wähle eine 4-stellige PIN. Sie schützt die Ansicht vor kurzem Zugriff Dritter – die Daten im Browser bleiben dabei unverschlüsselt. Bei vergessener PIN müssen die lokalen App-Daten zurückgesetzt werden, also am besten vorher ein Backup exportieren.</p>' +
      '<div class="pinpad" id="pinSetupPad">' +
        '<p class="pinpad__subtitle" id="pinSetupSubtitle">Neue PIN eingeben</p>' +
        '<div class="pinpad__dots">' + pinDotsHtml(4) + '</div>' +
        '<div class="pinpad__keys">' + pinKeysHtml() + '</div>' +
      '</div>' +
      '<button type="button" class="btn btn--ghost btn--block" data-close-modal style="margin-top:16px;">Abbrechen</button>');

    var firstPin = null;
    createPinPad(sheet.querySelector("#pinSetupPad"), 4, function (pin, ctrl) {
      if (!firstPin) {
        firstPin = pin;
        document.getElementById("pinSetupSubtitle").textContent = "PIN bestätigen";
        ctrl.reset();
      } else if (pin === firstPin) {
        var salt = uid("salt");
        setLockConfig({ hash: hashPin(pin, salt), salt: salt, pinLength: 4, timeoutMinutes: 0 });
        closeModal();
        renderLockSettings();
        toast("PIN-Sperre aktiviert");
      } else {
        ctrl.shake();
        document.getElementById("pinSetupSubtitle").textContent = "Stimmt nicht überein – nochmal";
        firstPin = null;
        setTimeout(function () {
          document.getElementById("pinSetupSubtitle").textContent = "Neue PIN eingeben";
          ctrl.reset();
        }, 450);
      }
    });
  }

  function openPinChangeModal() {
    var cfg = getLockConfig();
    if (!cfg) return;
    var sheet = openModal("PIN ändern", '' +
      '<div class="pinpad" id="pinChangePad">' +
        '<p class="pinpad__subtitle" id="pinChangeSubtitle">Aktuelle PIN eingeben</p>' +
        '<div class="pinpad__dots">' + pinDotsHtml(cfg.pinLength) + '</div>' +
        '<div class="pinpad__keys">' + pinKeysHtml() + '</div>' +
      '</div>' +
      '<button type="button" class="btn btn--ghost btn--block" data-close-modal style="margin-top:16px;">Abbrechen</button>');

    var stage = "verify", firstNew = null;
    createPinPad(sheet.querySelector("#pinChangePad"), cfg.pinLength, function (pin, ctrl) {
      if (stage === "verify") {
        if (hashPin(pin, cfg.salt) === cfg.hash) {
          stage = "new1";
          document.getElementById("pinChangeSubtitle").textContent = "Neue PIN eingeben";
          ctrl.reset();
        } else {
          ctrl.shake();
          document.getElementById("pinChangeSubtitle").textContent = "Falsche PIN – nochmal";
          setTimeout(ctrl.reset, 350);
        }
      } else if (stage === "new1") {
        firstNew = pin;
        stage = "new2";
        document.getElementById("pinChangeSubtitle").textContent = "Neue PIN bestätigen";
        ctrl.reset();
      } else {
        if (pin === firstNew) {
          var salt = uid("salt");
          setLockConfig({ hash: hashPin(pin, salt), salt: salt, pinLength: cfg.pinLength, timeoutMinutes: cfg.timeoutMinutes });
          closeModal();
          toast("PIN geändert");
        } else {
          ctrl.shake();
          stage = "new1"; firstNew = null;
          document.getElementById("pinChangeSubtitle").textContent = "Stimmt nicht überein – neue PIN eingeben";
          setTimeout(ctrl.reset, 400);
        }
      }
    });
  }

  function openPinDisableModal() {
    var cfg = getLockConfig();
    if (!cfg) return;
    var sheet = openModal("PIN-Sperre deaktivieren", '' +
      '<div class="pinpad" id="pinDisablePad">' +
        '<p class="pinpad__subtitle" id="pinDisableSubtitle">Aktuelle PIN zum Bestätigen eingeben</p>' +
        '<div class="pinpad__dots">' + pinDotsHtml(cfg.pinLength) + '</div>' +
        '<div class="pinpad__keys">' + pinKeysHtml() + '</div>' +
      '</div>' +
      '<button type="button" class="btn btn--ghost btn--block" data-close-modal style="margin-top:16px;">Abbrechen</button>');

    createPinPad(sheet.querySelector("#pinDisablePad"), cfg.pinLength, function (pin, ctrl) {
      if (hashPin(pin, cfg.salt) === cfg.hash) {
        setLockConfig(null);
        closeModal();
        renderLockSettings();
        toast("PIN-Sperre deaktiviert");
      } else {
        ctrl.shake();
        document.getElementById("pinDisableSubtitle").textContent = "Falsche PIN – nochmal";
        setTimeout(ctrl.reset, 350);
      }
    });
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
    if (name === "kontakte") {
      renderKontakte();
      if (!document.getElementById("patientenWrap").hidden) renderPatientList();
    }
    if (name === "mehr") renderMehr();
    if (name === "start") {
      renderPersonChips(); renderHashtagSuggestions(); renderTemplateChips();
      if (!document.getElementById("patientModeWrap").hidden) renderPatientForm("patientFormRoot");
    }
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------------
     START – Schnellerfassung
     --------------------------------------------------------------------- */
  var ui = {
    shift: { date: todayKey(), type: "Früh" },
    selectedPersonIds: [],
    entryTimestamp: new Date(),
    entryPhotos: []
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
        saveDraft();
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
    saveDraft();
  }

  // ---- Schnelltext-Vorlagen: eigene Kurzphrasen, per Tipp einfügbar ----
  function templateChipLabel(t) {
    if (t.name && t.name.trim()) return t.name.trim();
    return t.text.length > 30 ? t.text.slice(0, 28) + "…" : t.text;
  }

  function renderTemplateChips() {
    var wrap = document.getElementById("templateChips");
    var templates = state.templates || [];
    if (!templates.length) {
      wrap.innerHTML = '<span class="category-empty">Noch keine Vorlagen – unter „Mehr“ anlegen.</span>';
      return;
    }
    wrap.innerHTML = templates.map(function (t) {
      return '<button type="button" class="chip" style="--chip-color:var(--primary)" data-template="' + t.id + '" title="' + esc(t.text) + '">' + esc(templateChipLabel(t)) + "</button>";
    }).join("");
    wrap.querySelectorAll("[data-template]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var t = templates.filter(function (x) { return x.id === chip.dataset.template; })[0];
        if (t) insertTemplateIntoTextarea(document.getElementById("entryText"), t.text, {
          onPersonInvolved: function (p) {
            if (ui.selectedPersonIds.indexOf(p.id) === -1) ui.selectedPersonIds.push(p.id);
            renderPersonChips();
          }
        });
      });
    });
  }

  // ---- Platzhalter in Vorlagen: {Person}, {Hashtag} werden "smart" über
  // eine Auswahl aufgelöst (inkl. Verknüpfung mit "Beteiligt"); jeder andere
  // {Platzhalter} wird nach dem Einfügen einfach markiert, damit man sofort
  // darüberschreiben kann. Bewusst textarea-agnostisch (Parameter `ta`) und
  // mit `hooks.onPersonInvolved`, damit dieselbe Logik im Schicht- wie im
  // Patienten-Formular funktioniert (dort landet die Person z. B. in
  // patientUi.involvedPeople statt in ui.selectedPersonIds). ----
  var PLACEHOLDER_RE = /\{([^{}]+)\}/;
  function findPlaceholder(text, fromIndex) {
    var from = fromIndex || 0;
    var sub = text.slice(from);
    var m = PLACEHOLDER_RE.exec(sub);
    if (!m) return null;
    var start = from + m.index;
    return { start: start, end: start + m[0].length, label: m[1].trim() };
  }

  function applyPlaceholderValue(ta, match, value) {
    var text = ta.value;
    ta.value = text.slice(0, match.start) + value + text.slice(match.end);
    if (ta.id === "entryText") saveDraft();
    if (ta.dataset && ta.dataset.role === "patient-text") patientUi.text = ta.value;
    return match.start + value.length;
  }

  function resolveNextPlaceholder(ta, fromIndex, hooks) {
    var m = findPlaceholder(ta.value, fromIndex);
    if (!m) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return; }
    var label = m.label.toLowerCase();
    if (label === "person" || label === "personen" || label === "name") {
      openPlaceholderPersonPicker(ta, m, hooks);
    } else if (label === "hashtag" || label === "tag" || label === "stichwort") {
      openPlaceholderHashtagPicker(ta, m, hooks);
    } else {
      ta.focus();
      ta.setSelectionRange(m.start, m.end);
    }
  }

  function openPlaceholderPersonPicker(ta, match, hooks) {
    var peopleHtml = state.people.map(function (p) {
      var col = categoryColorForPerson(p.id) || "#8A9793";
      return '<button type="button" class="chip" style="--chip-color:' + col + '" data-pick-person="' + p.id + '"><span class="chip__dot"></span>' + esc(p.name) + '</button>';
    }).join("");
    var sheet = openModal("Person einsetzen", '' +
      '<p class="modal-text">Ersetzt „{' + esc(match.label) + '}" im Text und markiert die Person direkt als beteiligt.</p>' +
      '<div class="chip-row">' + peopleHtml +
        '<button type="button" class="chip chip--add" id="placeholderAddPersonBtn">+ Person</button>' +
      '</div>' +
      '<button type="button" class="btn btn--ghost btn--block" data-close-modal style="margin-top:16px;">Abbrechen (Platzhalter behalten)</button>');

    function pick(p) {
      var newPos = applyPlaceholderValue(ta, match, p.name);
      if (hooks && hooks.onPersonInvolved) hooks.onPersonInvolved(p);
      closeModal();
      resolveNextPlaceholder(ta, newPos, hooks);
    }
    sheet.querySelectorAll("[data-pick-person]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var p = getPerson(chip.dataset.pickPerson);
        if (p) pick(p);
      });
    });
    sheet.querySelector("#placeholderAddPersonBtn").addEventListener("click", function () {
      openPersonModal(null, { onCreated: pick });
    });
  }

  function openPlaceholderHashtagPicker(ta, match, hooks) {
    var tags = getTopHashtags(12);
    var tagsHtml = tags.map(function (t) {
      return '<button type="button" class="chip" style="--chip-color:var(--accent)" data-pick-tag="' + esc(t) + '">#' + esc(t) + '</button>';
    }).join("");
    var sheet = openModal("Hashtag einsetzen", '' +
      (tags.length ? '<div class="chip-row" style="margin-bottom:16px;">' + tagsHtml + '</div>' : '') +
      '<div class="modal-field"><label for="placeholderTagInput">Oder neuen Hashtag eingeben</label>' +
      '<input type="text" id="placeholderTagInput" placeholder="z. B. Station3"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen (Platzhalter behalten)</button>' +
        '<button type="button" class="btn btn--primary" id="placeholderTagSaveBtn">Einsetzen</button>' +
      '</div>');

    function pick(tag) {
      var newPos = applyPlaceholderValue(ta, match, "#" + tag);
      closeModal();
      resolveNextPlaceholder(ta, newPos, hooks);
    }
    sheet.querySelectorAll("[data-pick-tag]").forEach(function (chip) {
      chip.addEventListener("click", function () { pick(chip.dataset.pickTag); });
    });
    sheet.querySelector("#placeholderTagSaveBtn").addEventListener("click", function () {
      var raw = sheet.querySelector("#placeholderTagInput").value.trim().replace(/^#/, "").replace(/\s+/g, "");
      if (!raw) { toast("Bitte einen Hashtag eingeben."); return; }
      pick(raw);
    });
  }

  function insertTemplateIntoTextarea(ta, phrase, hooks) {
    var text = ta.value;
    var sep = text.length && !/\s$/.test(text) ? " " : "";
    var insertStart = text.length + sep.length;
    ta.value = text + sep + phrase + " ";
    if (ta.id === "entryText") saveDraft();
    if (ta.dataset && ta.dataset.role === "patient-text") patientUi.text = ta.value;
    resolveNextPlaceholder(ta, insertStart, hooks);
  }

  function renderTemplateList() {
    var wrap = document.getElementById("templateList");
    var templates = state.templates || [];
    if (!templates.length) {
      wrap.innerHTML = '<p class="category-empty">Noch keine Vorlagen angelegt.</p>';
      return;
    }
    wrap.innerHTML = templates.map(function (t) {
      var titleHtml = t.name && t.name.trim()
        ? esc(t.name) + '<span class="person-row__note">' + esc(t.text) + '</span>'
        : esc(t.text);
      return '<div class="person-row"><div class="person-row__name">' + titleHtml + '</div>' +
        '<button type="button" class="person-row__edit" data-edit-template="' + t.id + '" aria-label="Vorlage bearbeiten">✎</button></div>';
    }).join("");
    wrap.querySelectorAll("[data-edit-template]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = templates.filter(function (x) { return x.id === btn.dataset.editTemplate; })[0];
        if (t) openTemplateModal(t);
      });
    });
  }

  function openTemplateModal(template) {
    var isNew = !template;
    var sheet = openModal(isNew ? "Vorlage hinzufügen" : "Vorlage bearbeiten", '' +
      '<div class="modal-field"><label for="templateNameInput">Name (optional, auch mit Emoji)</label>' +
      '<input type="text" id="templateNameInput" placeholder="z. B. 🩹 Wundversorgung" value="' + esc(template && template.name ? template.name : "") + '"></div>' +
      '<div class="modal-field"><label for="templateTextInput">Text</label>' +
      '<textarea id="templateTextInput" placeholder="z. B. Vitalzeichen kontrolliert, unauffällig.">' + esc(template ? template.text : "") + '</textarea>' +
      '<p class="settings-hint" style="margin-top:6px; margin-bottom:0;">Platzhalter möglich: <code>{Person}</code> und <code>{Hashtag}</code> lassen dich direkt auswählen; jeder andere <code>{Platzhalter}</code> (z. B. <code>{Thema}</code>) wird beim Einfügen markiert, um ihn zu überschreiben.</p>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="templateSaveBtn">Speichern</button>' +
      '</div>' +
      (isNew ? "" : '<button type="button" class="btn btn--danger btn--block" id="templateDeleteBtn" style="margin-top:10px;">Vorlage löschen</button>'));

    sheet.querySelector("#templateSaveBtn").addEventListener("click", function () {
      var name = sheet.querySelector("#templateNameInput").value.trim();
      var text = sheet.querySelector("#templateTextInput").value.trim();
      if (!text) { toast("Bitte einen Text eingeben."); return; }
      if (isNew) {
        state.templates.push({ id: uid("tpl"), name: name, text: text });
        toast("Vorlage hinzugefügt");
      } else {
        template.name = name;
        template.text = text;
        toast("Vorlage aktualisiert");
      }
      persist();
      closeModal();
      renderTemplateList();
      renderTemplateChips();
    });

    if (!isNew) {
      sheet.querySelector("#templateDeleteBtn").addEventListener("click", function () {
        var idx = state.templates.findIndex(function (t) { return t.id === template.id; });
        if (idx === -1) return;
        var removed = state.templates[idx];
        state.templates.splice(idx, 1);
        persist();
        closeModal();
        renderTemplateList();
        renderTemplateChips();
        showUndoToast("Vorlage gelöscht", function () {
          state.templates.splice(idx, 0, removed);
          persist();
          renderTemplateList();
          renderTemplateChips();
        });
      });
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
    renderTemplateChips();
    renderEntryPhotosRow();
    applyEntryModeUI(state.settings.lastEntryMode || "shift");

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
    var draftSaveTimer = null;
    document.getElementById("entryText").addEventListener("input", function () {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(saveDraft, 500);
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
    document.querySelectorAll('#kontakteModeSwitch [data-kmode]').forEach(function (btn) {
      btn.addEventListener("click", function () { setKontakteMode(btn.dataset.kmode); });
    });
    document.getElementById("patientSearch").addEventListener("input", renderPatientList);
    document.getElementById("addPatientBtn").addEventListener("click", function () { openPatientModal(null); });

    // Neu: Modus-Umschalter (Schicht / Patient)
    document.querySelectorAll('#entryModeSwitch [data-mode]').forEach(function (btn) {
      btn.addEventListener("click", function () { setEntryMode(btn.dataset.mode); });
    });

    // Mehr
    document.getElementById("addShiftPhotoBtn").addEventListener("click", function () {
      openShiftPhotoModal({ date: todayKey(), type: state.settings.lastShiftType || "Früh" });
    });
    document.getElementById("exportBtn").addEventListener("click", function () { exportData(); });
    document.getElementById("exportRangeClear").addEventListener("click", function () {
      document.getElementById("exportFromDate").value = "";
      document.getElementById("exportToDate").value = "";
    });
    document.getElementById("exportWordBtn").addEventListener("click", exportWord);
    document.getElementById("importInput").addEventListener("change", importData);
    document.getElementById("clearAllBtn").addEventListener("click", clearAllData);
    document.getElementById("showOnboardingBtn").addEventListener("click", function () { renderOnboarding(0); });
    document.getElementById("addTemplateBtn").addEventListener("click", function () { openTemplateModal(null); });
    document.getElementById("addEffortLevelBtn").addEventListener("click", function () { openOptionModal("effort", null); });
    document.getElementById("addTimeLevelBtn").addEventListener("click", function () { openOptionModal("time", null); });
    document.getElementById("addMedicationBtn").addEventListener("click", function () { openOptionModal("medication", null); });
    document.getElementById("addMeasurementTypeBtn").addEventListener("click", function () { openOptionModal("measurement", null); });
    document.getElementById("hashtagStatsBtn").addEventListener("click", openHashtagStatsModal);
    document.getElementById("handoverBtn").addEventListener("click", openHandoverModal);
    document.getElementById("lockSetupBtn").addEventListener("click", openPinSetupModal);
    document.getElementById("lockChangeBtn").addEventListener("click", openPinChangeModal);
    document.getElementById("lockDisableBtn").addEventListener("click", openPinDisableModal);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.getElementById("onboardingRoot").innerHTML.trim() !== "") {
        closeOnboarding();
      }
    });

    initLockBehavior();
    if (isLockEnabled()) {
      document.getElementById("app").setAttribute("aria-hidden", "true");
      renderLockScreen(function () {
        document.getElementById("app").removeAttribute("aria-hidden");
        restoreDraftIfAny();
        maybeShowOnboarding();
      });
    } else {
      restoreDraftIfAny();
      maybeShowOnboarding();
    }
  }

  // Entwurf-Wiederherstellung: schützt vor Datenverlust, wenn der Tab
  // während des Tippens versehentlich geschlossen/neu geladen wird (im
  // Pflegealltag durch Unterbrechungen keine Seltenheit). Eigener
  // localStorage-Schlüssel, unabhängig vom eigentlichen Daten-State.
  var DRAFT_KEY = "schichtprotokoll_draft_v1";
  function saveDraft() {
    try {
      var ta = document.getElementById("entryText");
      var text = ta ? ta.value : "";
      if (!text.trim()) { localStorage.removeItem(DRAFT_KEY); return; }
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        text: text,
        personIds: ui.selectedPersonIds.slice(),
        shift: { date: ui.shift.date, type: ui.shift.type }
      }));
    } catch (e) { /* ignore */ }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function restoreDraftIfAny() {
    var draft = loadDraft();
    if (!draft || !draft.text || !draft.text.trim()) return;
    document.getElementById("entryText").value = draft.text;
    ui.selectedPersonIds = draft.personIds || [];
    if (draft.shift) { ui.shift.date = draft.shift.date; ui.shift.type = draft.shift.type; }
    renderShiftBar();
    renderPersonChips();
    toast("Entwurf wiederhergestellt");
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
      shiftType: ui.shift.type,
      photos: ui.entryPhotos.slice()
    });
    persist();
    clearDraft();

    textarea.value = "";
    ui.entryTimestamp = new Date();
    ui.entryPhotos = [];
    renderTimestampLabel();
    renderHashtagSuggestions();
    renderEntryPhotosRow();
    toast("Gespeichert");
  }

  function renderEntryPhotosRow() {
    renderEntryPhotosUI(document, ui.entryPhotos, renderEntryPhotosRow);
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

    sheet.querySelectorAll("[data-shift-type]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        sheet.querySelectorAll("[data-shift-type]").forEach(function (c) { c.classList.toggle("is-selected", c === chip); });
        sheet.querySelector("#shiftCustomInput").value = "";
      });
    });
    sheet.querySelector("#shiftCustomInput").addEventListener("input", function (e) {
      if (e.target.value.trim()) {
        sheet.querySelectorAll("[data-shift-type]").forEach(function (c) { c.classList.remove("is-selected"); });
      }
    });
    sheet.querySelector("#shiftSaveBtn").addEventListener("click", function () {
      // Bewusst alles frisch aus dem DOM lesen (kein separat mitgeführter
      // "selectedType"-Zwischenspeicher mehr): der wurde beim Leeren des
      // Freitextfelds nicht zurückgesetzt, wodurch der zuvor getippte Text
      // trotzdem übernommen wurde.
      var customText = sheet.querySelector("#shiftCustomInput").value.trim();
      var activeChip = sheet.querySelector("[data-shift-type].is-selected");
      ui.shift.date = sheet.querySelector("#shiftDateInput").value || todayKey();
      ui.shift.type = customText || (activeChip ? activeChip.dataset.shiftType : "") || "Früh";
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
        var roleText = entry.personRoles && entry.personRoles[pid] ? " · " + esc(entry.personRoles[pid]) : "";
        return '<span class="mini-dot" style="--dot-color:' + col + '">' + esc(p.name) + roleText + '</span>';
      }).join("");
      var tagsHTML = (entry.hashtags || []).map(function (t) {
        return '<span class="mini-tag">#' + esc(t) + '</span>';
      }).join("");
      var linkedShift = entry.shiftPhotoId ? state.shifts.filter(function (s) { return s.id === entry.shiftPhotoId; })[0] : null;
      var photoLinkHTML = (linkedShift && linkedShift.photo)
        ? '<button type="button" class="entry-photo-thumb" data-view-shift-photo="' + linkedShift.id + '" aria-label="Zuteilungsplan ansehen">' +
            '<img src="' + linkedShift.photo + '" alt="">' +
            '<span>Zuteilungsplan</span>' +
          '</button>'
        : '';
      var isPatient = entry.mode === "patient";
      var patientHeaderHTML = "", structuredHTML = "", patientDetailHTML = "";
      if (isPatient) {
        var patient = entry.patientId ? getPatient(entry.patientId) : null;
        var pname = patient ? patient.name : "Unbekannte/r Patient/in";
        var pmeta = patient ? [patient.gender, patient.room ? "Zimmer " + patient.room : "", patient.station].filter(Boolean).join(" · ") : "";
        patientHeaderHTML = '<div class="entry-item__patient">' + esc(pname) + (pmeta ? '<span class="entry-item__patient-meta">' + esc(pmeta) + '</span>' : '') + '</div>';

        var pills = [];
        var eff = entry.effortLevelId ? getEffortLevel(entry.effortLevelId) : null;
        if (eff) pills.push('<span class="mini-pill">Aufwand: ' + esc(eff.label) + '</span>');
        var tl = entry.timeLevelId ? getTimeLevel(entry.timeLevelId) : null;
        if (tl) pills.push('<span class="mini-pill">' + esc(tl.label) + '</span>');
        (entry.medications || []).forEach(function (m) {
          var med = getMedication(m.medId);
          var label = (med ? med.name : "Medikament") + (m.amount ? " " + m.amount : "") + " – " + medStatusLabel(m.status);
          pills.push('<span class="mini-pill' + (m.status === "abgelehnt" ? " mini-pill--warn" : "") + '">' + esc(label) + '</span>');
        });
        (entry.measurements || []).forEach(function (m) {
          var mt = getMeasurementType(m.measId);
          var label = (mt ? mt.name : "Messung") + (m.value ? ": " + m.value : "") + (mt && mt.unit && m.value ? " " + mt.unit : "");
          pills.push('<span class="mini-pill">' + esc(label) + '</span>');
        });
        if (pills.length) structuredHTML = '<div class="entry-item__structured">' + pills.join("") + '</div>';
      }
      var entryPhotosHTML = (entry.photos && entry.photos.length)
        ? '<div class="entry-item__photos">' + entry.photos.map(function (p) {
            return '<img src="' + p.data + '" data-view-entry-photo="' + p.id + '" alt="">';
          }).join("") + '</div>'
        : '';
      html +=
        '<div class="entry-item" data-entry="' + entry.id + '">' +
          '<div class="entry-item__row" style="' + (accent ? "--entry-color:" + accent : "") + '" data-toggle="' + entry.id + '">' +
            '<div class="entry-item__time">' + esc(formatTime(d)) + '</div>' +
            '<div class="entry-item__body">' +
              patientHeaderHTML +
              (entry.text ? '<div class="entry-item__text">' + esc(entry.text) + '</div>' : '') +
              structuredHTML +
              entryPhotosHTML +
              (peopleHTML ? '<div class="entry-item__people">' + peopleHTML + '</div>' : '') +
              (tagsHTML ? '<div class="entry-item__tags">' + tagsHTML + '</div>' : '') +
              photoLinkHTML +
            '</div>' +
          '</div>' +
          '<div class="entry-item__detail">' +
            '<div class="entry-item__actions">' +
              '<button type="button" class="btn btn--ghost btn--small" data-edit="' + entry.id + '" data-edit-mode="' + (isPatient ? "patient" : "shift") + '">Bearbeiten</button>' +
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
    container.querySelectorAll("[data-view-shift-photo]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var shift = state.shifts.filter(function (s) { return s.id === btn.dataset.viewShiftPhoto; })[0];
        if (shift) openShiftPhotoModal({ date: shift.date, type: shift.type });
      });
    });
    container.querySelectorAll("[data-view-entry-photo]").forEach(function (img) {
      img.addEventListener("click", function (e) {
        e.stopPropagation();
        openPhotoPreviewModal(img.getAttribute("src"));
      });
    });
    container.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (btn.dataset.editMode === "patient") openEditPatientEntryModal(btn.dataset.edit);
        else openEditEntryModal(btn.dataset.edit);
      });
    });
    container.querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var id = btn.dataset.delete;
        var idx = state.entries.findIndex(function (en) { return en.id === id; });
        if (idx === -1) return;
        var removed = state.entries[idx];
        state.entries.splice(idx, 1);
        persist();
        renderLog();
        renderCalendar();
        renderHashtagSuggestions();
        showUndoToast("Eintrag gelöscht", function () {
          state.entries.splice(idx, 0, removed);
          persist();
          renderLog();
          renderCalendar();
          renderHashtagSuggestions();
        });
      });
    });
  }

  function openEditEntryModal(entryId) {
    var entry = state.entries.filter(function (e) { return e.id === entryId; })[0];
    if (!entry) return;
    var d = new Date(entry.timestamp);
    var selected = (entry.personIds || []).slice();
    var editPhotos = (entry.photos || []).slice();

    var chips = "";
    state.categories.forEach(function (cat) {
      state.people.filter(function (p) { return p.categoryId === cat.id; }).forEach(function (p) {
        chips += chipHTML(p.id, p.name, cat.color, selected.indexOf(p.id) !== -1);
      });
    });

    var originalTsValue = toDateTimeLocalValue(d);
    var sheet = openModal("Eintrag bearbeiten", '' +
      '<div class="modal-field"><label for="editText">Situation</label>' +
      '<textarea id="editText">' + esc(entry.text) + '</textarea></div>' +
      '<div class="modal-field"><label for="editTs">Zeitpunkt</label>' +
      '<input type="datetime-local" id="editTs" value="' + originalTsValue + '"></div>' +
      '<div class="modal-field"><label>Beteiligt</label><div class="chip-row" id="editChips">' + chips + '</div></div>' +
      '<div class="modal-field"><label>Fotos</label><div data-role="photos-row" class="entry-photos-row"></div></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="editSaveBtn">Speichern</button>' +
      '</div>');

    function rerenderEditPhotos() { renderEntryPhotosUI(sheet, editPhotos, rerenderEditPhotos); }
    rerenderEditPhotos();

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
      // Zeitstempel nur überschreiben, wenn der Nutzer ihn wirklich geändert hat:
      // das Eingabefeld ist minutengenau, ein blindes Zurückschreiben würde die
      // Sekunden abschneiden und Einträge derselben Minute umsortieren.
      if (tsVal && tsVal !== originalTsValue) entry.timestamp = new Date(tsVal).toISOString();
      entry.personIds = selected;
      entry.hashtags = extractHashtags(newText);
      entry.photos = editPhotos.slice();
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
      if (entry.text && entry.text.toLowerCase().indexOf(q) !== -1) return true;
      if (entry.patientId) {
        var patient = getPatient(entry.patientId);
        if (patient && patient.name.toLowerCase().indexOf(q) !== -1) return true;
      }
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
    filterHashtags: [],
    filterPatients: []
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
    calState.filterPatients = [];
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
    if (calState.filterPatients.length) {
      if (calState.filterPatients.indexOf(entry.patientId) === -1) return false;
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

    var patientFilterWrap = document.getElementById("filterPatients");
    var patientsWithEntries = state.patients.filter(function (p) { return state.entries.some(function (e) { return e.patientId === p.id; }); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!patientsWithEntries.length) {
      patientFilterWrap.innerHTML = '<span class="category-empty">Noch keine Patienten-Einträge.</span>';
    } else {
      patientFilterWrap.innerHTML = patientsWithEntries.map(function (p) {
        var sel = calState.filterPatients.indexOf(p.id) !== -1;
        return '<button type="button" class="chip' + (sel ? " is-selected" : "") + '" style="--chip-color:var(--patient-accent)" data-patient-filter="' + p.id + '">' + esc(p.name) + '</button>';
      }).join("");
      patientFilterWrap.querySelectorAll("[data-patient-filter]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          var id = chip.dataset.patientFilter;
          var idx = calState.filterPatients.indexOf(id);
          if (idx === -1) calState.filterPatients.push(id); else calState.filterPatients.splice(idx, 1);
          renderCalendar();
        });
      });
    }

    var filterCount = calState.filterCategories.length + calState.filterPeople.length + calState.filterHashtags.length + calState.filterPatients.length;
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
        refreshPatientFormOptionUI();
        if (opts.autoSelect) {
          ui.selectedPersonIds.push(p.id);
          renderPersonChips();
        }
        toast("Person hinzugefügt");
        if (opts.onCreated) opts.onCreated(p);
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
        refreshPatientFormOptionUI();
        toast("Änderungen gespeichert");
      }
    });

    if (!isNew) {
      sheet.querySelector("#personDeleteBtn").addEventListener("click", function () {
        var removedPerson = person;
        var entryIdsWithPerson = state.entries.filter(function (e) { return (e.personIds || []).indexOf(person.id) !== -1; }).map(function (e) { return e.id; });
        var shiftIdsWithLeitung = state.shifts.filter(function (s) { return s.leitungId === person.id; }).map(function (s) { return s.id; });

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
        refreshPatientFormOptionUI();

        showUndoToast("„" + removedPerson.name + "“ gelöscht", function () {
          state.people.push(removedPerson);
          state.entries.forEach(function (e) {
            if (entryIdsWithPerson.indexOf(e.id) !== -1) {
              e.personIds = e.personIds || [];
              if (e.personIds.indexOf(removedPerson.id) === -1) e.personIds.push(removedPerson.id);
            }
          });
          state.shifts.forEach(function (s) {
            if (shiftIdsWithLeitung.indexOf(s.id) !== -1) s.leitungId = removedPerson.id;
          });
          persist();
          renderKontakte();
          renderPersonChips();
          renderLog();
          renderCalendar();
          renderMehr();
          refreshPatientFormOptionUI();
        });
      });
    }
  }


  /* =========================================================================
     PATIENTEN-MODUS
     Zweiter Dokumentationsmodus neben "Nach Schicht": Einträge werden einem
     Patienten zugeordnet und um strukturierte Felder ergänzt (Aufwand,
     Zeitaufwand, Medikamente inkl. Annahme/Ablehnung, Messungen, beteiligte
     Personen inkl. Rolle). Alles läuft weiterhin in state.entries zusammen
     (entry.mode unterscheidet), damit Log/Kalender/Suche/Export einheitlich
     bleiben.
     ========================================================================= */

  function refreshPatientFormOptionUI() {
    var wrap = document.getElementById("patientModeWrap");
    if (wrap && !wrap.hidden) renderPatientForm("patientFormRoot");
  }

  /* ---------- Generische Verwaltung der vier anpassbaren Listen ---------- */
  var OPTION_LIST_CONFIGS = {
    effort: { stateKey: "effortLevels", idPrefix: "eff", listElId: "effortLevelList", fields: [{ key: "label", label: "Bezeichnung", placeholder: "z. B. Mittel" }] },
    time: { stateKey: "timeLevels", idPrefix: "zeit", listElId: "timeLevelList", fields: [{ key: "label", label: "Bezeichnung", placeholder: "z. B. 5–15 Min" }] },
    medication: { stateKey: "medications", idPrefix: "med", listElId: "medicationList", fields: [{ key: "name", label: "Name", placeholder: "z. B. Paracetamol" }] },
    measurement: { stateKey: "measurementTypes", idPrefix: "meas", listElId: "measurementTypeList", fields: [{ key: "name", label: "Name", placeholder: "z. B. Blutdruck" }, { key: "unit", label: "Einheit (optional)", placeholder: "z. B. mmHg" }] }
  };

  function optionDisplayLabel(cfg, item) {
    var main = item[cfg.fields[0].key];
    if (cfg.fields.length > 1 && item[cfg.fields[1].key]) return main + " (" + item[cfg.fields[1].key] + ")";
    return main;
  }

  function renderOptionList(kind) {
    var cfg = OPTION_LIST_CONFIGS[kind];
    var wrap = document.getElementById(cfg.listElId);
    if (!wrap) return;
    var list = state[cfg.stateKey];
    if (!list.length) { wrap.innerHTML = '<p class="category-empty">Noch keine Einträge.</p>'; return; }
    wrap.innerHTML = list.map(function (item) {
      return '<div class="option-row"><div class="option-row__label">' + esc(optionDisplayLabel(cfg, item)) + '</div>' +
        '<button type="button" class="option-row__edit" data-edit-option="' + item.id + '" aria-label="Bearbeiten">✎</button></div>';
    }).join("");
    wrap.querySelectorAll("[data-edit-option]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = list.filter(function (x) { return x.id === btn.dataset.editOption; })[0];
        if (item) openOptionModal(kind, item);
      });
    });
  }

  function openOptionModal(kind, item) {
    var cfg = OPTION_LIST_CONFIGS[kind];
    var isNew = !item;
    var fieldsHtml = cfg.fields.map(function (f, i) {
      return '<div class="modal-field"><label for="optField' + i + '">' + esc(f.label) + '</label>' +
        '<input type="text" id="optField' + i + '" placeholder="' + esc(f.placeholder) + '" value="' + esc(item ? (item[f.key] || "") : "") + '"></div>';
    }).join("");
    var sheet = openModal(isNew ? "Hinzufügen" : "Bearbeiten", fieldsHtml +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="optSaveBtn">Speichern</button>' +
      '</div>' +
      (isNew ? "" : '<button type="button" class="btn btn--danger btn--block" id="optDeleteBtn" style="margin-top:10px;">Löschen</button>'));

    sheet.querySelector("#optSaveBtn").addEventListener("click", function () {
      var values = cfg.fields.map(function (f, i) { return sheet.querySelector("#optField" + i).value.trim(); });
      if (!values[0]) { toast("Bitte einen Namen eingeben."); return; }
      if (isNew) {
        var obj = { id: uid(cfg.idPrefix) };
        cfg.fields.forEach(function (f, i) { obj[f.key] = values[i]; });
        state[cfg.stateKey].push(obj);
        toast("Hinzugefügt");
      } else {
        cfg.fields.forEach(function (f, i) { item[f.key] = values[i]; });
        toast("Aktualisiert");
      }
      persist();
      closeModal();
      renderOptionList(kind);
      refreshPatientFormOptionUI();
      renderLog(); renderCalendar();
    });

    if (!isNew) {
      sheet.querySelector("#optDeleteBtn").addEventListener("click", function () {
        var idx = state[cfg.stateKey].findIndex(function (x) { return x.id === item.id; });
        if (idx === -1) return;
        var removed = state[cfg.stateKey][idx];
        state[cfg.stateKey].splice(idx, 1);
        persist();
        closeModal();
        renderOptionList(kind);
        refreshPatientFormOptionUI();
        showUndoToast("Gelöscht", function () {
          state[cfg.stateKey].splice(idx, 0, removed);
          persist();
          renderOptionList(kind);
          refreshPatientFormOptionUI();
        });
      });
    }
  }

  /* ---------- Patient/innen (Stammdaten) ---------- */
  function renderPatientList() {
    var wrap = document.getElementById("patientList");
    if (!wrap) return;
    var qEl = document.getElementById("patientSearch");
    var q = qEl ? qEl.value.trim().toLowerCase() : "";
    var list = state.patients.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) !== -1; })
      .slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!list.length) {
      wrap.innerHTML = '<p class="category-empty">' + (state.patients.length ? "Keine Treffer." : "Noch keine Patient/innen angelegt.") + '</p>';
      return;
    }
    wrap.innerHTML = list.map(function (p) {
      var initial = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
      var meta = [p.gender, p.room ? "Zimmer " + p.room : "", p.station].filter(Boolean).join(" · ");
      return '<div class="patient-row" data-patient-row="' + p.id + '">' +
        '<div class="patient-row__avatar">' + esc(initial) + '</div>' +
        '<div style="flex:1; min-width:0;"><div class="patient-row__name">' + esc(p.name) + (meta ? '<span class="patient-row__meta">' + esc(meta) + '</span>' : '') + '</div></div>' +
        '<button type="button" class="patient-row__edit" data-edit-patient="' + p.id + '" aria-label="Bearbeiten">✎</button>' +
      '</div>';
    }).join("");
    wrap.querySelectorAll("[data-patient-row]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest("[data-edit-patient]")) return;
        openPatientHistoryModal(row.dataset.patientRow);
      });
    });
    wrap.querySelectorAll("[data-edit-patient]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var p = getPatient(btn.dataset.editPatient);
        if (p) openPatientModal(p);
      });
    });
  }

  function openPatientModal(patient, opts) {
    opts = opts || {};
    var isNew = !patient;
    var genderOptions = GENDER_OPTIONS.map(function (g) {
      return '<option value="' + esc(g) + '"' + (patient && patient.gender === g ? " selected" : "") + '>' + esc(g) + '</option>';
    }).join("");
    var sheet = openModal(isNew ? "Patient/in hinzufügen" : "Patient/in bearbeiten", '' +
      '<div class="modal-field"><label for="patientNameInput">Name</label>' +
      '<input type="text" id="patientNameInput" placeholder="z. B. Frau Müller" value="' + esc(patient ? patient.name : "") + '"></div>' +
      '<div class="modal-field"><label for="patientGenderInput">Geschlecht</label>' +
      '<select id="patientGenderInput"><option value="">– keine Angabe –</option>' + genderOptions + '</select></div>' +
      '<div class="modal-field"><label for="patientRoomInput">Zimmer</label>' +
      '<input type="text" id="patientRoomInput" placeholder="z. B. 204" value="' + esc(patient && patient.room ? patient.room : "") + '"></div>' +
      '<div class="modal-field"><label for="patientStationInput">Station</label>' +
      '<input type="text" id="patientStationInput" placeholder="z. B. Station 3" value="' + esc(patient && patient.station ? patient.station : "") + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" data-close-modal>Abbrechen</button>' +
        '<button type="button" class="btn btn--primary" id="patientSaveBtn">Speichern</button>' +
      '</div>' +
      (isNew ? "" : '<button type="button" class="btn btn--danger btn--block" id="patientDeleteBtn" style="margin-top:10px;">Patient/in löschen</button>'));

    sheet.querySelector("#patientSaveBtn").addEventListener("click", function () {
      var name = sheet.querySelector("#patientNameInput").value.trim();
      if (!name) { toast("Bitte einen Namen eingeben."); return; }
      var gender = sheet.querySelector("#patientGenderInput").value;
      var room = sheet.querySelector("#patientRoomInput").value.trim();
      var station = sheet.querySelector("#patientStationInput").value.trim();
      if (isNew) {
        var p = { id: uid("patient"), name: name, gender: gender, room: room, station: station };
        state.patients.push(p);
        persist();
        closeModal();
        renderPatientList();
        refreshPatientFormOptionUI();
        toast("Patient/in hinzugefügt");
        if (opts.onCreated) opts.onCreated(p);
      } else {
        patient.name = name; patient.gender = gender; patient.room = room; patient.station = station;
        persist();
        closeModal();
        renderPatientList();
        refreshPatientFormOptionUI();
        renderLog(); renderCalendar();
        toast("Änderungen gespeichert");
      }
    });

    if (!isNew) {
      sheet.querySelector("#patientDeleteBtn").addEventListener("click", function () {
        var idx = state.patients.findIndex(function (x) { return x.id === patient.id; });
        if (idx === -1) return;
        var removed = state.patients[idx];
        state.patients.splice(idx, 1);
        if (patientUi.patientId === removed.id) patientUi.patientId = null;
        persist();
        closeModal();
        renderPatientList();
        refreshPatientFormOptionUI();
        renderLog(); renderCalendar();
        showUndoToast("„" + removed.name + "“ gelöscht", function () {
          state.patients.splice(idx, 0, removed);
          persist();
          renderPatientList();
          refreshPatientFormOptionUI();
          renderLog(); renderCalendar();
        });
      });
    }
  }

  function openPatientHistoryModal(patientId) {
    var patient = getPatient(patientId);
    if (!patient) return;
    var entries = state.entries.filter(function (e) { return e.patientId === patientId; });
    var meta = [patient.gender, patient.room ? "Zimmer " + patient.room : "", patient.station].filter(Boolean).join(" · ");
    var sheet = openModal(patient.name, '' +
      (meta ? '<p class="modal-text" style="margin-bottom:10px;">' + esc(meta) + '</p>' : "") +
      (entries.length
        ? '<div id="patientHistoryList" class="entry-list" style="max-height:56vh; overflow-y:auto;"></div>'
        : '<p class="modal-text">Noch keine Einträge für diese/n Patient/in.</p>') +
      '<div class="modal-actions" style="margin-top:14px;"><button type="button" class="btn btn--ghost btn--block" data-close-modal>Schliessen</button></div>');
    if (entries.length) {
      var listEl = sheet.querySelector("#patientHistoryList");
      listEl.innerHTML = buildEntryListHTML(entries);
      bindEntryListEvents(listEl);
    }
  }

  /* ---------- Patienten-Eintragsformular (Start-Ansicht & Bearbeiten-Modal) ----------
     Wichtig: Das Formular kann gleichzeitig zweimal im DOM vorkommen (Start-
     Ansicht + Bearbeiten-Modal), deshalb werden ausnahmslos root-gescopte
     Selektoren (root.querySelector) statt document.getElementById verwendet. */
  var patientUi = {
    patientId: null,
    timestamp: new Date(),
    effortLevelId: null,
    timeLevelId: null,
    medications: [],
    measurements: [],
    involvedPeople: [],
    text: "",
    photos: []
  };

  function renderPatientForm(targetId) {
    var root = document.getElementById(targetId);
    if (!root) return;
    var patient = patientUi.patientId ? getPatient(patientUi.patientId) : null;

    var html = "";
    html += '<div class="involved"><div class="involved__label">Patient/in</div>';
    if (patient) {
      var meta = [patient.gender, patient.room ? "Zimmer " + patient.room : "", patient.station].filter(Boolean).join(" · ");
      html += '<div class="patient-selected-card">' +
        '<div class="patient-selected-card__name">' + esc(patient.name) + '</div>' +
        '<button type="button" class="link-btn" data-role="change-patient">Wechseln</button>' +
        (meta ? '<div class="patient-selected-card__meta">' + esc(meta) + '</div>' : "") +
      '</div>';
    } else {
      html += '<div class="chip-row" data-role="patient-pick-chips"></div>';
    }
    html += '</div>';

    html += '<button type="button" class="timestamp-btn" data-role="patient-ts-btn">' +
      '<span data-role="patient-ts-label">' + esc(formatDateTimeLabel(patientUi.timestamp)) + '</span>' +
      '<span class="timestamp-btn__edit">Zeit ändern</span></button>';

    html += '<div class="involved"><div class="involved__label">Aufwand</div><div class="chip-row" data-role="effort-chips"></div></div>';
    html += '<div class="involved"><div class="involved__label">Zeitaufwand</div><div class="chip-row" data-role="timelevel-chips"></div></div>';

    html += '<div class="involved"><div class="involved__label">Medikamente</div><div data-role="med-rows"></div>' +
      (state.medications.length ? '<button type="button" class="chip chip--add" data-role="add-med-row">+ Medikament</button>' : '<span class="category-empty">Noch keine Medikamente hinterlegt (unter „Mehr“).</span>') +
      '</div>';

    html += '<div class="involved"><div class="involved__label">Messungen</div><div data-role="meas-rows"></div>' +
      (state.measurementTypes.length ? '<button type="button" class="chip chip--add" data-role="add-meas-row">+ Messung</button>' : '<span class="category-empty">Noch keine Messungen hinterlegt (unter „Mehr“).</span>') +
      '</div>';

    html += '<div class="involved"><div class="involved__label">Beteiligte Personen</div><div data-role="inv-rows"></div>' +
      '<div class="chip-row" data-role="inv-person-chips"></div></div>';

    html += '<div class="involved"><div class="involved__label">Vorlagen</div><div class="chip-row" data-role="patient-template-chips"></div></div>';

    html += '<div class="involved"><div class="involved__label">Notiz (optional)</div>' +
      '<textarea class="entry-textarea" rows="3" placeholder="Zusätzliche Notiz …" data-role="patient-text">' + esc(patientUi.text) + '</textarea></div>';

    html += '<div class="involved"><div class="involved__label">Fotos (optional)</div><div class="entry-photos-row" data-role="photos-row"></div></div>';

    html += '<div class="save-bar"><button type="button" class="btn btn--primary btn--block" data-role="save-patient-entry">Eintrag speichern</button></div>';

    root.innerHTML = html;

    var patientTextEl = root.querySelector('[data-role="patient-text"]');
    patientTextEl.addEventListener("input", function () { patientUi.text = patientTextEl.value; });

    if (!patient) {
      var pickWrap = root.querySelector('[data-role="patient-pick-chips"]');
      var patientsSorted = state.patients.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      pickWrap.innerHTML = patientsSorted.map(function (p) {
        return '<button type="button" class="chip" style="--chip-color:var(--patient-accent)" data-pick-patient="' + p.id + '">' + esc(p.name) + '</button>';
      }).join("") + '<button type="button" class="chip chip--add" data-role="quick-add-patient">+ Neu</button>';
      pickWrap.querySelectorAll("[data-pick-patient]").forEach(function (chip) {
        chip.addEventListener("click", function () { patientUi.patientId = chip.dataset.pickPatient; renderPatientForm(targetId); });
      });
      pickWrap.querySelector('[data-role="quick-add-patient"]').addEventListener("click", function () {
        openPatientModal(null, { onCreated: function (p) { patientUi.patientId = p.id; renderPatientForm(targetId); } });
      });
    } else {
      root.querySelector('[data-role="change-patient"]').addEventListener("click", function () {
        patientUi.patientId = null;
        renderPatientForm(targetId);
      });
    }

    root.querySelector('[data-role="patient-ts-btn"]').addEventListener("click", function () { openPatientTimestampModal(targetId); });

    var effWrap = root.querySelector('[data-role="effort-chips"]');
    effWrap.innerHTML = state.effortLevels.map(function (l) {
      return '<button type="button" class="chip' + (patientUi.effortLevelId === l.id ? " is-selected" : "") + '" style="--chip-color:var(--patient-accent)" data-effort="' + l.id + '">' + esc(l.label) + '</button>';
    }).join("");
    effWrap.querySelectorAll("[data-effort]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        patientUi.effortLevelId = patientUi.effortLevelId === chip.dataset.effort ? null : chip.dataset.effort;
        renderPatientForm(targetId);
      });
    });

    var timeWrap = root.querySelector('[data-role="timelevel-chips"]');
    timeWrap.innerHTML = state.timeLevels.map(function (l) {
      return '<button type="button" class="chip' + (patientUi.timeLevelId === l.id ? " is-selected" : "") + '" style="--chip-color:var(--patient-accent)" data-timelevel="' + l.id + '">' + esc(l.label) + '</button>';
    }).join("");
    timeWrap.querySelectorAll("[data-timelevel]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        patientUi.timeLevelId = patientUi.timeLevelId === chip.dataset.timelevel ? null : chip.dataset.timelevel;
        renderPatientForm(targetId);
      });
    });

    renderMedicationRows(root, targetId);
    var addMedBtn = root.querySelector('[data-role="add-med-row"]');
    if (addMedBtn) addMedBtn.addEventListener("click", function () {
      if (!state.medications.length) return;
      patientUi.medications.push({ medId: state.medications[0].id, status: "angenommen", amount: "" });
      renderPatientForm(targetId);
    });

    renderMeasurementRows(root, targetId);
    var addMeasBtn = root.querySelector('[data-role="add-meas-row"]');
    if (addMeasBtn) addMeasBtn.addEventListener("click", function () {
      if (!state.measurementTypes.length) return;
      patientUi.measurements.push({ measId: state.measurementTypes[0].id, value: "" });
      renderPatientForm(targetId);
    });

    renderInvolvedRows(root, targetId);
    var peopleWrap = root.querySelector('[data-role="inv-person-chips"]');
    var availablePeople = state.people.filter(function (p) { return !patientUi.involvedPeople.some(function (ip) { return ip.personId === p.id; }); });
    peopleWrap.innerHTML = availablePeople.map(function (p) {
      var col = categoryColorForPerson(p.id) || "#8A9793";
      return '<button type="button" class="chip" style="--chip-color:' + col + '" data-add-involved="' + p.id + '"><span class="chip__dot"></span>' + esc(p.name) + '</button>';
    }).join("") + '<button type="button" class="chip chip--add" data-role="quick-add-person">+ Person</button>';
    peopleWrap.querySelectorAll("[data-add-involved]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        patientUi.involvedPeople.push({ personId: chip.dataset.addInvolved, role: "" });
        renderPatientForm(targetId);
      });
    });
    peopleWrap.querySelector('[data-role="quick-add-person"]').addEventListener("click", function () { openPersonModal(null); });

    var tplWrap = root.querySelector('[data-role="patient-template-chips"]');
    var templates = state.templates || [];
    if (!templates.length) {
      tplWrap.innerHTML = '<span class="category-empty">Noch keine Vorlagen – unter „Mehr“ anlegen.</span>';
    } else {
      tplWrap.innerHTML = templates.map(function (t) {
        return '<button type="button" class="chip" style="--chip-color:var(--patient-accent)" data-template="' + t.id + '" title="' + esc(t.text) + '">' + esc(templateChipLabel(t)) + "</button>";
      }).join("");
      tplWrap.querySelectorAll("[data-template]").forEach(function (chip) {
        chip.addEventListener("click", function () {
          var t = templates.filter(function (x) { return x.id === chip.dataset.template; })[0];
          if (!t) return;
          var textEl = root.querySelector('[data-role="patient-text"]');
          insertTemplateIntoTextarea(textEl, t.text, {
            onPersonInvolved: function (p) {
              if (!patientUi.involvedPeople.some(function (ip) { return ip.personId === p.id; })) {
                patientUi.involvedPeople.push({ personId: p.id, role: "" });
              }
              renderPatientForm(targetId);
            }
          });
        });
      });
    }

    renderEntryPhotosUI(root, patientUi.photos, function () { renderPatientForm(targetId); });

    root.querySelector('[data-role="save-patient-entry"]').addEventListener("click", function () { savePatientEntry(targetId); });
  }

  function renderMedicationRows(root, targetId) {
    var wrap = root.querySelector('[data-role="med-rows"]');
    if (!wrap) return;
    wrap.innerHTML = patientUi.medications.map(function (row, idx) {
      var medOptions = state.medications.map(function (m) {
        return '<option value="' + m.id + '"' + (m.id === row.medId ? " selected" : "") + '>' + esc(m.name) + '</option>';
      }).join("");
      var statusBtns = MED_STATUS_OPTIONS.map(function (s) {
        return '<button type="button" class="' + (row.status === s.id ? "is-active" : "") + '" data-status="' + s.id + '" data-row="' + idx + '">' + esc(s.label) + '</button>';
      }).join("");
      return '<div class="dyn-row">' +
        '<select data-med-select="' + idx + '">' + medOptions + '</select>' +
        '<input type="text" placeholder="Menge/Dosis" value="' + esc(row.amount || "") + '" data-med-amount="' + idx + '">' +
        '<div class="dyn-row__status">' + statusBtns + '</div>' +
        '<button type="button" class="dyn-row__remove" data-med-remove="' + idx + '" aria-label="Entfernen">✕</button>' +
      '</div>';
    }).join("");
    wrap.querySelectorAll("[data-med-select]").forEach(function (sel) {
      sel.addEventListener("change", function () { patientUi.medications[Number(sel.dataset.medSelect)].medId = sel.value; });
    });
    wrap.querySelectorAll("[data-med-amount]").forEach(function (inp) {
      inp.addEventListener("input", function () { patientUi.medications[Number(inp.dataset.medAmount)].amount = inp.value; });
    });
    wrap.querySelectorAll("[data-status]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        patientUi.medications[Number(btn.dataset.row)].status = btn.dataset.status;
        renderPatientForm(targetId);
      });
    });
    wrap.querySelectorAll("[data-med-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        patientUi.medications.splice(Number(btn.dataset.medRemove), 1);
        renderPatientForm(targetId);
      });
    });
  }

  function renderMeasurementRows(root, targetId) {
    var wrap = root.querySelector('[data-role="meas-rows"]');
    if (!wrap) return;
    wrap.innerHTML = patientUi.measurements.map(function (row, idx) {
      var opts = state.measurementTypes.map(function (m) {
        var label = m.unit ? m.name + " (" + m.unit + ")" : m.name;
        return '<option value="' + m.id + '"' + (m.id === row.measId ? " selected" : "") + '>' + esc(label) + '</option>';
      }).join("");
      return '<div class="dyn-row">' +
        '<select data-meas-select="' + idx + '">' + opts + '</select>' +
        '<input type="text" placeholder="Wert" value="' + esc(row.value || "") + '" data-meas-value="' + idx + '">' +
        '<button type="button" class="dyn-row__remove" data-meas-remove="' + idx + '" aria-label="Entfernen">✕</button>' +
      '</div>';
    }).join("");
    wrap.querySelectorAll("[data-meas-select]").forEach(function (sel) {
      sel.addEventListener("change", function () { patientUi.measurements[Number(sel.dataset.measSelect)].measId = sel.value; });
    });
    wrap.querySelectorAll("[data-meas-value]").forEach(function (inp) {
      inp.addEventListener("input", function () { patientUi.measurements[Number(inp.dataset.measValue)].value = inp.value; });
    });
    wrap.querySelectorAll("[data-meas-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        patientUi.measurements.splice(Number(btn.dataset.measRemove), 1);
        renderPatientForm(targetId);
      });
    });
  }

  function renderInvolvedRows(root, targetId) {
    var wrap = root.querySelector('[data-role="inv-rows"]');
    if (!wrap) return;
    wrap.innerHTML = patientUi.involvedPeople.map(function (row, idx) {
      var p = getPerson(row.personId);
      var name = p ? p.name : "Unbekannt";
      var col = p ? (categoryColorForPerson(p.id) || "#8A9793") : "#8A9793";
      return '<div class="dyn-row">' +
        '<span class="dyn-row__name" style="color:' + col + '">' + esc(name) + '</span>' +
        '<input type="text" placeholder="Wie involviert? (z. B. informiert)" value="' + esc(row.role || "") + '" data-inv-role="' + idx + '">' +
        '<button type="button" class="dyn-row__remove" data-inv-remove="' + idx + '" aria-label="Entfernen">✕</button>' +
      '</div>';
    }).join("");
    wrap.querySelectorAll("[data-inv-role]").forEach(function (inp) {
      inp.addEventListener("input", function () { patientUi.involvedPeople[Number(inp.dataset.invRole)].role = inp.value; });
    });
    wrap.querySelectorAll("[data-inv-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        patientUi.involvedPeople.splice(Number(btn.dataset.invRemove), 1);
        renderPatientForm(targetId);
      });
    });
  }

  function openPatientTimestampModal(targetId) {
    var sheet = openModal("Zeitpunkt", '' +
      '<div class="modal-field"><label for="patientTsInput">Datum &amp; Uhrzeit</label>' +
      '<input type="datetime-local" id="patientTsInput" value="' + toDateTimeLocalValue(patientUi.timestamp) + '"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" id="patientTsNowBtn">Jetzt</button>' +
        '<button type="button" class="btn btn--primary" id="patientTsSaveBtn">Übernehmen</button>' +
      '</div>');
    function apply() {
      closeModal();
      var root = document.getElementById(targetId);
      var label = root && root.querySelector('[data-role="patient-ts-label"]');
      if (label) label.textContent = formatDateTimeLabel(patientUi.timestamp);
    }
    sheet.querySelector("#patientTsNowBtn").addEventListener("click", function () { patientUi.timestamp = new Date(); apply(); });
    sheet.querySelector("#patientTsSaveBtn").addEventListener("click", function () {
      var val = sheet.querySelector("#patientTsInput").value;
      if (val) patientUi.timestamp = new Date(val);
      apply();
    });
  }

  function resetPatientUi() {
    patientUi = {
      patientId: patientUi.patientId, // Patient bleibt ausgewählt – meist mehrere Einträge nacheinander
      timestamp: new Date(),
      effortLevelId: null,
      timeLevelId: null,
      medications: [],
      measurements: [],
      involvedPeople: [],
      text: "",
      photos: []
    };
  }

  function savePatientEntry(targetId) {
    if (!patientUi.patientId) { toast("Bitte zuerst einen Patienten auswählen."); return; }
    var root = document.getElementById(targetId);
    var textEl = root.querySelector('[data-role="patient-text"]');
    var text = textEl ? textEl.value.trim() : "";

    var entry = {
      id: uid("entry"),
      timestamp: patientUi.timestamp.toISOString(),
      text: text,
      personIds: patientUi.involvedPeople.map(function (r) { return r.personId; }),
      personRoles: patientUi.involvedPeople.reduce(function (acc, r) { if (r.role) acc[r.personId] = r.role; return acc; }, {}),
      hashtags: extractHashtags(text),
      shiftDate: ui.shift.date,
      shiftType: ui.shift.type,
      mode: "patient",
      patientId: patientUi.patientId,
      effortLevelId: patientUi.effortLevelId,
      timeLevelId: patientUi.timeLevelId,
      medications: patientUi.medications.filter(function (m) { return m.medId; }).map(function (m) { return { medId: m.medId, status: m.status, amount: m.amount || "" }; }),
      measurements: patientUi.measurements.filter(function (m) { return m.measId; }).map(function (m) { return { measId: m.measId, value: m.value || "" }; }),
      photos: patientUi.photos.slice()
    };
    state.entries.push(entry);
    persist();

    resetPatientUi();
    renderPatientForm(targetId);
    renderHashtagSuggestions();
    toast("Gespeichert");
  }

  function openEditPatientEntryModal(entryId) {
    var entry = state.entries.filter(function (e) { return e.id === entryId; })[0];
    if (!entry) return;
    var savedUi = patientUi;
    patientUi = {
      patientId: entry.patientId || null,
      timestamp: new Date(entry.timestamp),
      effortLevelId: entry.effortLevelId || null,
      timeLevelId: entry.timeLevelId || null,
      medications: (entry.medications || []).map(function (m) { return { medId: m.medId, status: m.status, amount: m.amount }; }),
      measurements: (entry.measurements || []).map(function (m) { return { measId: m.measId, value: m.value }; }),
      involvedPeople: (entry.personIds || []).map(function (pid) { return { personId: pid, role: (entry.personRoles || {})[pid] || "" }; }),
      text: entry.text || "",
      photos: (entry.photos || []).slice()
    };

    var sheet = openModal("Patienten-Eintrag bearbeiten", '<div id="patientFormRootModal"></div>');
    renderPatientForm("patientFormRootModal");
    var saveBtn = sheet.querySelector('[data-role="save-patient-entry"]');
    saveBtn.textContent = "Änderungen speichern";
    var freshSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(freshSaveBtn, saveBtn);
    freshSaveBtn.addEventListener("click", function () {
      if (!patientUi.patientId) { toast("Bitte einen Patienten auswählen."); return; }
      var txtEl = sheet.querySelector('[data-role="patient-text"]');
      entry.text = txtEl ? txtEl.value.trim() : "";
      entry.timestamp = patientUi.timestamp.toISOString();
      entry.patientId = patientUi.patientId;
      entry.effortLevelId = patientUi.effortLevelId;
      entry.timeLevelId = patientUi.timeLevelId;
      entry.medications = patientUi.medications.filter(function (m) { return m.medId; }).map(function (m) { return { medId: m.medId, status: m.status, amount: m.amount || "" }; });
      entry.measurements = patientUi.measurements.filter(function (m) { return m.measId; }).map(function (m) { return { measId: m.measId, value: m.value || "" }; });
      entry.personIds = patientUi.involvedPeople.map(function (r) { return r.personId; });
      entry.personRoles = patientUi.involvedPeople.reduce(function (acc, r) { if (r.role) acc[r.personId] = r.role; return acc; }, {});
      entry.hashtags = extractHashtags(entry.text);
      entry.photos = patientUi.photos.slice();
      persist();
      patientUi = savedUi;
      closeModal();
      renderLog(); renderCalendar(); renderHashtagSuggestions();
      toast("Änderungen gespeichert");
    });

    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--ghost btn--block";
    cancelBtn.style.marginTop = "8px";
    cancelBtn.textContent = "Abbrechen";
    cancelBtn.addEventListener("click", function () { patientUi = savedUi; closeModal(); });
    sheet.appendChild(cancelBtn);
  }

  /* ---------- Modus-Umschalter ---------- */
  // UI-Sync ohne Seiteneffekt (kein persist()) – für den Init-Aufruf, der
  // lediglich den bereits gespeicherten Modus in der Oberfläche abbildet.
  // Ein persist() an dieser Stelle wäre ein reiner No-op-Schreibvorgang bei
  // jedem App-Start und könnte z. B. unnötig die Speicher-Warnung auslösen.
  function applyEntryModeUI(mode) {
    document.querySelectorAll('#entryModeSwitch [data-mode]').forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
    document.getElementById("shiftModeWrap").hidden = mode !== "shift";
    document.getElementById("patientModeWrap").hidden = mode !== "patient";
    if (mode === "patient") renderPatientForm("patientFormRoot");
  }

  function setEntryMode(mode) {
    state.settings.lastEntryMode = mode;
    persist();
    applyEntryModeUI(mode);
  }

  function setKontakteMode(mode) {
    document.querySelectorAll('#kontakteModeSwitch [data-kmode]').forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.kmode === mode);
    });
    document.getElementById("personenWrap").hidden = mode !== "personen";
    document.getElementById("patientenWrap").hidden = mode !== "patienten";
    if (mode === "patienten") renderPatientList();
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

  // Verknüpft ein Schicht-Foto automatisch mit einem Log-Eintrag von diesem Tag:
  // existiert schon ein Eintrag, der auf diese Schicht verweist, passiert nichts
  // (verhindert Duplikate bei jedem erneuten Speichern/Bearbeiten). Sonst wird
  // ein kurzer, automatischer Eintrag angelegt, der die Schichtleitung (falls
  // vorhanden) direkt als beteiligte Person übernimmt.
  function ensureEntryLinkedToShift(shift) {
    var alreadyLinked = state.entries.some(function (e) { return e.shiftPhotoId === shift.id; });
    if (alreadyLinked) return;

    var text = "📷 Foto des Zuteilungsplans hinzugefügt";
    if (shift.station) text += " – " + shift.station;
    text += ".";

    var d = new Date();
    var parts = shift.date.split("-").map(Number);
    d.setFullYear(parts[0], parts[1] - 1, parts[2]);

    state.entries.push({
      id: uid("entry"),
      timestamp: d.toISOString(),
      text: text,
      personIds: shift.leitungId ? [shift.leitungId] : [],
      hashtags: extractHashtags(text),
      shiftDate: shift.date,
      shiftType: shift.type,
      shiftPhotoId: shift.id
    });
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

  function openPhotoPreviewModal(src) {
    openModal("Foto", '<img class="photo-preview" src="' + src + '" alt="">' +
      '<button type="button" class="btn btn--ghost btn--block" data-close-modal style="margin-top:12px;">Schliessen</button>');
  }

  // Generische, mehrfach verwendbare Foto-Anhang-Komponente für Einträge
  // (Schicht- wie Patienten-Modus, sowohl auf der Start-Seite als auch in
  // Bearbeiten-Modals). `photosArray` (Array von {id, data}) wird direkt
  // mutiert; `onChange` löst ein Re-Rendering des jeweiligen Formulars aus.
  // Root-gescopt, damit mehrere Instanzen gleichzeitig im DOM unschädlich
  // sind (siehe Patienten-Formular).
  function renderEntryPhotosUI(root, photosArray, onChange) {
    var wrap = root.querySelector('[data-role="photos-row"]');
    if (!wrap) return;
    wrap.innerHTML = photosArray.map(function (p) {
      return '<div class="entry-photo-item"><img src="' + p.data + '" data-view-photo="' + p.id + '" alt="">' +
        '<button type="button" class="entry-photo-item__remove" data-remove-photo="' + p.id + '" aria-label="Foto entfernen">✕</button></div>';
    }).join("") + '<label class="entry-photo-add" aria-label="Foto hinzufügen">+' +
      '<input type="file" accept="image/*" capture="environment" multiple data-role="add-photo-input" hidden></label>';

    wrap.querySelectorAll("[data-view-photo]").forEach(function (img) {
      img.addEventListener("click", function () { openPhotoPreviewModal(img.getAttribute("src")); });
    });
    wrap.querySelectorAll("[data-remove-photo]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = photosArray.findIndex(function (p) { return p.id === btn.dataset.removePhoto; });
        if (idx !== -1) photosArray.splice(idx, 1);
        onChange();
      });
    });
    var input = wrap.querySelector('[data-role="add-photo-input"]');
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      Promise.all(files.map(function (f) { return fileToCompressedDataURL(f, 1280, 0.72); }))
        .then(function (dataUrls) {
          dataUrls.forEach(function (d) { photosArray.push({ id: uid("photo"), data: d }); });
          onChange();
        })
        .catch(function (err) { toast(err.message || "Foto konnte nicht verarbeitet werden."); });
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
        target = { id: uid("shift"), date: date, type: type, photo: pendingPhoto, note: "", station: station, leitungId: leitungId };
        state.shifts.push(target);
      }
      ensureEntryLinkedToShift(target);
      persist();
      closeModal();
      renderMehr();
      renderLog();
      renderCalendar();
      renderPersonChips();
      renderHashtagSuggestions();
      toast("Schicht-Foto gespeichert");
    });

    if (existing) {
      sheet.querySelector("#shiftPhotoDeleteBtn").addEventListener("click", function () {
        var removedShift = existing;
        var idx = state.shifts.findIndex(function (s) { return s.id === existing.id; });
        if (idx === -1) return;
        state.shifts.splice(idx, 1);
        persist();
        closeModal();
        renderMehr();
        renderLog();
        renderCalendar();
        showUndoToast("Schicht-Foto gelöscht", function () {
          state.shifts.splice(idx, 0, removedShift);
          persist();
          renderMehr();
          renderLog();
          renderCalendar();
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
          : '<div class="shift-photo-row__thumb shift-photo-row__thumb--placeholder">' + ICONS.camera + '</div>';
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
    renderLockSettings();
    renderTemplateList();
    renderOptionList("effort");
    renderOptionList("time");
    renderOptionList("medication");
    renderOptionList("measurement");
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

  // Liest ein ZIP-Archiv (ArrayBuffer) und gibt seine Dateien zurück.
  // Unterstützt bewusst nur die Speichermethode "store" (unkomprimiert) –
  // genau das, was buildZip() oben erzeugt. Eine Datei mit "echter"
  // Komprimierung (z. B. neu gepackt von einem normalen Zip-Tool) wird
  // erkannt und als "unsupported" markiert statt falsche Daten zu liefern.
  function readZipEntries(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    var bytes = new Uint8Array(arrayBuffer);

    var eocdOffset = -1;
    for (var i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) throw new Error("Keine gültige ZIP-Datei gefunden.");

    var totalEntries = view.getUint16(eocdOffset + 10, true);
    var centralDirOffset = view.getUint32(eocdOffset + 16, true);

    var entries = [];
    var offset = centralDirOffset;
    for (var e = 0; e < totalEntries; e++) {
      var sig = view.getUint32(offset, true);
      if (sig !== 0x02014b50) throw new Error("ZIP-Datei ist beschädigt oder hat ein unerwartetes Format.");
      var compressionMethod = view.getUint16(offset + 10, true);
      var uncompressedSize = view.getUint32(offset + 24, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localHeaderOffset = view.getUint32(offset + 42, true);
      var name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLen));

      var lSig = view.getUint32(localHeaderOffset, true);
      if (lSig !== 0x04034b50) throw new Error("ZIP-Datei ist beschädigt (ungültiger Dateikopf).");
      var lNameLen = view.getUint16(localHeaderOffset + 26, true);
      var lExtraLen = view.getUint16(localHeaderOffset + 28, true);
      var dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;

      if (compressionMethod !== 0) {
        entries.push({ name: name, unsupported: true });
      } else {
        entries.push({ name: name, data: bytes.slice(dataStart, dataStart + uncompressedSize) });
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function dataUrlToBytes(dataUrl) { return base64ToBytes(dataUrl.split(",")[1]); }
  function bytesToDataUrl(bytes, mime) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return "data:" + mime + ";base64," + btoa(binary);
  }

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

  // ---- Log als Tabelle pro Tag (Zeit | Ereignis) — wirkt deutlich
  // professioneller/berichtsartiger als lose Absätze. ----
  var WTABLE_COL_TIME = 1250;
  var WTABLE_COL_TEXT = 8388; // Summe = 9638 twips = Satzspiegelbreite bei A4/2cm Rand

  function wTableRowXml(entry, entryPhotoRelMap) {
    var d = new Date(entry.timestamp);
    var timeCell = '<w:tc><w:tcPr><w:tcW w:w="' + WTABLE_COL_TIME + '" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>' +
      '<w:p><w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">' + xmlEsc(formatTime(d)) + '</w:t></w:r></w:p></w:tc>';

    var patientPara = "";
    var structuredPara = "";
    if (entry.mode === "patient") {
      var patient = entry.patientId ? getPatient(entry.patientId) : null;
      var pname = patient ? patient.name : "Unbekannte/r Patient/in";
      var pmeta = patient ? [patient.gender, patient.room ? "Zimmer " + patient.room : "", patient.station].filter(Boolean).join(" · ") : "";
      patientPara = '<w:p><w:pPr><w:spacing w:before="40" w:after="20"/></w:pPr>' +
        '<w:r><w:rPr><w:b/><w:color w:val="B34D7A"/></w:rPr><w:t xml:space="preserve">' + xmlEsc(pname) + '</w:t></w:r>' +
        (pmeta ? '<w:r><w:rPr><w:color w:val="999999"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">  ·  ' + xmlEsc(pmeta) + '</w:t></w:r>' : '') +
        '</w:p>';

      var bits = [];
      var eff = entry.effortLevelId ? getEffortLevel(entry.effortLevelId) : null;
      if (eff) bits.push("Aufwand: " + eff.label);
      var tl = entry.timeLevelId ? getTimeLevel(entry.timeLevelId) : null;
      if (tl) bits.push("Zeitaufwand: " + tl.label);
      if (bits.length) {
        structuredPara += '<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr>' +
          '<w:t xml:space="preserve">' + xmlEsc(bits.join("  ·  ")) + '</w:t></w:r></w:p>';
      }
      (entry.medications || []).forEach(function (m) {
        var med = getMedication(m.medId);
        var line = "Medikament: " + (med ? med.name : "?") + (m.amount ? " " + m.amount : "") + " – " + medStatusLabel(m.status);
        structuredPara += '<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/>' +
          (m.status === "abgelehnt" ? '<w:color w:val="A93F2B"/>' : '<w:color w:val="5B6864"/>') + '</w:rPr>' +
          '<w:t xml:space="preserve">' + xmlEsc(line) + '</w:t></w:r></w:p>';
      });
      (entry.measurements || []).forEach(function (m) {
        var mt = getMeasurementType(m.measId);
        var line = "Messung: " + (mt ? mt.name : "?") + (m.value ? ": " + m.value : "") + (mt && mt.unit && m.value ? " " + mt.unit : "");
        structuredPara += '<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="5B6864"/></w:rPr>' +
          '<w:t xml:space="preserve">' + xmlEsc(line) + '</w:t></w:r></w:p>';
      });
    }

    var textPara = entry.text ? '<w:p><w:pPr><w:spacing w:before="60" w:after="40"/></w:pPr>' + wTextRunsXml(entry.text) + '</w:p>' : "";

    var names = (entry.personIds || []).map(function (pid) {
      var p = getPerson(pid);
      if (!p) return null;
      var cat = getCategory(p.categoryId);
      var role = entry.personRoles && entry.personRoles[pid] ? " – " + entry.personRoles[pid] : "";
      return p.name + (cat ? " (" + cat.name + ")" : "") + role;
    }).filter(function (x) { return x; });
    var peoplePara = names.length
      ? '<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr>' +
        '<w:t xml:space="preserve">Beteiligt: ' + xmlEsc(names.join(", ")) + '</w:t></w:r></w:p>'
      : '';

    var tags = entry.hashtags || [];
    var tagsPara = tags.length
      ? '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:color w:val="0F5C56"/><w:sz w:val="17"/></w:rPr>' +
        '<w:t xml:space="preserve">' + xmlEsc(tags.map(function (t) { return "#" + t; }).join("   ")) + '</w:t></w:r></w:p>'
      : '';

    var photosXml = "";
    var entryImgs = entryPhotoRelMap ? (entryPhotoRelMap[entry.id] || []) : [];
    if (entryImgs.length) {
      photosXml = entryImgs.map(wImageXml).join("");
    }

    var textCell = '<w:tc><w:tcPr><w:tcW w:w="' + WTABLE_COL_TEXT + '" w:type="dxa"/></w:tcPr>' + patientPara + structuredPara + textPara + peoplePara + tagsPara + photosXml + '</w:tc>';
    return '<w:tr>' + timeCell + textCell + '</w:tr>';
  }

  function wTableBorderXml() {
    return '<w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:color="DDE4E1"/><w:left w:val="single" w:sz="4" w:color="DDE4E1"/>' +
      '<w:bottom w:val="single" w:sz="4" w:color="DDE4E1"/><w:right w:val="single" w:sz="4" w:color="DDE4E1"/>' +
      '<w:insideH w:val="single" w:sz="4" w:color="DDE4E1"/><w:insideV w:val="single" w:sz="4" w:color="DDE4E1"/>' +
    '</w:tblBorders>';
  }

  function wDayTableXml(dayEntries, entryPhotoRelMap) {
    var header = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
      '<w:tc><w:tcPr><w:tcW w:w="' + WTABLE_COL_TIME + '" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="0F5C56"/></w:tcPr>' +
        '<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr><w:t>Zeit</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="' + WTABLE_COL_TEXT + '" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="0F5C56"/></w:tcPr>' +
        '<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="18"/></w:rPr><w:t>Ereignis</w:t></w:r></w:p></w:tc>' +
    '</w:tr>';
    var rows = dayEntries.map(function (entry) { return wTableRowXml(entry, entryPhotoRelMap); }).join("");
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + wTableBorderXml() + '<w:tblLayout w:type="fixed"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="' + WTABLE_COL_TIME + '"/><w:gridCol w:w="' + WTABLE_COL_TEXT + '"/></w:tblGrid>' +
      header + rows + '</w:tbl>' +
      '<w:p><w:pPr><w:spacing w:after="220"/></w:pPr></w:p>';
  }

  // ---- Schicht-Fotos: gerahmtes Bild mit Bildunterschrift darunter ----
  function wImageXml(img) {
    return '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:drawing>' +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + img.emuW + '" cy="' + img.emuH + '"/>' +
        '<wp:docPr id="' + img.docPrId + '" name="Bild' + img.docPrId + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
          '<pic:pic>' +
            '<pic:nvPicPr><pic:cNvPr id="' + img.docPrId + '" name="Bild' + img.docPrId + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
            '<pic:blipFill><a:blip r:embed="' + img.relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + img.emuW + '" cy="' + img.emuH + '"/></a:xfrm>' +
              '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
              '<a:ln w="9525"><a:solidFill><a:srgbClr val="C9D2CF"/></a:solidFill></a:ln>' +
            '</pic:spPr>' +
          '</pic:pic>' +
        '</a:graphicData></a:graphic>' +
      '</wp:inline>' +
    '</w:drawing></w:r></w:p>';
  }

  function wCaptionXml(text) {
    return '<w:p><w:pPr><w:spacing w:after="300"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr>' +
      '<w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r></w:p>';
  }

  function buildWordBodyXml(imageRelMap, range, entryPhotoRelMap) {
    var body = "";
    body += wHeadingXml("Schichtprotokoll", 1);
    body += '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:color w:val="5B6864"/><w:sz w:val="20"/></w:rPr>' +
      '<w:t xml:space="preserve">Dokumentation &amp; Verlaufsprotokoll</w:t></w:r></w:p>';
    var now = new Date();
    var metaLine = "Erstellt am " + formatDateShort(now) + " · " + formatTime(now);
    if (range) metaLine += "  ·  Zeitraum: " + (range.from || "…") + " bis " + (range.to || "…");
    body += '<w:p><w:pPr><w:spacing w:after="320"/></w:pPr><w:r><w:rPr><w:color w:val="999999"/><w:sz w:val="18"/></w:rPr>' +
      '<w:t xml:space="preserve">' + xmlEsc(metaLine) + '</w:t></w:r></w:p>';

    body += wHeadingXml("Log", 2);
    var filteredEntries = range ? state.entries.filter(function (e) { return entryInRange(e, range); }) : state.entries;
    var sorted = filteredEntries.slice().sort(function (a, b) { return new Date(a.timestamp) - new Date(b.timestamp); });
    if (!sorted.length) {
      body += '<w:p><w:r><w:t xml:space="preserve">Keine Einträge vorhanden.</w:t></w:r></w:p>';
    } else {
      var lastDay = null, dayBucket = [];
      var flushDay = function () {
        if (dayBucket.length) { body += wDayTableXml(dayBucket, entryPhotoRelMap); dayBucket = []; }
      };
      sorted.forEach(function (entry) {
        var key = dateToKey(new Date(entry.timestamp));
        if (key !== lastDay) {
          flushDay();
          body += wHeadingXml(formatDateFullAbsolute(key), 3);
          lastDay = key;
        }
        dayBucket.push(entry);
      });
      flushDay();
    }

    body += wHeadingXml("Schichtfotos", 2);
    if (!imageRelMap.length) {
      body += '<w:p><w:r><w:t xml:space="preserve">Keine Schicht-Fotos vorhanden.</w:t></w:r></w:p>';
    } else {
      imageRelMap.forEach(function (img) {
        var parts = img.shift.date.split("-").map(Number);
        var d = new Date(parts[0], parts[1] - 1, parts[2]);
        body += wHeadingXml(formatDateShort(d) + " · " + img.shift.type, 3);
        body += wImageXml(img);
        var captionBits = [];
        if (img.shift.station) captionBits.push(img.shift.station);
        var leader = img.shift.leitungId ? getPerson(img.shift.leitungId) : null;
        if (leader) captionBits.push("Leitung: " + leader.name);
        if (captionBits.length) body += wCaptionXml(captionBits.join(" · "));
      });
    }

    body += '<w:sectPr>' +
      '<w:footerReference w:type="default" r:id="rIdFooter"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:footer="567"/>' +
    '</w:sectPr>';
    return body;
  }

  function exportWord() {
    toast("Word-Dokument wird erstellt …");
    var range = getExportDateRange();
    var shiftsWithPhotos = state.shifts.filter(function (s) { return s.photo && dateInRange(s.date, range); })
      .slice().sort(function (a, b) { return a.date.localeCompare(b.date) || a.type.localeCompare(b.type); });

    // Eintrags-Fotos (Schicht- wie Patienten-Modus) der gefilterten Einträge
    // separat einsammeln – landen kleiner direkt in der jeweiligen
    // Tabellenzeile statt im Schichtfotos-Abschnitt.
    var filteredEntriesForPhotos = range ? state.entries.filter(function (e) { return entryInRange(e, range); }) : state.entries;
    var entryPhotoList = [];
    filteredEntriesForPhotos.forEach(function (e) {
      (e.photos || []).forEach(function (p) { entryPhotoList.push({ entry: e, photo: p }); });
    });

    var allPhotoSources = shiftsWithPhotos.map(function (s) { return s.photo; })
      .concat(entryPhotoList.map(function (x) { return x.photo.data; }));

    Promise.all(allPhotoSources.map(function (src) { return getImageNaturalSize(src); }))
      .then(function (sizes) {
        var MAX_W_PX = 580;  // ~6.1in, passt in den Satzspiegel bei A4
        var MAX_H_PX = 700;  // verhindert, dass Hochformat-Fotos die ganze Seite füllen
        var ENTRY_MAX_W_PX = 260, ENTRY_MAX_H_PX = 260; // kleiner: sitzen in der Tabellenzelle
        var mediaFiles = [], relEntries = [], imageRelMap = [];
        var relCounter = 1, docPrCounter = 10;

        shiftsWithPhotos.forEach(function (s, idx) {
          var nat = sizes[idx];
          var scale = Math.min(1, MAX_W_PX / nat.width, MAX_H_PX / nat.height);
          var emuW = Math.round(nat.width * scale * 9525);
          var emuH = Math.round(nat.height * scale * 9525);
          var relId = "rIdImg" + relCounter;
          var fileName = "image" + relCounter + ".jpeg";
          relCounter++;
          mediaFiles.push({ name: "word/media/" + fileName, data: dataUrlToBytes(s.photo) });
          relEntries.push('<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + fileName + '"/>');
          imageRelMap.push({ shift: s, relId: relId, emuW: emuW, emuH: emuH, docPrId: docPrCounter++ });
        });

        var entryPhotoRelMap = {};
        entryPhotoList.forEach(function (item, i) {
          var nat = sizes[shiftsWithPhotos.length + i];
          var scale = Math.min(1, ENTRY_MAX_W_PX / nat.width, ENTRY_MAX_H_PX / nat.height);
          var emuW = Math.round(nat.width * scale * 9525);
          var emuH = Math.round(nat.height * scale * 9525);
          var relId = "rIdImg" + relCounter;
          var fileName = "image" + relCounter + ".jpeg";
          relCounter++;
          mediaFiles.push({ name: "word/media/" + fileName, data: dataUrlToBytes(item.photo.data) });
          relEntries.push('<Relationship Id="' + relId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + fileName + '"/>');
          var img = { relId: relId, emuW: emuW, emuH: emuH, docPrId: docPrCounter++ };
          if (!entryPhotoRelMap[item.entry.id]) entryPhotoRelMap[item.entry.id] = [];
          entryPhotoRelMap[item.entry.id].push(img);
        });

        var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
          'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
          'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
          'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<w:body>' + buildWordBodyXml(imageRelMap, range, entryPhotoRelMap) + '</w:body></w:document>';

        relEntries.unshift('<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
        relEntries.unshift('<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');

        var documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relEntries.join("") + '</Relationships>';

        // Fusszeile: App-Name links, Seitenzahl rechts (via Tab-Stopp auf die
        // volle Satzspiegelbreite), mit einer dünnen Trennlinie darüber –
        // gibt dem Dokument den Charakter eines formellen, gedruckten Berichts.
        var footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:p><w:pPr>' +
            '<w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="DDE4E1"/></w:pBdr>' +
            '<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>' +
            '<w:spacing w:before="160"/>' +
          '</w:pPr>' +
          '<w:r><w:rPr><w:color w:val="999999"/><w:sz w:val="17"/></w:rPr><w:t xml:space="preserve">Schichtprotokoll</w:t></w:r>' +
          '<w:r><w:rPr><w:color w:val="999999"/><w:sz w:val="17"/></w:rPr><w:tab/><w:t xml:space="preserve">Seite </w:t></w:r>' +
          '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:color w:val="999999"/><w:sz w:val="17"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>' +
          '</w:p></w:ftr>';

        // Minimale, aber explizite Formatvorlagen – ohne sie würden Word bzw.
        // andere Reader (z. B. python-docx) die Heading-Verweise ignorieren
        // und alles als "Normal" darstellen. Trennlinien unter Titel/
        // Abschnittsüberschriften geben dem Dokument einen "Report"-Look.
        var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>' +
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
            '<w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="18" w:space="10" w:color="0F5C56"/></w:pBdr>' +
            '<w:spacing w:before="0" w:after="200"/><w:outlineLvl w:val="0"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="0F5C56"/></w:rPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
            '<w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="DDE4E1"/></w:pBdr>' +
            '<w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="1"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="27"/><w:color w:val="0F5C56"/></w:rPr></w:style>' +
          '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
            '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="90"/><w:outlineLvl w:val="2"/></w:pPr>' +
            '<w:rPr><w:b/><w:sz w:val="23"/><w:color w:val="333333"/></w:rPr></w:style>' +
          '</w:styles>';

        var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
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
          { name: "word/footer1.xml", data: enc.encode(footerXml) },
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
  // Liest den optionalen Zeitraum aus den Export-Datumsfeldern in "Mehr".
  // Beide leer -> null (= alles exportieren, unverändertes Verhalten).
  function getExportDateRange() {
    var fromEl = document.getElementById("exportFromDate");
    var toEl = document.getElementById("exportToDate");
    var from = fromEl && fromEl.value ? fromEl.value : null;
    var to = toEl && toEl.value ? toEl.value : null;
    if (!from && !to) return null;
    return { from: from, to: to };
  }
  function dateInRange(dateStr, range) {
    if (!range || !dateStr) return true;
    if (range.from && dateStr < range.from) return false;
    if (range.to && dateStr > range.to) return false;
    return true;
  }
  function entryInRange(entry, range) {
    return dateInRange(dateToKey(new Date(entry.timestamp)), range);
  }

  function exportData(forceAll) {
    var range = forceAll ? null : getExportDateRange();
    var stamp = todayKey();
    var zipFilename = "schichtprotokoll-fotos-" + stamp + ".zip";
    var exportEntries = range ? state.entries.filter(function (e) { return entryInRange(e, range); }) : state.entries;
    var exportShifts = range ? state.shifts.filter(function (s) { return dateInRange(s.date, range); }) : state.shifts;
    var shiftsWithPhotos = exportShifts.filter(function (s) { return s.photo; });
    var hasPhotos = shiftsWithPhotos.length > 0;

    // JSON bewusst OHNE die (teils grossen) Foto-Daten – die Fotos werden
    // stattdessen in einem separaten ZIP mitgeliefert. "hasPhoto" markiert,
    // welche Schichten beim Import wieder aus dem ZIP befüllt werden müssen.
    var exportState = {
      categories: state.categories,
      people: state.people,
      entries: exportEntries,
      shifts: exportShifts.map(function (s) {
        var copy = {};
        for (var k in s) { if (k !== "photo") copy[k] = s[k]; }
        copy.hasPhoto = !!s.photo;
        return copy;
      }),
      templates: state.templates,
      patients: state.patients,
      effortLevels: state.effortLevels,
      timeLevels: state.timeLevels,
      medications: state.medications,
      measurementTypes: state.measurementTypes,
      settings: state.settings,
      _meta: {
        exportedAt: new Date().toISOString(),
        dateRange: range,
        photosZipFilename: hasPhotos ? zipFilename : null
      }
    };

    var blob = new Blob([JSON.stringify(exportState, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "schichtprotokoll-export-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

    if (!hasPhotos) {
      toast(range ? "Export gestartet (gefilterter Zeitraum)" : "Export gestartet");
      return;
    }

    // Zweiter Download: die Fotos als ZIP, mit dem exakten Dateinamen, der
    // auch im JSON hinterlegt ist (siehe photosZipFilename), damit der
    // spätere Import weiss, wonach er fragen soll. Kurze Verzögerung, damit
    // der Browser die beiden Downloads sicher als zwei Dateien behandelt.
    setTimeout(function () {
      var files = shiftsWithPhotos.map(function (s) {
        return { name: s.id + ".jpeg", data: dataUrlToBytes(s.photo) };
      });
      var zipBytes = buildZip(files);
      var zipBlob = new Blob([zipBytes], { type: "application/zip" });
      var zipUrl = URL.createObjectURL(zipBlob);
      var za = document.createElement("a");
      za.href = zipUrl;
      za.download = zipFilename;
      document.body.appendChild(za);
      za.click();
      za.remove();
      setTimeout(function () { URL.revokeObjectURL(zipUrl); }, 2000);
      toast(range ? "Export gestartet (gefilterter Zeitraum) – 2 Dateien" : "Export gestartet – 2 Dateien: JSON + Fotos-ZIP");
    }, 350);
  }

  // Prüft, ob die importierte Datei Foto-Verweise enthält, die aus einem
  // separaten ZIP wiederhergestellt werden müssen, und fragt in diesem Fall
  // gezielt danach (inkl. dem beim Export vergebenen Dateinamen). callback
  // erhält das (ggf. um die Fotos ergänzte) imported-Objekt.
  function proceedWithPhotoZip(imported, callback) {
    var expectedZipName = imported._meta && imported._meta.photosZipFilename;
    var needsPhotos = Array.isArray(imported.shifts) && imported.shifts.some(function (s) { return s.hasPhoto; });
    if (!needsPhotos) { callback(imported); return; }

    var sheet = openModal("Schicht-Fotos importieren", '' +
      '<p class="modal-text">Diese Datei verweist auf Schicht-Fotos, die beim Export separat als ZIP heruntergeladen wurden' +
      (expectedZipName ? ': <strong>' + esc(expectedZipName) + '</strong>.' : '.') +
      ' Wähle diese ZIP-Datei aus, um die Fotos wiederherzustellen – oder fahre ohne Fotos fort.</p>' +
      '<div class="modal-field"><input type="file" id="photoZipInput" accept=".zip,application/zip"></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn--ghost" id="skipZipBtn">Ohne Fotos fortfahren</button>' +
        '<button type="button" class="btn btn--primary" id="loadZipBtn">Fotos laden</button>' +
      '</div>');

    sheet.querySelector("#skipZipBtn").addEventListener("click", function () {
      imported.shifts.forEach(function (s) { delete s.hasPhoto; });
      closeModal();
      callback(imported);
    });
    sheet.querySelector("#loadZipBtn").addEventListener("click", function () {
      var zipFile = sheet.querySelector("#photoZipInput").files[0];
      if (!zipFile) { toast("Bitte zuerst eine ZIP-Datei auswählen."); return; }
      if (expectedZipName && zipFile.name !== expectedZipName) {
        toast("Hinweis: Dateiname weicht ab – versuche trotzdem, die Fotos zu laden.");
      }
      var zr = new FileReader();
      zr.onload = function () {
        try {
          var entries = readZipEntries(zr.result);
          var byName = {};
          entries.forEach(function (en) { if (!en.unsupported) byName[en.name] = en.data; });
          var restored = 0, missing = 0;
          imported.shifts.forEach(function (s) {
            if (s.hasPhoto) {
              var data = byName[s.id + ".jpeg"];
              if (data) { s.photo = bytesToDataUrl(data, "image/jpeg"); restored++; }
              else { missing++; }
              delete s.hasPhoto;
            }
          });
          closeModal();
          toast(missing ? (restored + " Foto(s) wiederhergestellt, " + missing + " nicht gefunden.") : (restored + " Foto(s) wiederhergestellt."));
          callback(imported);
        } catch (err) {
          toast(err.message || "ZIP-Datei konnte nicht gelesen werden.");
        }
      };
      zr.onerror = function () { toast("ZIP-Datei konnte nicht gelesen werden."); };
      zr.readAsArrayBuffer(zipFile);
    });
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
        closeModal();
        proceedWithPhotoZip(imported, function (finalImported) {
          mergeImported(finalImported);
          e.target.value = "";
        });
      });
      sheet.querySelector("#replaceBtn").addEventListener("click", function () {
        confirmDialog("Wirklich alle aktuellen Daten überschreiben?", "Ersetzen", true).then(function (ok) {
          if (!ok) { e.target.value = ""; return; }
          closeModal();
          proceedWithPhotoZip(imported, function (finalImported) {
            state = {
              categories: Array.isArray(finalImported.categories) && finalImported.categories.length ? finalImported.categories : defaultState().categories,
              people: Array.isArray(finalImported.people) ? finalImported.people : [],
              entries: Array.isArray(finalImported.entries) ? finalImported.entries : [],
              shifts: Array.isArray(finalImported.shifts) ? finalImported.shifts : [],
              templates: Array.isArray(finalImported.templates) ? finalImported.templates : defaultState().templates,
              patients: Array.isArray(finalImported.patients) ? finalImported.patients : [],
              effortLevels: Array.isArray(finalImported.effortLevels) && finalImported.effortLevels.length ? finalImported.effortLevels : defaultState().effortLevels,
              timeLevels: Array.isArray(finalImported.timeLevels) && finalImported.timeLevels.length ? finalImported.timeLevels : defaultState().timeLevels,
              medications: Array.isArray(finalImported.medications) ? finalImported.medications : defaultState().medications,
              measurementTypes: Array.isArray(finalImported.measurementTypes) && finalImported.measurementTypes.length ? finalImported.measurementTypes : defaultState().measurementTypes,
              settings: finalImported.settings || defaultState().settings
            };
            persist();
            refreshAllViews();
            toast("Daten ersetzt");
            e.target.value = "";
          });
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
    state.templates = mergeArray(state.templates, imported.templates);
    state.patients = mergeArray(state.patients, imported.patients);
    state.effortLevels = mergeArray(state.effortLevels, imported.effortLevels);
    state.timeLevels = mergeArray(state.timeLevels, imported.timeLevels);
    state.medications = mergeArray(state.medications, imported.medications);
    state.measurementTypes = mergeArray(state.measurementTypes, imported.measurementTypes);
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
    renderTemplateChips();
    refreshPatientFormOptionUI();
    renderLog();
    renderCalendar();
    renderKontakte();
    if (!document.getElementById("patientenWrap").hidden) renderPatientList();
    renderMehr();
  }

})();
