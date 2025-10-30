## Oracle → Snowflake/IDMC Migration Utility

This utility converts Oracle PL/SQL (and Redshift SQL) into target outputs (Snowflake SQL/JS or IDMC Mapping Summaries). It supports converting a single script or a ZIP archive of scripts, progress tracking, and packaging outputs as ZIP. For IDMC, you can export JSON and DOCX.

### Contents

- Quick Start
- Authentication
- Unified Conversion API (ZIP/Single)
- Progress API
- Download API
- Batch Script APIs
- WebSocket Progress
- Configuration
- Errors
- Examples
- Integration Tips

### Quick Start

1. Install dependencies:

```
npm install
```

2. Configure env vars (see Configuration).
3. Run the server:

```
npm run dev
```

### Authentication

Most routes require JWT. Obtain a token via the login route and send:

```
Authorization: Bearer <JWT_TOKEN>
```

### Unified Conversion API

Base: `/api/conversion`

POST `/api/conversion/convert-unified`

- Converts to Snowflake or IDMC.
- Supports single script or ZIP.

Supported targets and formats:

- Targets: `snowflake`, `idmc`
- Output formats (IDMC only): `json`, `docx`, `pdf` (reserved), `all`

Request body (JSON):

```
{
  "inputType": "zip" | "single",
  "target": "snowflake" | "idmc",
  "sourceType": "oracle" | "redshift" | "auto" (optional; default auto),

  // inputType = zip
  "zipFilePath": "/absolute/path/to/archive.zip",

  // inputType = single
  "sourceCode": "SELECT ...",
  "fileName": "script.sql",

  // IDMC only
  "outputFormat": "json" | "docx" | "pdf" | "all" (default json)
}
```

Notes on `outputFormat` (IDMC target):

- `json`: outputs `*_IDMC_Summary.json`.
- `docx`: outputs `*_IDMC_Summary.docx`.
- `all`: both JSON and DOCX.
- `pdf`: reserved for future (not generated yet).

Responses:

- Snowflake (zip input):

```
{
  "success": true,
  "target": "snowflake",
  "jobId": "unified_snowflake_<zipBase>",
  "zipFilename": "converted_oracle_snowflake_<timestamp>.zip",
  "conversion": { "totalConverted": n, "totalFiles": n, "successRate": n, "convertedFiles": [...], "errors": [] }
}
```

- IDMC (zip input):

```
{
  "success": true,
  "target": "idmc",
  "jobId": "unified_idmc_<zipBase>",
  "zipFilename": "idmc_summaries_<format>_<timestamp>.zip",
  "conversion": { "totalConverted": n, "totalFiles": n, "successRate": n, "convertedFiles": [...], "errors": [] }
}
```

- Single input (IDMC or Snowflake):

```
{
  "success": true,
  "conversionType": "oracle-to-snowflake" | "<source>-to-idmc",
  "fileName": "input.sql",
  "result": "<converted code or IDMC markdown>"
}
```

### Progress API

GET `/api/conversion/progress/:jobId`
Returns progress and status.

```
{
  "success": true,
  "job": { "jobId": "...", "steps": [...], "status": "completed|failed|...", "result": { ... }, "error": "..." }
}
```

### Download API

POST `/api/conversion/download`
Body:

```
{ "filename": "<zip returned by convert-unified>" }
```

Returns: ZIP stream.

### Batch Script APIs

Base: `/api/idmc`

POST `/api/idmc/batch`

```
{
  "inputType": "zip" | "single",
  "zipFilePath": "/absolute/path/to/zip.zip",
  "script": "echo hello",          // when single
  "fileName": "run.sh|run.bat",
  "scriptType": "oracle|redshift"   // optional
}
```

POST `/api/idmc/batch-summary`

```
{ "script": "echo hello", "fileName": "run.sh" }
```

Usage guide (Batch conversion):

- ZIP input:
  1. Place your `.sh`/`.bat` scripts in a ZIP.
  2. Call `POST /api/idmc/batch` with `{ inputType: "zip", zipFilePath: "/abs/path.zip" }`.
  3. Poll progress if applicable; download packaged results if returned by your flow.
- Single input:
  1. Call `POST /api/idmc/batch` with `{ inputType: "single", script: "...", fileName: "run.sh" }`.
  2. Receive a JSON response containing the processed result/summary.

### WebSocket Progress

Socket.IO is included for real-time updates. See `public/websocket-test.html` and `websocket/` for integration patterns.

ZIP conversions (Snowflake and IDMC) emit WebSocket progress:

- On job creation (status=created), then on each step (initializing, extracting, scanning/converting, packaging), and on completion/failure.
- Join the `jobId` room to receive events only for that job.

Client example:

```
<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io(location.origin);
  const jobId = 'unified_idmc_<your-zip-base>'; // from convert-unified response
  socket.emit('join-job', jobId);
  socket.on('progress-update', (p) => {
    if (p.jobId !== jobId) return;
    console.log(p.status, p.progress, p.currentStep);
    if (p.status === 'completed') {
      console.log('ZIP ready:', p.result?.zipFilename || p.zipFilename);
    }
  });
</script>
```

### Configuration

Set via environment variables:

```
PORT=3000
OPENAI_API_KEY=<key>
UPLOAD_PATH=./uploads
ZIPS_PATH=./zips
IDMC_PATH=./idmc_output
CONVERTED_PATH=./converted
JWT_SECRET=<secret>
```

### Errors

Validation errors: 400 with details. Runtime: 500. Failed jobs are visible via Progress API.

### Examples

Convert ZIP → IDMC (DOCX):

```
curl -X POST http://localhost:3000/api/conversion/convert-unified \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "inputType": "zip",
    "target": "idmc",
    "sourceType": "auto",
    "zipFilePath": "/Users/me/sample-oracle-files.zip",
    "outputFormat": "docx"
  }'
```

Convert ZIP → Snowflake:

```
curl -X POST http://localhost:3000/api/conversion/convert-unified \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "inputType": "zip", "target": "snowflake", "zipFilePath": "/Users/me/sample-oracle-files.zip" }'
```

Single → IDMC:

```
curl -X POST http://localhost:3000/api/conversion/convert-unified \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "inputType": "single",
    "target": "idmc",
    "sourceType": "auto",
    "fileName": "query.sql",
    "sourceCode": "SELECT 1;",
    "outputFormat": "json"
  }'
```

Poll progress:

```
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/conversion/progress/unified_idmc_sample-oracle-files
```

Download ZIP:

```
curl -X POST http://localhost:3000/api/conversion/download \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"filename":"idmc_summaries_docx_2025-10-30T07-49-49-482Z.zip"}' \
  --output idmc_summaries_docx.zip
```

### How to use the APIs (step-by-step)

IDMC or Snowflake conversion (ZIP):

1. Ensure your ZIP contains SQL/PLSQL files and is accessible by path.
2. Call `POST /api/conversion/convert-unified` with `{ inputType: "zip", target: "idmc"|"snowflake", zipFilePath: "...", outputFormat: "docx|json|all" }` (format for IDMC only).
3. Save `jobId` and `zipFilename` from the response.
4. Optionally poll `GET /api/conversion/progress/:jobId` until `status` is `completed`.
5. Download with `POST /api/conversion/download { filename: zipFilename }`.

IDMC or Snowflake conversion (single):

1. Provide your SQL text and a `fileName`.
2. Call `POST /api/conversion/convert-unified` with `{ inputType: "single", target: "idmc"|"snowflake", sourceCode: "...", fileName: "...", outputFormat: "json|docx|all" }`.
3. Receive the converted content directly in `result` (no ZIP for single).

Batch script conversion:

1. For ZIP: `POST /api/idmc/batch` with `{ inputType: "zip", zipFilePath: "..." }`.
2. For single: `POST /api/idmc/batch` with `{ inputType: "single", script: "...", fileName: "run.sh" }`.
3. For quick summaries of a single script: `POST /api/idmc/batch-summary`.

### Integration Tips

- Capture `jobId` from `convert-unified` to poll `/progress/:jobId`.
- UI flow: Upload ZIP → call convert → poll → enable download of `zipFilename`.
- For readable handouts, set IDMC `outputFormat` to `docx` or `all`.
- Optionally use WebSocket for real-time progress.
- Surface validation and runtime errors clearly to users.
