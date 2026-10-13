import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx";
import "./integrated.css";

const countries = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"],
  ["CA", "Canada"], ["AU", "Australia"], ["AE", "UAE"],
  ["SG", "Singapore"], ["DE", "Germany"], ["FR", "France"]
];
const apiBase = window.INFINITYINFO_API_URL || "/api";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv(rows) {
  const columns = ["input", "normalized", "country", "callingCode", "validFormat", "possible", "lineType", "carrier", "lookupStatus", "reachability", "whatsapp", "message"];
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const content = [columns.join(","), ...rows.map(row => columns.map(column => quote(row[column])).join(","))].join("\r\n");
  download(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }), "phone-check-results.csv");
}

function exportExcel(rows) {
  const sheet = XLSX.utils.json_to_sheet(rows.map(row => ({
    "Input": row.input, "Normalized E.164": row.normalized, "Country": row.country,
    "Calling code": row.callingCode, "Format valid": row.validFormat,
    "Possible length": row.possible, "Line type": row.lineType, Carrier: row.carrier,
    Lookup: row.lookupStatus, Reachability: row.reachability, WhatsApp: row.whatsapp, Notes: row.message
  })));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Phone checks");
  XLSX.writeFile(workbook, "phone-check-results.xlsx");
}

function Validity({ value }) {
  const className = value === true ? "valid" : value === false ? "invalid" : "unknown";
  const label = value === true ? "Valid format" : value === false ? "Invalid format" : "Unknown";
  return <span className={`ph-badge ${className}`}>{label}</span>;
}

function App() {
  const [country, setCountry] = useState("IN");
  const [phone, setPhone] = useState("");
  const [useProvider, setUseProvider] = useState(false);
  const [health, setHealth] = useState({});
  const [single, setSingle] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const fileInput = useRef(null);

  useEffect(() => {
    fetch(`${apiBase}/health`).then(response => response.json()).then(setHealth)
      .catch(() => setError("Phone checker backend is not reachable. Start the API and reload."));
  }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    valid: rows.filter(row => row.validFormat === true).length,
    invalid: rows.filter(row => row.validFormat === false).length,
    lookups: rows.filter(row => row.lookupStatus === "provider_checked").length
  }), [rows]);

  const visibleRows = rows.filter(row =>
    (filter === "all" || (filter === "valid" && row.validFormat === true) ||
      (filter === "invalid" && row.validFormat === false) || (filter === "unknown" && row.validFormat == null)) &&
    (!search || [row.input, row.normalized, row.country, row.carrier, row.lineType]
      .some(value => String(value || "").toLowerCase().includes(search.toLowerCase())))
  );

  async function post(path, body) {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Phone check failed.");
    return data;
  }

  async function checkOne(event) {
    event.preventDefault();
    setBusy(true); setError(""); setSingle(null);
    try {
      const result = await post("/validate", { phone, country, useProvider });
      setSingle(result);
      setRows(oldRows => [result, ...oldRows]);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  async function checkMany(numbers) {
    if (!numbers.length) throw new Error("No phone numbers found in that file.");
    const results = [];
    const limit = Number(health.maxBulkRows || 500);
    for (let index = 0; index < numbers.length; index += limit) {
      const batch = numbers.slice(index, index + limit);
      setProgress(`Checking ${Math.min(index + batch.length, numbers.length)} of ${numbers.length}…`);
      const response = await post("/validate/bulk", { numbers: batch, country, useProvider });
      results.push(...response.results);
    }
    setRows(results); setFilter("all");
    setProgress(`Finished checking ${results.length} numbers.`);
  }

  async function readFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(""); setProgress("Reading file…");
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("Choose a file that is 8 MB or smaller.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const records = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      if (!records.length) throw new Error("The first worksheet is empty.");
      const columns = Object.keys(records[0]);
      const phoneColumn = columns.find(key => /phone|mobile|telephone|number|whatsapp|contact/i.test(key)) || columns[0];
      const countryColumn = columns.find(key => /^country$|country code|region/i.test(key));
      const numbers = records.map(record => ({
        phone: String(record[phoneColumn] ?? "").trim(),
        country: countryColumn ? String(record[countryColumn] || country).trim().toUpperCase() : country
      })).filter(item => item.phone);
      await checkMany(numbers);
    } catch (readError) { setError(readError.message); setProgress(""); }
    finally { setBusy(false); event.target.value = ""; }
  }

  function pasteNumbers() {
    const pasted = window.prompt("Paste phone numbers separated by new lines or commas.");
    if (!pasted) return;
    setBusy(true); setError("");
    checkMany(pasted.split(/[\n,;\t]+/).map(value => value.trim()).filter(Boolean))
      .catch(requestError => setError(requestError.message))
      .finally(() => setBusy(false));
  }

  return <div className="phone-tool">
    <div className="phone-tool-heading">
      <div><span className="phone-eyebrow">PHONE NUMBER VALIDATION</span><h3>Check and enrich phone records</h3></div>
      <span className={`phone-api-status ${health.ok ? "ready" : ""}`}>{health.ok ? "Checker ready" : "Connecting…"}</span>
    </div>
    {error && <p className="phone-error" role="alert">{error}</p>}

    <div className="phone-tool-grid">
      <section className="phone-panel">
        <h4><span>01</span> Check one number</h4>
        <form onSubmit={checkOne}>
          <label htmlFor="phone-country">Default country</label>
          <select id="phone-country" value={country} onChange={event => setCountry(event.target.value)}>
            {countries.map(([code, name]) => <option value={code} key={code}>{code} — {name}</option>)}
          </select>
          <label htmlFor="phone-number">Phone number</label>
          <input id="phone-number" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+91 98765 43210" required />
          <label className="phone-provider-toggle">
            <input type="checkbox" checked={useProvider} disabled={!health.providerConfigured} onChange={event => setUseProvider(event.target.checked)} />
            <span>Carrier and line-type lookup <small>{health.providerConfigured ? "Optional provider lookup; charges may apply." : "Optional lookup is not configured."}</small></span>
          </label>
          <button className="phone-primary" disabled={busy}>{busy ? "Checking…" : "Check phone number"}</button>
        </form>
        {single && <div className="phone-result" aria-live="polite">
          <div className="phone-result-top"><strong>{single.normalized || single.input}</strong><Validity value={single.validFormat} /></div>
          <p>Country: <b>{single.country || "Unknown"}</b> · Carrier: <b>{single.carrier || "Not available"}</b> · Line: <b>{single.lineType || "Unknown"}</b></p>
          <p>{single.message}</p>
        </div>}
      </section>

      <section className="phone-panel">
        <h4><span className="purple">02</span> Bulk check</h4>
        <button type="button" className="phone-drop" disabled={busy} onClick={() => fileInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file && fileInput.current) {
            const transfer = new DataTransfer(); transfer.items.add(file); fileInput.current.files = transfer.files;
            readFile({ target: fileInput.current });
          }
        }}>
          <strong>Drop an Excel or CSV file here</strong><span>or click to browse · up to 8 MB</span><small>CSV · XLSX · XLS</small>
        </button>
        <input ref={fileInput} className="phone-file-input" type="file" accept=".csv,.xlsx,.xls" onChange={readFile} />
        <div className="phone-actions">
          <button type="button" onClick={pasteNumbers} disabled={busy}>Paste numbers</button>
          <button type="button" onClick={() => download(new Blob(["Phone,Country\n+919876543210,IN\n+14155552671,US\n"], { type: "text/csv" }), "phone-template.csv")}>Download template</button>
        </div>
        <p className="phone-help">Use a Phone or Mobile column. An optional Country column accepts ISO codes such as IN, US or GB.</p>
        {progress && <p className="phone-progress" role="status">{progress}</p>}
      </section>
    </div>

    <section className="phone-panel phone-results-panel">
      <div className="phone-results-heading"><div><h4><span>03</span> Check results</h4><p>Filter and export the current results.</p></div>
        <div className="phone-actions"><button type="button" disabled={!rows.length} onClick={() => exportCsv(rows)}>Export CSV</button><button type="button" disabled={!rows.length} onClick={() => exportExcel(rows)}>Export Excel</button></div>
      </div>
      <div className="phone-table-tools"><div className="phone-filters">
        {["all", "valid", "invalid", "unknown"].map(value => <button type="button" key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      </div><input aria-label="Search results" className="phone-search" placeholder="Search phone, country or carrier…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div className="phone-table-wrap"><table><thead><tr><th>Input</th><th>Normalized</th><th>Country</th><th>Format</th><th>Line type</th><th>Carrier</th><th>Lookup</th></tr></thead>
        <tbody>{visibleRows.length ? visibleRows.map((row, index) => <tr key={`${row.input}-${index}`}><td>{row.input}</td><td>{row.normalized || "—"}</td><td>{row.country || "—"}</td><td><Validity value={row.validFormat} /></td><td>{row.lineType || "Unknown"}</td><td>{row.carrier || "—"}</td><td>{row.lookupStatus || "Not run"}</td></tr>) : <tr><td colSpan="7" className="phone-empty">No results yet. Check a number or upload a spreadsheet.</td></tr>}</tbody>
      </table></div>
      <div className="phone-table-footer">Showing {visibleRows.length} of {rows.length} records <span>Maximum {health.maxBulkRows || 500} records per batch</span></div>
    </section>

    <div className="phone-notes"><p><strong>Format validity</strong><br />Checks number structure against numbering-plan data. It does not prove that a number is active.</p><p><strong>Reachability and WhatsApp</strong><br />Not confirmed here. Carrier data does not prove current service, SMS delivery, ownership or WhatsApp registration.</p></div>
  </div>;
}

createRoot(document.getElementById("phone-checker-root")).render(<App />);
