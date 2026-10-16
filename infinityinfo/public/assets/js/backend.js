(function () {
  "use strict";

  // Use the same-origin Vercel API by default. Override for local development.
  const API_BASE_URL = window.INFINITYINFO_API_URL || "/api";
  const form = document.getElementById("email-lookup-form");
  const fileInput = document.getElementById("contact-file");
  const fileNameStatus = document.getElementById("contact-file-name");
  const uploadStatus = document.getElementById("upload-status");
  const submitButton = document.getElementById("upload-submit");
  fileInput.addEventListener("change", function () {
    const file = fileInput.files[0];
    fileNameStatus.textContent = file ? `Selected: ${file.name}` : "No file selected";
    uploadStatus.textContent = "";
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
