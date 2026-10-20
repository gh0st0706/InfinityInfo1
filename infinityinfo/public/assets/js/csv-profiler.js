(function () {
  "use strict";

  const form = document.getElementById("csv-profile-form");
  if (!form) return;

  const fileInput = document.getElementById("csv-profile-file");
  const submitButton = document.getElementById("csv-profile-submit");
  const result = document.getElementById("csv-profile-result");
  const PROFILE_API_URL = "https://infinityinfo1.onrender.com/api/profile";

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function renderReport(data) {
    const columns = Array.isArray(data.profile) ? data.profile : [];
    const sample = Array.isArray(data.sample) ? data.sample : [];
    const missingTotal = columns.reduce((sum, column) => sum + Number(column.missing || 0), 0);

    const warnings = [];
    columns.forEach(function (column) {
      if (Number(column.missing) > 0) {
        warnings.push(
          '<li><strong>' + escapeHTML(column.name) + ':</strong> ' +
          Number(column.missing) + ' missing value' +
          (Number(column.missing) === 1 ? "" : "s") + '.</li>'
        );
      }
      if (Number(column.missing) === 0 && Number(column.unique) < Number(data.rows)) {
        warnings.push(
          '<li><strong>' + escapeHTML(column.name) + ':</strong> repeated values detected; review if uniqueness is expected.</li>'
        );
      }
    });

    const columnRows = columns.map(function (column) {
      return '<tr>' +
        '<td>' + escapeHTML(column.name) + '</td>' +
        '<td>' + escapeHTML(column.type) + '</td>' +
        '<td>' + Number(column.missing || 0) + '</td>' +
        '<td>' + Number(column.unique || 0) + '</td>' +
        '</tr>';
    }).join("");

    const sampleColumns = sample.length ? Object.keys(sample[0]) : [];
    const sampleHead = sampleColumns.map(function (name) {
      return '<th scope="col">' + escapeHTML(name) + '</th>';
    }).join("");
    const sampleRows = sample.map(function (row) {
      return '<tr>' + sampleColumns.map(function (name) {
        return '<td>' + escapeHTML(row[name] === null || row[name] === undefined || row[name] === "" ? "—" : row[name]) + '</td>';
      }).join("") + '</tr>';
    }).join("");

    result.innerHTML =
      '<div class="csv-report">' +
        '<h3>Data quality report</h3>' +
        '<p class="csv-report-intro">Initial inspection only. Your original file has not been changed.</p>' +
        '<div class="csv-report-stats">' +
          '<div class="csv-report-stat"><span>Rows</span><strong>' + Number(data.rows || 0).toLocaleString() + '</strong></div>' +
          '<div class="csv-report-stat"><span>Columns</span><strong>' + Number(data.columns || 0).toLocaleString() + '</strong></div>' +
          '<div class="csv-report-stat"><span>Duplicate rows</span><strong>' + Number(data.duplicates || 0).toLocaleString() + '</strong></div>' +
          '<div class="csv-report-stat"><span>Missing cells</span><strong>' + missingTotal.toLocaleString() + '</strong></div>' +
        '</div>' +
        '<section class="csv-report-section">' +
          '<h4>Findings</h4>' +
          (warnings.length
            ? '<ul class="csv-report-warnings">' + warnings.join("") + '</ul>'
            : '<p class="csv-report-clean">No missing values or repeated values were flagged by these basic checks.</p>') +
        '</section>' +
        '<section class="csv-report-section">' +
          '<h4>Column details</h4>' +
          '<div class="csv-report-table-wrap"><table><thead><tr><th>Column</th><th>Detected type</th><th>Missing</th><th>Unique values</th></tr></thead>' +
          '<tbody>' + columnRows + '</tbody></table></div>' +
        '</section>' +
        '<section class="csv-report-section">' +
          '<h4>Sample rows</h4>' +
          (sampleRows
            ? '<div class="csv-report-table-wrap"><table><thead><tr>' + sampleHead + '</tr></thead><tbody>' + sampleRows + '</tbody></table></div>'
            : '<p>No sample rows were returned.</p>') +
        '</section>' +
      '</div>';
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const file = fileInput.files[0];

    if (!file) {
      result.textContent = "Select a CSV file first.";
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      result.textContent = "Upload a CSV file.";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    submitButton.disabled = true;
    result.className = "csv-profiler-result csv-profiler-message";
    result.textContent = "Inspecting your data...";

    try {
      const response = await fetch(PROFILE_API_URL, {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Request failed");

      result.className = "csv-profiler-result";
      renderReport(data);
    } catch (error) {
      result.className = "csv-profiler-result csv-profiler-message";
      result.textContent = error.message || "Could not inspect this CSV.";
    } finally {
      submitButton.disabled = false;
    }
  });
})();
