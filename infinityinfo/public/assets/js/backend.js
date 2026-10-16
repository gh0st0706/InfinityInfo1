(function () {
  "use strict";

  // Use the same-origin Vercel API by default. Override for local development.
  const API_BASE_URL = window.INFINITYINFO_API_URL || "/api";
  const apiStatus = document.getElementById("api-status");
  const statusIndicator = document.querySelector(".api-status-indicator");
  const form = document.getElementById("email-lookup-form");
  const finderForm = document.getElementById("lead-finder-form");
  const finderButton = document.getElementById("lead-finder-submit");
  const finderQuery = document.getElementById("lead-query");
  const finderStatus = document.getElementById("lead-finder-status");
  const finderResults = document.getElementById("lead-finder-results");
  const fileInput = document.getElementById("contact-file");
  const fileNameStatus = document.getElementById("contact-file-name");
  const uploadStatus = document.getElementById("upload-status");
  const submitButton = document.getElementById("upload-submit");
  let apiReady = false;
  let finderBusy = false;

  finderButton.disabled = true;

  fileInput.addEventListener("change", function () {
    const file = fileInput.files[0];
    fileNameStatus.textContent = file ? `Selected: ${file.name}` : "No file selected";
    uploadStatus.textContent = "";
  });

  function setApiStatus(connected, message) {
    apiReady = connected;
    apiStatus.textContent = message;
    statusIndicator.classList.toggle("is-connected", connected);
    finderButton.disabled = !apiReady || finderBusy;
  }

  async function checkBackend() {
    try {
      const response = await fetch(`${API_BASE_URL}/health`, { method: "GET" });
      if (!response.ok) throw new Error("Backend returned an error");
      const health = await response.json();
      if (!health.public_lookup_available) {
        setApiStatus(false, "Lead finder is unavailable right now");
        return;
      }
      setApiStatus(true, "Lead finder ready");
    } catch (error) {
      setApiStatus(false, "Backend not reachable · Start the API on port 8000");
    }
  }

  checkBackend();

  function setFinderStatus(message, state) {
    finderStatus.hidden = !message;
    finderStatus.className = `finder-result is-${state || "empty"}`;
    finderStatus.textContent = message;
  }

  function addText(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function safeWebUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch (error) {
      return null;
    }
  }

  function addExternalLink(parent, value, label, className) {
    const url = safeWebUrl(value);
    if (!url) return;
    const link = addText(parent, "a", className || "", label);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }

  function renderLeads(result) {
    finderResults.replaceChildren();
    const places = Array.isArray(result.results) ? result.results : [];
    if (!places.length) {
      setFinderStatus(`No matching places were listed in the public map data for ${result.location || "that area"}. Try a nearby city or a broader category.`, "empty");
      return;
    }
    setFinderStatus(`${places.length} results for “${result.category}” in ${result.location}. Contact fields are shown only when publicly listed.`, "success");

    places.forEach(function (place) {
      const card = document.createElement("article");
      card.className = "lead-card";
      const header = document.createElement("div");
      header.className = "lead-card-header";
      addText(header, "h3", "lead-card-name", place.name || "Unnamed place");
      addText(header, "span", "lead-relevance", place.relevance || "Related listing");
      card.appendChild(header);
      addText(card, "p", "lead-location", place.location || result.location);

      const contactList = document.createElement("dl");
      contactList.className = "lead-contact-list";
      [
        ["Email", place.email, place.email ? `mailto:${place.email}` : ""],
        ["Phone", place.phone, place.phone ? `tel:${place.phone.replace(/[^+\d]/g, "")}` : ""]
      ].forEach(function (item) {
        const row = document.createElement("div");
        const label = addText(row, "dt", "", item[0]);
        const value = document.createElement("dd");
        if (item[1] && item[2]) {
          const link = addText(value, "a", "", item[1]);
          link.href = item[2];
        } else {
          value.textContent = "Not listed publicly";
          value.className = "lead-unlisted";
        }
        row.appendChild(label);
        row.appendChild(value);
        contactList.appendChild(row);
      });
      card.appendChild(contactList);

      const links = document.createElement("div");
      links.className = "lead-card-links";
      addExternalLink(links, place.website, "Website", "lead-source-link");
      addExternalLink(links, place.contact_source, "Contact source", "lead-source-link");
      addExternalLink(links, place.source, "Map record", "lead-source-link");
      card.appendChild(links);
      finderResults.appendChild(card);
    });
  }

  finderForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    finderResults.replaceChildren();
    setFinderStatus("", "loading");
    if (!apiReady) {
      setFinderStatus("The finder is not ready yet. Wait for the connection status above, then try again.", "error");
      return;
    }
    const query = finderQuery.value.trim();
    if (query.length < 5) {
      setFinderStatus("Describe what you need and where, for example “cafés in Bangalore”.", "error");
      return;
    }

    finderBusy = true;
    finderButton.disabled = true;
    finderButton.textContent = "Searching…";
    setFinderStatus("Searching public place listings and checking listed websites for contact details…", "loading");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () { controller.abort(); }, 20000);
    try {
      const response = await fetch(`${API_BASE_URL}/lead-finder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 20 }),
        signal: controller.signal
      });
      const result = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(result.detail || "The search could not be completed.");
      renderLeads(result);
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The search took too long. Try again with a smaller area or a narrower category."
        : error.message || "Could not reach the public place directory. Try again shortly.";
      setFinderStatus(message, "error");
    } finally {
      window.clearTimeout(timeoutId);
      finderBusy = false;
      finderButton.disabled = !apiReady;
      finderButton.textContent = "Find places";
    }
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    uploadStatus.textContent = "";

    const file = fileInput.files[0];
    if (!file) {
      uploadStatus.textContent = "Choose a CSV or Excel file first.";
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      uploadStatus.textContent = "Choose a file that is 4 MB or smaller.";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    submitButton.disabled = true;
    submitButton.textContent = "Processing…";
    uploadStatus.textContent = "Uploading your file and looking up missing email addresses…";

    try {
      const response = await fetch(`${API_BASE_URL}/upload-csv`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        let message = "The upload could not be processed.";
        try {
          const error = await response.json();
          message = error.detail || message;
        } catch (parseError) {
          // Keep the generic message when the API response is not JSON.
        }
        throw new Error(message);
      }

      const result = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch ? filenameMatch[1] : "infinityinfo_enriched.xlsx";
      const downloadUrl = URL.createObjectURL(result);
      const downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(function () {
        URL.revokeObjectURL(downloadUrl);
      }, 1000);
      uploadStatus.textContent = "Done. Your enriched file has been downloaded.";
    } catch (error) {
      uploadStatus.textContent = error.message || "Could not reach the backend. Check that it is running.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Upload and Enrich";
    }
  });
})();
