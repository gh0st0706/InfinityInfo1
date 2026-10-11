# InfinityInfo

InfinityInfo is a lead-enrichment tool that takes an existing CSV or Excel file of company/contact information, finds candidate email addresses for the supplied records, and returns an enriched file for download.

## Architecture

- **Frontend:** Hosted on Vercel.
- **Backend / email finder:** Python and FastAPI, hosted on Render.
- **Communication:** The frontend sends requests to the backend API. Backend URLs and credentials should be configured through deployment environment variables rather than hard-coded into browser code.

The frontend and backend are deployed separately so each can be updated independently.

## Current workflow

1. Open the InfinityInfo website.
2. Upload a CSV or Excel file containing lead information. The input does not need to already contain email addresses.
3. The backend processes the uploaded records and runs the email-finding workflow.
4. Check the job status while processing is underway.
5. Retrieve the completed results and download the enriched file.

The goal is to preserve the input records and add the email-finding results, rather than returning unrelated or fabricated records.

## API workflow

The backend API uses a job-based upload and result flow:

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/uploads` | Upload a file and start processing. |
| `GET` | `/api/v1/jobs/{job_id}` | Check the processing status for a job. |
| `GET` | `/api/v1/results/{job_id}` | Retrieve the completed job results. |

Use the actual deployed backend base URL when calling these routes. If the backend API changes, update this table and the frontend configuration together.

## Supported files

- **CSV** input and output.
- **Excel** workbooks where supported by the deployed backend.

Keep a copy of the original file until the output has been checked. Review discovered addresses before using them for outreach.

## Deployment

### Frontend (Vercel)

1. Connect the frontend repository to Vercel.
2. Configure the environment variable used by the frontend for the backend API base URL.
3. Set it to the deployed Render backend URL, without exposing private credentials in frontend code.
4. Redeploy after changing environment variables.
5. Confirm that the configured backend origin is allowed by the API's CORS settings.

The environment variable name must match what the frontend code reads; check the repository before adding or changing it.

### Backend (Render)

1. Connect the backend repository to a Render Web Service.
2. Set the Python build and start commands required by the project.
3. Configure required environment variables in the Render dashboard.
4. Deploy and inspect the logs if startup or requests fail.
5. Test the upload, status, and result endpoints against the deployed service.

Do not commit API keys, passwords, SMTP credentials, or other secrets to the repository.

## Email discovery versus verification

Email discovery and email verification are different tasks. Finding a candidate address does not prove that the mailbox exists or can receive mail. Treat the finder output as discovered candidates unless a separate verification step has explicitly checked them.

## Troubleshooting

- **Frontend cannot reach the API:** Verify the backend base URL, browser network errors, and CORS configuration.
- **Upload fails:** Confirm the file type, request format, and backend logs.
- **Job stays pending or fails:** Check the Render service logs and the job-status endpoint.
- **Results cannot be downloaded:** Confirm the job ID and check whether processing completed successfully.
- **Changes do not appear on the website:** Verify the Vercel deployment and its environment variables.

## Development notes

- Keep frontend and backend responsibilities separate.
- Avoid hard-coding deployment URLs in multiple places.
- Do not describe discovered emails as verified unless a verification step has actually run.
- Test with a small sample file before processing a larger lead list.
