(function () {
  "use strict";

  var fallback = document.getElementById("phone-checker-fallback");
  var root = document.getElementById("phone-checker-root");
  var singleForm = document.getElementById("phone-checker-fallback-form");
  var singleResult = document.getElementById("phone-checker-fallback-result");
  var singleSubmit = singleForm.querySelector("button[type='submit']");
  var fileInput = document.getElementById("phone-checker-csv");
  var fileName = document.getElementById("phone-checker-file-name");
  var bulkSubmit = document.getElementById("phone-checker-csv-submit");
  var bulkStatus = document.getElementById("phone-checker-bulk-status");
  var resultCount = document.getElementById("phone-checker-result-count");
  var resultsTable = document.getElementById("phone-checker-results");
  var downloadButton = document.getElementById("phone-checker-download");
  var apiStatus = document.getElementById("phone-fallback-status");
  var errorNotice = document.getElementById("phone-fallback-error");
  var apiBase = window.INFINITYINFO_API_URL || "/api";
  var selectedFile = null;
  var checkedRows = [];

  function hideFallbackWhenAppMounts() {
    if (!root.children.length) return;
    fallback.hidden = true;
    observer.disconnect();
  }

  var observer = new MutationObserver(hideFallbackWhenAppMounts);
  observer.observe(root, { childList: true });
  hideFallbackWhenAppMounts();

  function setError(message) {
    errorNotice.textContent = message || "";
    errorNotice.hidden = !message;
  }

  async function post(path, body) {
    var response = await fetch(apiBase + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    var data = await response.json();
    if (!response.ok) throw new Error(data.detail || data.error || "Phone check failed. Please try again.");
    return data;
  }

  function renderResults() {
    resultsTable.replaceChildren();
    if (!checkedRows.length) {
      var empty = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 6;
      emptyCell.className = "phone-empty";
      emptyCell.textContent = "No numbers checked yet.";
      empty.appendChild(emptyCell);
      resultsTable.appendChild(empty);
      resultCount.textContent = "Upload a CSV to see checked numbers here.";
      downloadButton.disabled = true;
      return;
    }

    checkedRows.forEach(function (item) {
      var row = document.createElement("tr");
      [item.input, item.normalized || "—", item.country || "—"].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value || "—";
        row.appendChild(cell);
      });
      var validityCell = document.createElement("td");
      var badge = document.createElement("span");
      badge.className = "ph-badge " + (item.validFormat ? "valid" : "invalid");
      badge.textContent = item.validFormat ? "Valid format" : "Invalid format";
      validityCell.appendChild(badge);
      row.appendChild(validityCell);
      [item.lineType || "Unknown", item.message || ""].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value || "—";
        row.appendChild(cell);
      });
      resultsTable.appendChild(row);
    });

    var validCount = checkedRows.filter(function (item) { return item.validFormat; }).length;
    resultCount.textContent = checkedRows.length + " numbers checked · " + validCount + " valid formats · " + (checkedRows.length - validCount) + " need review";
    downloadButton.disabled = false;
  }

  function showSingleResult(data) {
    singleResult.replaceChildren();
    var top = document.createElement("div");
    top.className = "phone-result-top";
    var number = document.createElement("strong");
    number.textContent = data.normalized || data.input;
    var badge = document.createElement("span");
    badge.className = "ph-badge " + (data.validFormat ? "valid" : "invalid");
    badge.textContent = data.validFormat ? "Valid format" : "Invalid format";
    top.append(number, badge);

    var details = document.createElement("p");
    details.textContent = "Country: " + (data.country || "Unknown") + " · Line: " + (data.lineType || "Unknown");
    var note = document.createElement("p");
    note.textContent = data.message || "Check complete.";
    singleResult.append(top, details, note);
    singleResult.hidden = false;
  }

  function parseCsv(text) {
    var records = [];
    var record = [];
    var cell = "";
    var quoted = false;
    for (var index = 0; index < text.length; index += 1) {
      var char = text[index];
      if (quoted && char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        record.push(cell);
        cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        record.push(cell);
        if (record.some(function (value) { return value.trim(); })) records.push(record);
        record = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    record.push(cell);
    if (record.some(function (value) { return value.trim(); })) records.push(record);
    return records;
  }

  function readCsv(file, defaultCountry) {
    return file.text().then(function (text) {
      var records = parseCsv(text.replace(/^\uFEFF/, ""));
      if (records.length < 2) throw new Error("The CSV needs a header row and at least one phone number.");
      var headers = records[0].map(function (value) { return value.trim(); });
      var phoneColumn = headers.findIndex(function (value) { return /phone|mobile|telephone|number|whatsapp|contact/i.test(value); });
      if (phoneColumn < 0) phoneColumn = 0;
      var countryColumn = headers.findIndex(function (value) { return /^country$|country code|region/i.test(value); });

      return records.slice(1).map(function (values) {
        var phone = (values[phoneColumn] || "").trim();
        var country = countryColumn >= 0 ? (values[countryColumn] || "").trim().toUpperCase() : "";
        if (!/^[A-Z]{2}$/.test(country)) country = defaultCountry;
        return phone ? { phone: phone, country: country } : null;
      }).filter(Boolean);
    });
  }

  function csvCell(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  }

  function downloadResults() {
    var columns = ["Input", "Normalized E.164", "Country", "Calling code", "Format valid", "Possible length", "Line type", "Carrier", "Lookup", "Notes"];
    var lines = [columns.map(csvCell).join(",")];
    checkedRows.forEach(function (item) {
      lines.push([
        item.input, item.normalized, item.country, item.callingCode, item.validFormat,
        item.possible, item.lineType, item.carrier, item.lookupStatus, item.message
      ].map(csvCell).join(","));
    });
    var blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "phone-check-results.csv";
    link.click();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  fetch(apiBase + "/health").then(function (response) {
    if (!response.ok) throw new Error("Backend unavailable");
    return response.json();
  }).then(function (health) {
    apiStatus.textContent = "Checker ready";
    apiStatus.classList.add("ready");
    if (health.defaultCountry && singleForm.elements.country.querySelector('option[value="' + health.defaultCountry + '"]')) {
      singleForm.elements.country.value = health.defaultCountry;
    }
  }).catch(function () {
    apiStatus.textContent = "Checker unavailable";
    setError("The phone checker service could not be reached. Please refresh and try again.");
  });

  singleForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    setError("");
    singleResult.hidden = true;
    singleSubmit.disabled = true;
    singleSubmit.textContent = "Checking…";
    try {
      var data = await post("/validate", {
        phone: singleForm.elements.phone.value.trim(),
        country: singleForm.elements.country.value,
        useProvider: false
      });
      showSingleResult(data);
      checkedRows = [data].concat(checkedRows);
      renderResults();
    } catch (error) {
      setError(error.message);
    } finally {
      singleSubmit.disabled = false;
      singleSubmit.textContent = "Check phone number";
    }
  });

  fileInput.addEventListener("change", function () {
    selectedFile = fileInput.files && fileInput.files[0];
    fileName.textContent = selectedFile ? "Selected: " + selectedFile.name : "No file selected";
    bulkSubmit.disabled = !selectedFile;
    bulkStatus.textContent = "";
    setError("");
  });

  bulkSubmit.addEventListener("click", async function () {
    if (!selectedFile) return;
    setError("");
    bulkSubmit.disabled = true;
    bulkSubmit.textContent = "Checking…";
    bulkStatus.textContent = "Reading CSV…";
    try {
      if (selectedFile.size > 8 * 1024 * 1024) throw new Error("Choose a CSV file that is 8 MB or smaller.");
      var defaultCountry = singleForm.elements.country.value;
      var numbers = await readCsv(selectedFile, defaultCountry);
      if (!numbers.length) throw new Error("No phone numbers found in the CSV.");
      var healthResponse = await fetch(apiBase + "/health");
      var health = healthResponse.ok ? await healthResponse.json() : {};
      var limit = Number(health.maxBulkRows || 500);
      if (numbers.length > limit) throw new Error("This checker supports up to " + limit + " phone numbers per CSV.");
      var checked = [];
      for (var offset = 0; offset < numbers.length; offset += limit) {
        var batch = numbers.slice(offset, offset + limit);
        bulkStatus.textContent = "Checking " + Math.min(offset + batch.length, numbers.length) + " of " + numbers.length + "…";
        var response = await post("/validate/bulk", { numbers: batch, country: defaultCountry, useProvider: false });
        checked = checked.concat(response.results || []);
      }
      checkedRows = checked;
      renderResults();
      bulkStatus.textContent = "Finished checking " + checked.length + " numbers.";
    } catch (error) {
      bulkStatus.textContent = "";
      setError(error.message);
    } finally {
      bulkSubmit.disabled = !selectedFile;
      bulkSubmit.textContent = "Check phone list";
    }
  });

  downloadButton.addEventListener("click", downloadResults);
})();
