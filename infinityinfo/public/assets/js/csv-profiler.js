(function () {
  "use strict";

  const form = document.getElementById("csv-profile-form");
  if (!form) return;

  const fileInput = document.getElementById("csv-profile-file");
  const submitButton = document.getElementById("csv-profile-submit");
  const result = document.getElementById("csv-profile-result");
  const PROFILE_API_URL = "https://infinityinfo1.onrender.com/api/profile";

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
    result.textContent = "Inspecting...";

    try {
      const response = await fetch(PROFILE_API_URL, {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Request failed");
      result.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
      result.textContent = error.message || "Could not inspect this CSV.";
    } finally {
      submitButton.disabled = false;
    }
  });
})();
