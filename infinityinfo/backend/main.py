
import asyncio
import csv
import html.parser
import ipaddress
import io
import os
import re
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse

import dns.asyncresolver

import httpx
from dotenv import dotenv_values, load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from openpyxl import Workbook, load_workbook
except ImportError:
    Workbook = load_workbook = None

try:
    import xlrd
except ImportError:
    xlrd = None

load_dotenv()


def load_hunter_api_key():
    key = os.getenv("HUNTER_API_KEY", "").strip()
    if key:
        return key

    app_directory = Path(__file__).resolve().parent
    for key_file in (
        Path("/etc/secrets/HUNTER_API_KEY"),
        app_directory / "HUNTER_API_KEY",
    ):
        try:
            key = key_file.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if key:
            return key

    for env_file in (
        Path("/etc/secrets/.env"),
        app_directory / ".env",
    ):
        key = (dotenv_values(env_file).get("HUNTER_API_KEY") or "").strip()
        if key:
            return key

    return ""

app = FastAPI(title="InfinityInfo API")
allowed_origins = [
    "https://infinityinfo1-infinityinfo.vercel.app",
    *[
        origin.strip()
        for origin in os.getenv(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:5500,http://127.0.0.1:5500,null",
        ).split(",")
        if origin.strip()
    ],
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

HUNTER_API_KEY = load_hunter_api_key()
HUNTER_URL = "https://api.hunter.io/v2/email-finder"
MAX_UPLOAD_BYTES = 4 * 1024 * 1024

REQUIRED_COLUMNS = {
    "First Name",
    "Last Name",
    "Full Name",
    "Company Website",
    "Email",
    "Email Status",
}


class EmailSearch(BaseModel):
    first_name: str
    last_name: str
    domain: str


class PersonFinderSearch(BaseModel):
    full_name: str
    company: str


class PublicPageParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text_parts = []
        self.links = []

    def handle_data(self, data):
        self.text_parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            href = dict(attrs).get("href", "")
            if href:
                self.links.append(href)
                if href.lower().startswith("mailto:"):
                    self.text_parts.append(href[7:].split("?", 1)[0])


EMAIL_PATTERN = re.compile(r"[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+", re.I)


def normalize_company_domain(value):
    value = clean(value)
    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = (parsed.hostname or "").lower().rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    if not host or "." not in host or len(host) > 253:
        raise HTTPException(status_code=400, detail="Enter a valid company domain")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise HTTPException(status_code=400, detail="Enter a company domain, not an IP address")
    if any(not label or len(label) > 63 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label) for label in host.split(".")):
        raise HTTPException(status_code=400, detail="Enter a valid company domain")
    return host


async def assert_public_host(host):
    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM
        )
    except OSError as exc:
        raise HTTPException(status_code=400, detail="The company domain could not be resolved") from exc
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise HTTPException(status_code=400, detail="The company domain does not resolve to a public address")


async def inspect_public_company_site(client, domain):
    await assert_public_host(domain)
    allowed_hosts = {domain}
    urls = [f"https://{domain}/"]
    try:
        await assert_public_host(f"www.{domain}")
    except HTTPException:
        pass
    else:
        allowed_hosts.add(f"www.{domain}")
        urls.append(f"https://www.{domain}/")
    visited = set()
    found = set()
    for _ in range(5):
        if not urls:
            break
        url = urls.pop(0)
        parsed_url = urlparse(url)
        if parsed_url.hostname not in allowed_hosts or url in visited:
            continue
        visited.add(url)
        try:
            async with client.stream("GET", url, headers={"User-Agent": "InfinityInfoEmailFinder/1.0"}) as response:
                if response.status_code >= 400 or "html" not in response.headers.get("content-type", "").lower():
                    continue
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 1_000_000:
                        break
            parser = PublicPageParser()
            parser.feed(body.decode("utf-8", errors="ignore"))
            found.update(email.lower() for email in EMAIL_PATTERN.findall(" ".join(parser.text_parts)))
            for href in parser.links:
                next_url = urljoin(url, href)
                next_parsed = urlparse(next_url)
                if (
                    next_parsed.scheme in {"http", "https"}
                    and next_parsed.hostname in allowed_hosts
                    and next_parsed.port in {None, 80, 443}
                    and not next_parsed.username
                    and not next_parsed.password
                    and next_url not in visited
                ):
                    urls.append(next_url.split("#", 1)[0])
        except (httpx.HTTPError, ValueError):
            continue
    return sorted(email for email in found if email.rsplit("@", 1)[1] == domain)


async def lookup_person_publicly(first_name, last_name, domain):
    resolver = dns.asyncresolver.Resolver()
    try:
        mx_records = await resolver.resolve(domain, "MX", lifetime=4)
        if all(record.exchange.to_text() == "." for record in mx_records):
            return {"found": False, "email": "", "confidence": "", "validation": "", "result": "no_mail_server", "candidates": []}
    except dns.resolver.NXDOMAIN:
        return {"found": False, "email": "", "confidence": "", "validation": "", "result": "no_mail_server", "candidates": []}
    except dns.resolver.NoAnswer:
        # RFC 5321 permits an implicit MX: the domain itself accepts mail.
        try:
            await resolver.resolve(domain, "A", lifetime=3)
        except dns.resolver.NoAnswer:
            try:
                await resolver.resolve(domain, "AAAA", lifetime=3)
            except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
                return {"found": False, "email": "", "confidence": "", "validation": "", "result": "no_mail_server", "candidates": []}
    except (dns.resolver.NoNameservers, dns.exception.Timeout, dns.exception.DNSException) as exc:
        raise HTTPException(status_code=503, detail="Could not check company mail records. Please try again.") from exc

    async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
        public_emails = await inspect_public_company_site(client, domain)

    first = first_name.casefold()
    last = last_name.casefold()
    direct_matches = [email for email in public_emails if email.split("@", 1)[0].replace(".", "").replace("_", "").replace("-", "") in {first + last, last + first}]
    if direct_matches:
        return {"found": True, "email": direct_matches[0], "confidence": "public_source", "validation": "domain_has_mx", "result": "found_publicly", "candidates": []}

    separators = [".", "_", "-"]
    sample_locals = [email.split("@", 1)[0] for email in public_emails]
    observed_separator = next((separator for separator in separators if any(re.fullmatch(r"[a-z]+" + re.escape(separator) + r"[a-z]+", local) for local in sample_locals)), None)
    if observed_separator:
        candidate = f"{first}{observed_separator}{last}@{domain}"
        confidence = "domain_format_clue"
        result = "pattern_candidate"
        candidates = [candidate]
    elif public_emails:
        candidate = f"{first}{last}@{domain}"
        confidence = "low"
        result = "pattern_candidate"
        candidates = [candidate]
    else:
        candidate = ""
        confidence = ""
        result = "not_found_publicly"
        candidates = []

    return {"found": False, "email": candidate, "confidence": confidence, "validation": "domain_has_mx", "result": result, "candidates": candidates}


def clean(value):
    return str(value).strip() if value is not None else ""


def get_domain(website):
    website = clean(website)
    if not website:
        return ""

    parsed = urlparse(
        website if "://" in website else f"https://{website}"
    )
    host = (parsed.hostname or "").lower()

    if host.startswith("www."):
        host = host[4:]

    return host


def split_full_name(full_name):
    parts = clean(full_name).split()
    if len(parts) < 2:
        return "", ""

    return parts[0], " ".join(parts[1:])


async def find_with_hunter(client, first_name, last_name, domain):
    if not HUNTER_API_KEY:
        raise RuntimeError("Hunter API key is not configured")

    response = await client.get(
        HUNTER_URL,
        params={
            "first_name": first_name,
            "last_name": last_name,
            "domain": domain,
            "api_key": HUNTER_API_KEY,
        },
    )

    if response.status_code != 200:
        # Do not return raw provider errors or secrets to the user.
        return {
            "email": "",
            "confidence": "",
            "verification": "",
            "result": f"provider_error_{response.status_code}",
        }

    data = response.json().get("data", {})
    email = clean(data.get("email"))

    verification = data.get("verification") or {}
    status = clean(verification.get("status"))

    return {
        "email": email,
        "confidence": data.get("score", ""),
        "verification": status,
        "result": "found" if email else "not_found",
    }


@app.get("/health")
@app.get("/api/health")
def home():
    return {
        "message": "InfinityInfo API is running",
        "hunter_api_configured": bool(HUNTER_API_KEY),
        "public_lookup_available": True,
    }


# Keep the existing Render health check working during the migration. Vercel
# serves public/index.html at /, so the API root is intentionally omitted there.
if not os.getenv("VERCEL"):
    app.add_api_route(
        "/",
        home,
        methods=["GET"],
        include_in_schema=False,
    )


@app.post("/find-email")
@app.post("/api/find-email")
async def find_email(search: EmailSearch):
    if not HUNTER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Hunter API key is not configured",
        )

    async with httpx.AsyncClient(timeout=30) as client:
        result = await find_with_hunter(
            client,
            search.first_name,
            search.last_name,
            search.domain,
        )

    return {
        "name": f"{search.first_name} {search.last_name}",
        **result,
    }


@app.post("/email-finder")
@app.post("/api/email-finder")
async def email_finder(search: PersonFinderSearch):
    name_parts = clean(search.full_name).split()
    if len(name_parts) < 2:
        raise HTTPException(status_code=400, detail="Enter a first and last name")
    if len(search.full_name) > 120:
        raise HTTPException(status_code=400, detail="Name must be 120 characters or fewer")
    domain = normalize_company_domain(search.company)
    result = await lookup_person_publicly(name_parts[0], name_parts[-1], domain)
    return {"name": clean(search.full_name), "domain": domain, **result}


async def enrich_rows(headers, rows):
    extra_columns = ["Email Confidence", "Lookup Result"]
    output_headers = list(headers)
    for column in extra_columns:
        if column not in output_headers:
            output_headers.append(column)

    async with httpx.AsyncClient(timeout=30) as client:
        for row in rows:
            for key in headers:
                row[key] = clean(row.get(key))

            row["Email Confidence"] = ""
            row["Lookup Result"] = ""

            if row.get("Email"):
                row["Lookup Result"] = "existing_email_preserved"
                continue

            first_name = row.get("First Name", "")
            last_name = row.get("Last Name", "")

            if not first_name or not last_name:
                first_name, last_name = split_full_name(
                    row.get("Full Name", "")
                )

            domain = get_domain(row.get("Company Website", ""))

            if not first_name or not last_name or not domain:
                row["Lookup Result"] = "missing_name_or_domain"
                continue

            try:
                result = await find_with_hunter(
                    client, first_name, last_name, domain
                )

                if result["email"]:
                    row["Email"] = result["email"]
                    row["Email Status"] = result["verification"]
                    row["Email Confidence"] = result["confidence"]

                row["Lookup Result"] = result["result"]

            except (httpx.HTTPError, ValueError):
                row["Lookup Result"] = "request_failed"

    return output_headers


def read_excel(raw, extension):
    if extension == ".xlsx":
        if load_workbook is None:
            raise HTTPException(
                status_code=503,
                detail="Excel support is missing; install backend/requirements.txt",
            )
        workbook = load_workbook(io.BytesIO(raw))
        sheet = workbook.active
        values = list(sheet.iter_rows(values_only=True))
        workbook.close()
    else:
        if xlrd is None:
            raise HTTPException(
                status_code=503,
                detail="Legacy .xls support is missing; install backend/requirements.txt",
            )
        workbook = xlrd.open_workbook(file_contents=raw)
        sheet = workbook.sheet_by_index(0)
        values = [sheet.row_values(index) for index in range(sheet.nrows)]

    if not values:
        raise HTTPException(status_code=400, detail="Excel file is empty")

    headers = [clean(value) for value in values[0]]
    while headers and not headers[-1]:
        headers.pop()

    if not headers or any(not header for header in headers):
        raise HTTPException(
            status_code=400,
            detail="Excel header row contains an empty column name",
        )

    missing = REQUIRED_COLUMNS - set(headers)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(sorted(missing))}",
        )

    rows = []
    for values_row in values[1:]:
        values_row = list(values_row[:len(headers)])
        values_row.extend([""] * (len(headers) - len(values_row)))
        rows.append(dict(zip(headers, values_row)))

    return headers, rows


def make_xlsx(headers, rows):
    if Workbook is None:
        raise HTTPException(
            status_code=503,
            detail="Excel support is missing; install backend/requirements.txt",
        )
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append([row.get(header, "") for header in headers])

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


@app.post("/upload-csv")
@app.post("/upload")
@app.post("/api/upload-csv")
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    extension = os.path.splitext(file.filename or "")[1].lower()
    if extension not in {".csv", ".xlsx", ".xls"}:
        raise HTTPException(
            status_code=400,
            detail="Please upload a CSV or Excel file (.csv, .xlsx, .xls)",
        )

    if not HUNTER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Hunter API key is not configured",
        )

    raw = await file.read()

    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File must be 4 MB or smaller on Vercel",
        )

    if extension == ".csv":
        try:
            # Excel commonly exports CSV files using the Windows code page.
            # Keep UTF-8 (including BOM) as the preferred encoding, but accept
            # those files too so accented names do not prevent an upload.
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("cp1252")

            reader = csv.DictReader(io.StringIO(text))

            if not reader.fieldnames:
                raise HTTPException(status_code=400, detail="CSV is empty")

            headers = [header.strip() for header in reader.fieldnames]
            reader.fieldnames = headers

            missing = REQUIRED_COLUMNS - set(headers)
            if missing:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required columns: {', '.join(sorted(missing))}",
                )

            rows = list(reader)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="Could not read the CSV file",
            ) from exc
    else:
        try:
            headers, rows = read_excel(raw, extension)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail="Could not read the Excel file",
            ) from exc

    if len(rows) > 1000:
        raise HTTPException(
            status_code=400,
            detail="Maximum 1,000 rows per upload for this version",
        )

    output_headers = await enrich_rows(headers, rows)

    if extension in {".xlsx", ".xls"}:
        output_bytes = make_xlsx(output_headers, rows)
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        output_filename = "infinityinfo_enriched.xlsx"
    else:
        output = io.StringIO(newline="")
        writer = csv.DictWriter(
            output,
            fieldnames=output_headers,
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)
        output_bytes = output.getvalue().encode("utf-8-sig")
        media_type = "text/csv; charset=utf-8"
        output_filename = "infinityinfo_enriched.csv"

    return StreamingResponse(
        io.BytesIO(output_bytes),
        media_type=media_type,
        headers={
            "Content-Disposition":
                f'attachment; filename="{output_filename}"'
        },
    )
