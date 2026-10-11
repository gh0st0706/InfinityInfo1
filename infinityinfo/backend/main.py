
import csv
import io
import os
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
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

app = FastAPI(title="InfinityInfo API")
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5500,http://127.0.0.1:5500,null",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

HUNTER_API_KEY = os.getenv("HUNTER_API_KEY")
HUNTER_URL = "https://api.hunter.io/v2/email-finder"

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


@app.get("/")
def home():
    return {"message": "InfinityInfo API is running"}


@app.post("/find-email")
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

    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="File must be 10 MB or smaller",
        )

    if extension == ".csv":
        try:
            text = raw.decode("utf-8-sig")
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
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="CSV must use UTF-8 encoding",
            )
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
