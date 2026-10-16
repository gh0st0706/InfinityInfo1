
(function () {
"use strict";

const form = document.getElementById("company-search-form");
const searchButton = document.getElementById("company-search-button");
const exportButton = document.getElementById("company-export-button");
const resultsBody = document.getElementById("company-results-body");
const resultSummary = document.getElementById("company-result-summary");
const statusElement = document.getElementById("company-search-status");

let currentResults = [];

const API_BASE_URL = window.INFINITYINFO_API_URL || "/api";

const columns = [
  ["Company", "companyName"],
  ["Location type", "locationType"],
  ["Address", "address"],
  ["Street", "street"],
  ["City", "city"],
  ["State", "state"],
  ["Postal code", "postalCode"],
  ["Country", "country"],
  ["Public email", "email"],
  ["Business phone", "phone"],
  ["Website", "website"],
  ["Source", "source"],
  ["Source URL", "sourceUrl"]
];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function setStatus(message, type = "") {
  statusElement.textContent = message;
  statusElement.className = `company-search-status is-${type}`.trim();
}

function locationTypeSelect(value, index) {
  const options = ["Unverified", "Headquarters", "Branch"];

  return `
    <select class="company-type-select" data-index="${index}"
      aria-label="Location type for result ${index + 1}">
      ${options.map((option) => `
        <option value="${option}"
          ${value === option ? "selected" : ""}>
          ${option}
        </option>
      `).join("")}
    </select>
  `;
}

function renderResults(results) {
  currentResults = results;
  exportButton.disabled = results.length === 0;

  resultSummary.textContent =
    `${results.length} result${results.length === 1 ? "" : "s"} found`;

  if (!results.length) {
    resultsBody.innerHTML = `
      <tr><td colspan="11" class="company-empty-cell">
        No public web results found. Try a more specific name, industry, or location.
      </td></tr>
    `;
    return;
  }

  resultsBody.innerHTML = results.map((item, index) => {
    let website = "—";
    try {
      const parsedWebsite = new URL(item.website);
      if (["http:", "https:"].includes(parsedWebsite.protocol)) {
        website = `<a class="company-website-link" href="${escapeHTML(parsedWebsite.href)}" target="_blank" rel="noopener noreferrer">Visit website</a>`;
      }
    } catch (error) {
      // Skip malformed public website values.
    }

    let sourceLink = escapeHTML(item.source || "—");
    try {
      const parsedSource = new URL(item.sourceUrl);
      if (["http:", "https:"].includes(parsedSource.protocol)) {
        sourceLink = `<a class="company-website-link" href="${escapeHTML(parsedSource.href)}" target="_blank" rel="noopener noreferrer">Open result</a>`;
      }
    } catch (error) {
      // Keep the source label when there is no usable source URL.
    }

    return `
      <tr>
        <td class="company-result-name">${escapeHTML(item.companyName || "—")}</td>
        <td>${locationTypeSelect(item.locationType || "Unverified", index)}</td>
        <td>${escapeHTML(item.street || item.address || "—")}</td>
        <td>${escapeHTML(item.city || "—")}</td>
        <td>${escapeHTML(item.state || "—")}</td>
        <td>${escapeHTML(item.postalCode || "—")}</td>
        <td>${escapeHTML(item.country || "—")}</td>
        <td>${escapeHTML(item.email || "Not listed")}</td>
        <td class="phone">${escapeHTML(item.phone || "Not listed")}</td>
        <td>${website}</td>
        <td>${sourceLink}</td>
      </tr>
    `;
  }).join("");

  resultsBody.querySelectorAll(".company-type-select").forEach((select) => {
    select.addEventListener("change", (event) => {
      const index = Number(event.target.dataset.index);
      currentResults[index].locationType = event.target.value;
    });
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const params = new URLSearchParams();

  for (const [key, value] of formData.entries()) {
    if (String(value).trim()) {
      params.set(key, String(value).trim());
    }
  }

  searchButton.disabled = true;
  searchButton.textContent = "Searching...";
  exportButton.disabled = true;
  setStatus("Searching public webpages...");
  resultSummary.textContent = "Searching...";
  resultsBody.innerHTML = `
    <tr><td colspan="11" class="company-empty-cell">Searching public webpages...</td></tr>
  `;

  try {
    const response = await fetch(`${API_BASE_URL}/search?${params.toString()}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.error || "Search request failed.");
    }

    renderResults(data.results || []);

    if (data.warnings?.length) {
      setStatus(data.warnings.join("\n"), "error");
    } else {
      setStatus("Search completed. Public contact details are shown when found on the source pages.", "success");
    }
  } catch (error) {
    currentResults = [];
    renderResults([]);
    setStatus(error.message || "Something went wrong.", "error");
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = "Search companies";
  }
});

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

exportButton.addEventListener("click", () => {
  if (!currentResults.length) return;

  const header = columns.map(([label]) => csvEscape(label)).join(",");

  const rows = currentResults.map((item) =>
    columns.map(([, key]) => csvEscape(item[key])).join(",")
  );

  const csv = "\uFEFF" + [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `infinityinfo-companies-${new Date()
    .toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});
})();
