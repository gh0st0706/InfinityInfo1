(function () {
  "use strict";

  // Use the same-origin Vercel API by default. Override for local development.
  const API_BASE_URL = window.INFINITYINFO_API_URL || "/api";
  const apiStatus = document.getElementById("api-status");
  const statusIndicator = document.querySelector(".api-status-indicator");
  const form = document.getElementById("email-lookup-form");
  const finderForm = document.getElementById("person-finder-form");
  const finderButton = document.getElementById("person-finder-submit");
  const finderResult = document.getElementById("person-finder-result");
  const fileInput = document.getElementById("contact-file");
  const fileNameStatus = document.getElementById("contact-file-name");
  const uploadStatus = document.getElementById("upload-status");
  const submitButton = document.getElementById("upload-submit");

  fileInput.addEventListener("change", function () {
    const file = fileInput.files[0];
    fileNameStatus.textContent = file ? `Selected: ${file.name}` : "No file selected";
    uploadStatus.textContent = "";
  });

  function setApiStatus(connected, message) {
    apiStatus.textContent = message;
    statusIndicator.classList.toggle("is-connected", connected);
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

  function showFinderResult(title, detail, email, state) {
    finderResult.hidden = false;
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
  }

  finderForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    finderResult.hidden = true;
    const fullName = document.getElementById("person-full-name").value.trim();
    const company = document.getElementById("person-company").value.trim();
    if (fullName.split(/\s+/).length < 2) {
      showFinderResult("Add a first and last name", "Enter the person’s full name to search.", "", "error");
      return;
    }

    finderButton.disabled = true;
    finderButton.textContent = "Searching…";
    showFinderResult("Checking public company information…", "We look for published addresses and company mail setup.", "", "loading");
    try {
      const response = await fetch(`${API_BASE_URL}/email-finder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, company })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "The lookup could not be completed.");

      if (result.result === "found_publicly") {
        showFinderResult("Email found on a public company page", "This address was published on the company’s website. Domain mail records were also found.", result.email, "success");
      } else if (result.result === "pattern_candidate") {
        showFinderResult("Possible address pattern", "This is an unverified guess based on a format clue from public company addresses. We could not confirm that this mailbox exists.", result.email, "caution");
      } else if (result.result === "no_mail_server") {
        showFinderResult("No company mail server found", "The domain did not publish mail-server records, so we could not build a reliable result.", "", "empty");
      } else {
        showFinderResult("No public match found", "We did not find this person’s address on the company pages we checked. No email was guessed.", "", "empty");
      }
    } catch (error) {
      showFinderResult("Could not complete the lookup", error.message || "Check the domain and try again.", "", "error");
    } finally {
      finderButton.disabled = false;
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
