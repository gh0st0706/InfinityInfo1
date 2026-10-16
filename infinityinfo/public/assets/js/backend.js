(function () {
  "use strict";

  // Use the same-origin Vercel API by default. Override for local development.
  const API_BASE_URL = window.INFINITYINFO_API_URL || "/api";
  const apiStatus = document.getElementById("api-status");
  const statusIndicator = document.querySelector(".api-status-indicator");
  const form = document.getElementById("email-lookup-form");
  const finderForm = document.getElementById("person-finder-form");
  const finderButton = document.getElementById("person-finder-submit");
  const finderTypeInput = document.getElementById("finder-search-type");
  const finderQueryInput = document.getElementById("person-full-name");
  const finderQueryLabel = finderQueryInput.closest(".finder-field").querySelector("label");
  const finderHelp = document.getElementById("finder-search-help");
  const finderResult = document.getElementById("person-finder-result");
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
        setApiStatus(false, "Email finder is unavailable right now");
        return;
      }
      setApiStatus(true, "Email finder ready");
    } catch (error) {
      setApiStatus(false, "Backend not reachable · Start the API on port 8000");
    }
  }

  checkBackend();

  finderTypeInput.addEventListener("change", function () {
    const isTeamSearch = finderTypeInput.value === "team";
    finderQueryLabel.textContent = isTeamSearch ? "Team or department" : "Full name";
    finderQueryInput.placeholder = isTeamSearch ? "Fundraising, partnerships, volunteering…" : "Ada Lovelace";
    finderQueryInput.autocomplete = isTeamSearch ? "off" : "name";
    if (isTeamSearch) finderQueryInput.setAttribute("list", "finder-team-options");
    else finderQueryInput.removeAttribute("list");
    finderHelp.textContent = isTeamSearch
      ? "Enter a function such as fundraising, partnerships, volunteering, press, or programs. Only published inboxes are returned."
      : "Enter a person’s first and last name. We’ll look for public addresses and evidence on the organization’s website.";
  });

  function showFinderResult(title, detail, email, state, sources = [], sourceHeadingText = "Public evidence sources:") {
    finderResult.hidden = false;
    finderResult.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    finderResult.className = `finder-result is-${state}`;
    finderResult.replaceChildren();

    const heading = document.createElement("strong");
    heading.textContent = title;
    finderResult.appendChild(heading);

    if (email) {
      const address = document.createElement("div");
      address.className = "finder-email-address";
      address.textContent = email;
      finderResult.appendChild(address);
    }

    const note = document.createElement("p");
    note.textContent = detail;
    finderResult.appendChild(note);

    const safeSources = Array.isArray(sources) ? sources.filter(function (source) {
      try {
        const url = new URL(source);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch (error) {
        return false;
      }
    }).slice(0, 5) : [];
    if (safeSources.length) {
      const sourceHeading = document.createElement("p");
      sourceHeading.className = "finder-sources-heading";
      sourceHeading.textContent = sourceHeadingText;
      finderResult.appendChild(sourceHeading);
      const sourceList = document.createElement("ul");
      sourceList.className = "finder-sources";
      safeSources.forEach(function (source) {
        const url = new URL(source);
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `${url.hostname}${url.pathname}`;
        item.appendChild(link);
        sourceList.appendChild(item);
      });
      finderResult.appendChild(sourceList);
    }
  }

  finderForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    finderResult.hidden = true;
    if (!apiReady) {
      showFinderResult("Finder is not ready yet", "Wait for the connection status above to show that the email finder is ready, then try again.", "", "error");
      return;
    }
    const searchType = finderTypeInput.value;
    const query = finderQueryInput.value.trim();
    const company = document.getElementById("person-company").value.trim();
    if (searchType === "person" && query.split(/\s+/).filter(Boolean).length < 2) {
      showFinderResult("Add a first and last name", "Enter the person’s full name to search.", "", "error");
      return;
    }
    if (searchType === "team" && query.length < 2) {
      showFinderResult("Add a team or department", "For example, try fundraising, partnerships, or volunteering.", "", "error");
      return;
    }

    finderBusy = true;
    finderButton.disabled = true;
    finderButton.textContent = "Searching…";
    const loadingDetail = searchType === "team"
      ? "Checking mail records and public organization pages for a published team inbox. This usually takes a few seconds."
      : "Checking mail records, organization pages, and published email patterns. This usually takes a few seconds.";
    showFinderResult("Searching public organization sources…", loadingDetail, "", "loading");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () { controller.abort(); }, 18000);
    try {
      const response = await fetch(`${API_BASE_URL}/email-finder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: query, company, search_type: searchType }),
        signal: controller.signal
      });
      const result = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(result.detail || "The lookup could not be completed.");

      if (result.result === "found_publicly") {
        showFinderResult("Email found on a public organization page", "This address was published on the organization’s website. Domain mail records were also found.", result.email, "success", result.sources);
      } else if (result.result === "role_contact_found") {
        showFinderResult(`${query} inbox found`, "This team address is published on the organization’s website. It was not inferred.", result.email, "success", result.sources);
      } else if (result.result === "general_contact_found") {
        showFinderResult("General organization inbox found", `We did not find a public ${query}-specific inbox, but this general contact address is published on the organization’s website.`, result.email, "caution", result.sources);
      } else if (result.result === "pattern_candidate") {
        const detail = result.confidence === "domain_format_clue"
          ? "This unverified guess follows a repeated format found in public organization emails. We could not confirm that this mailbox exists."
          : "This low-confidence guess is based on limited public organization email evidence. We could not confirm that this mailbox exists.";
        showFinderResult("Possible address pattern", detail, result.email, "caution", result.sources);
      } else if (result.result === "no_mail_server") {
        showFinderResult("No organization mail server found", "The domain does not publish mail-server records, so we could not return an email contact.", "", "empty");
      } else {
        const title = searchType === "team" ? "No public team inbox found" : "No public match found";
        const detail = searchType === "team"
          ? `We couldn’t find a published ${query}-specific or general inbox. No address was guessed. Try another team name or check the organization’s domain.`
          : "We couldn’t find a published address or a useful email pattern. Try the person’s full name and the organization’s official domain.";
        showFinderResult(title, detail, "", "empty", result.pages_checked, "Organization pages checked:");
      }
    } catch (error) {
      const message = error.name === "AbortError"
        ? "The search took too long. Check the company domain and try again."
        : error.message || "Check the company domain and try again.";
      showFinderResult("Could not complete the lookup", message, "", "error");
    } finally {
      window.clearTimeout(timeoutId);
      finderBusy = false;
      finderButton.disabled = !apiReady;
      finderButton.textContent = "Find email";
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
