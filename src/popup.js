document.addEventListener("DOMContentLoaded", () => {
  console.log("ChatSync popup loaded.");

  const loadBtn = document.getElementById("loadFromChat");
  const planTextArea = document.getElementById("planText");
  const startDateInput = document.getElementById("startDate");
  const durationInput = document.getElementById("durationMonths");
  const generateBtn = document.getElementById("generateIcs");
  const previewBtn = document.getElementById("previewBtn");
  const status = document.getElementById("status");
  const previewList = document.getElementById("previewList");

  if (
    !loadBtn ||
    !planTextArea ||
    !startDateInput ||
    !durationInput ||
    !generateBtn ||
    !previewBtn ||
    !previewList ||
    !status
  ) {
    console.error("ChatSync: missing one or more popup elements.");
    return;
  }

  // Default start date = today
  const today = new Date();
  startDateInput.value = today.toISOString().slice(0, 10); // YYYY-MM-DD

  function syncFromChat(showErrors) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) {
        if (showErrors) status.textContent = "No active tab found.";
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: "GET_CHAT_TEXT" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("ChatSync runtime error:", chrome.runtime.lastError);
          if (showErrors) {
            status.textContent =
              "Could not read from this tab. Make sure a ChatGPT chat is open.";
          }
          return;
        }

        if (!response || !response.text) {
          if (showErrors) {
            status.textContent = "No chat text found on this page.";
          }
          return;
        }

        planTextArea.value = response.text;
        status.textContent = "Synced plan text from ChatGPT.";
      });
    });
  }

  // Try to auto-load from ChatGPT when popup opens (quietly)
  syncFromChat(false);

  // Manual refresh
  loadBtn.addEventListener("click", () => {
    status.textContent = "Refreshing from chat...";
    syncFromChat(true);
  });

  function buildEventsFromInputs() {
    const planText = planTextArea.value.trim();
    const startDateStr = startDateInput.value;
    const months = parseInt(durationInput.value, 10) || 1;

    if (!planText) {
      status.textContent = "Paste or load a plan first.";
      return null;
    }
    if (!startDateStr) {
      status.textContent = "Pick a start date.";
      return null;
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);

    const events = parsePlanToEvents(planText, startDate, endDate);
    if (!events || events.length === 0) {
      status.textContent =
        "No events generated. The parser may not recognize this format yet.";
      return null;
    }

    return events;
  }

  function renderPreview(events) {
    previewList.innerHTML = "";
    const maxItems = 10;

    events.slice(0, maxItems).forEach((evt) => {
      const item = document.createElement("div");
      item.className = "preview-item";

      const title = document.createElement("span");
      title.className = "preview-item-title";
      title.textContent = evt.title || "(no title)";

      const meta = document.createElement("span");
      meta.className = "preview-item-meta";

      const dateStr = evt.date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      if (evt.allDay) {
        meta.textContent = `${dateStr} • All-day`;
      } else {
        const t = `${String(evt.hour).padStart(2, "0")}:${String(
          evt.minute
        ).padStart(2, "0")}`;
        meta.textContent = `${dateStr} • ${t}`;
      }

      item.appendChild(title);
      item.appendChild(meta);
      previewList.appendChild(item);
    });

    if (events.length > maxItems) {
      const extra = document.createElement("div");
      extra.className = "preview-item-meta";
      extra.textContent = `+ ${events.length - maxItems} more events...`;
      previewList.appendChild(extra);
    }
  }

  // Preview button
  previewBtn.addEventListener("click", () => {
    const events = buildEventsFromInputs();
    if (!events) return;
    renderPreview(events);
    status.textContent = `Previewing ${events.length} events.`;
  });

  // Download ICS
  generateBtn.addEventListener("click", () => {
    const events = buildEventsFromInputs();
    if (!events) return;

    const icsContent = buildIcs(events);
    downloadIcs(icsContent);
    status.textContent = `Downloaded .ics with ${events.length} events.`;
  });
});

/**
 * Parser v1.2:
 * - If any lines mention weekdays (Mon, Tue, etc.), create weekly events on those days.
 * - If a line contains a time (e.g. 6:30 am, 18:00), make it a timed event.
 * - Otherwise, it's an all-day event.
 * - If no weekdays are present at all, we fall back to sequential days.
 */
function parsePlanToEvents(planText, startDate, endDate) {
  const lines = planText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      const lower = l.toLowerCase();

      // Drop obvious section headers / fluff
      if (lower.startsWith("month ")) return false;
      if (lower.startsWith("phase ")) return false;
      if (lower.startsWith("week ")) return false;
      if (lower.startsWith("by the end of")) return false;

      return true;
    });

  const weekdayMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const weekdayLines = [];

  // Find lines tagged with weekdays
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const [name, idx] of Object.entries(weekdayMap)) {
      if (lower.includes(name)) {
        const time = parseTimeFromLine(line);
        weekdayLines.push({
          line,
          weekdayIndex: idx,
          time, // may be null
        });
        break;
      }
    }
  }

  // If we found weekday-based lines, treat them as weekly schedule
  if (weekdayLines.length > 0) {
    const events = [];

    for (const { line, weekdayIndex, time } of weekdayLines) {
      const cursor = new Date(startDate);

      // Move cursor to first matching weekday
      while (cursor.getDay() !== weekdayIndex && cursor <= endDate) {
        cursor.setDate(cursor.getDate() + 1);
      }

      while (cursor <= endDate) {
        events.push({
          title: cleanTitle(line),
          description: line,
          date: new Date(cursor),
          allDay: !time,
          hour: time ? time.hour : 0,
          minute: time ? time.minute : 0,
        });

        cursor.setDate(cursor.getDate() + 7); // next week
      }
    }

    return events;
  }

  // Fallback: one line per consecutive day, with optional times
  const events = [];
  let currentDate = new Date(startDate);

  for (const line of lines) {
    if (currentDate > endDate) break;

    const time = parseTimeFromLine(line);

    events.push({
      title: cleanTitle(line),
      description: line,
      date: new Date(currentDate),
      allDay: !time,
      hour: time ? time.hour : 0,
      minute: time ? time.minute : 0,
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return events;
}

// Extracts a time like "6:30 am", "7pm", "18:00" etc. from a line.
function parseTimeFromLine(line) {
  const text = line.toLowerCase();

  const timeRegex =
    /(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|(\b\d{1,2}):(\d{2})\b/g;

  let match = timeRegex.exec(text);
  if (!match) return null;

  let hour, minute;

  if (match[1] !== undefined) {
    // h[:mm] [am|pm]
    hour = parseInt(match[1], 10);
    minute = match[2] ? parseInt(match[2], 10) : 0;
    const period = match[3];

    if (period === "pm" && hour < 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;
  } else if (match[4] !== undefined && match[5] !== undefined) {
    // 24h h:mm
    hour = parseInt(match[4], 10);
    minute = parseInt(match[5], 10);
  } else {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

// Strip bullets/numbers at the start to keep titles clean
function cleanTitle(line) {
  return line.replace(/^[\-\*\d\.\)\s]+/, "").slice(0, 60);
}

function buildIcs(events) {
  const lines = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//ChatSync//EN");

  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  for (const event of events) {
    const uid =
      formatDateTimeUid(event.date) +
      "-" +
      Math.random().toString(36).slice(2) +
      "@chatsync";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${now}`);

    if (event.allDay) {
      const dt = toIcsDate(event.date);
      lines.push(`DTSTART;VALUE=DATE:${dt}`);
    } else {
      const { dtStart, dtEnd } = toIcsDateTimes(
        event.date,
        event.hour,
        event.minute
      );
      lines.push(`DTSTART:${dtStart}`);
      lines.push(`DTEND:${dtEnd}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// YYYYMMDD
function toIcsDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// Local datetime (no timezone) for DTSTART/DTEND
function toIcsDateTimes(date, hour, minute) {
  const start = new Date(date);
  start.setHours(hour, minute, 0, 0);

  const end = new Date(start);
  end.setHours(end.getHours() + 1); // default 1-hour block

  return {
    dtStart: formatDateTime(start),
    dtEnd: formatDateTime(end),
  };
}

function formatDateTime(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = "00";
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}`;
}

function formatDateTimeUid(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

function escapeIcsText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function downloadIcs(icsContent) {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chatsync-plan.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
