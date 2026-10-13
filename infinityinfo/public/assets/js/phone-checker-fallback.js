(function () {
  "use strict";

  var fallback = document.getElementById("phone-checker-fallback");
  var root = document.getElementById("phone-checker-root");
  var form = document.getElementById("phone-checker-fallback-form");
  var result = document.getElementById("phone-checker-fallback-result");
  var submit = form.querySelector("button[type='submit']");
  var apiBase = window.INFINITYINFO_API_URL || "/api";

  function hideFallbackWhenAppMounts() {
    if (!root.children.length) return;
    fallback.hidden = true;
    observer.disconnect();
  }

  var observer = new MutationObserver(hideFallbackWhenAppMounts);
  observer.observe(root, { childList: true });
  hideFallbackWhenAppMounts();

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    result.hidden = true;
    submit.disabled = true;
    submit.textContent = "Checking…";

    try {
      var response = await fetch(apiBase + "/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: form.elements.phone.value.trim(),
          country: form.elements.country.value,
          useProvider: false
        })
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Phone check failed. Please try again.");

      result.replaceChildren();
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
      var message = document.createElement("p");
      message.textContent = data.message || "Check complete.";
      result.append(top, details, message);
      result.hidden = false;
    } catch (error) {
      result.replaceChildren();
      var message = document.createElement("p");
      message.textContent = error.message || "Phone checker is unavailable. Please try again.";
      result.appendChild(message);
      result.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Check phone number";
    }
  });
})();
