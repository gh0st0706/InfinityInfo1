(function () {
  "use strict";

  // Change this URL if the API is running on another machine or port.
  const API_BASE_URL = window.INFINITYINFO_API_URL || "http://127.0.0.1:8000";
  const apiStatus = document.getElementById("api-status");
  const statusIndicator = document.querySelector(".api-status-indicator");
  const form = document.getElementById("email-lookup-form");
  const fileInput = document.getElementById("contact-file");
  const uploadStatus = document.getElementById("upload-status");
  const submitButton = document.getElementById("upload-submit");

  function setApiStatus(connected, message) {
    apiStatus.textContent = message;
    statusIndicator.classList.toggle("is-connected", connected);
  }

  async function checkBackend() {
    try {
      const response = await fetch(`${API_BASE_URL}/`, { method: "GET" });
      if (!response.ok) throw new Error("Backend returned an error");
      setApiStatus(true, "Backend connected");
    } catch (error) {
      setApiStatus(false, "Backend not reachable · Start the API on port 8000");
    }
  }

  checkBackend();

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    uploadStatus.textContent = "";

    const file = fileInput.files[0];
    if (!file) {
      uploadStatus.textContent = "Choose a CSV or Excel file first.";
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
