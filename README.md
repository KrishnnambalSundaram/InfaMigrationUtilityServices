## Infa Migration Utility Services - API Guide

This service converts Oracle PL/SQL and Redshift SQL into Snowflake code or IDMC mapping summaries, and processes Batch scripts into IDMC-style summaries or human-readable summaries. It also provides real-time progress via WebSockets.

### Base URL

- Local dev: `http://localhost:3001`

### Authentication

- Most routes require JWT: `Authorization: Bearer <JWT_TOKEN>`

## Endpoints

### 1) Unified Conversion (Oracle/Redshift → Snowflake or IDMC)

POST `/api/conversion/convert-unified`

Request (single):

```json
{
  "inputType": "single",
  "target": "snowflake" | "idmc",
  "sourceType": "oracle" | "redshift" | "auto",
  "fileName": "input.sql",
  "sourceCode": "SELECT 1;",
  "outputFormat": "sql|json|docx|all" // for snowflake; for idmc: "json|docx|sql|all"
}
```

Request (zip):

```json
{
  "inputType": "zip",
  "target": "snowflake" | "idmc",
  "sourceType": "oracle" | "redshift" | "auto",
  "zipFilePath": "/absolute/path/to/archive.zip",
  "outputFormat": "sql|json|docx|all" // snowflake; or "json|docx|sql|all" for idmc
}
```

Sample response (single → Snowflake):

```json
{
  "success": true,
  "conversionType": "oracle-to-snowflake",
  "fileName": "input.sql",
  "originalContent": "SELECT 1;",
  "convertedContent": "CREATE OR REPLACE ...",
  "outputFiles": [
    { "name": "input_snowflake_2025-10-30T09-00-00-000Z.sql", "path": "/abs/output/input_snowflake_....sql", "mime": "text/sql", "kind": "single" },
    { "name": "input_snowflake_2025-10-30T09-00-00-000Z.json", "path": "/abs/output/input_snowflake_....json", "mime": "application/json", "kind": "single" },
    { "name": "input_snowflake_2025-10-30T09-00-00-000Z.docx", "path": "/abs/output/input_snowflake_....docx", "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "kind": "single" }
  ]
}
```

Sample response (zip → IDMC):

```json
{
  "success": true,
  "target": "idmc",
  "jobId": "unified_idmc_<zipBase>",
  "zipFilename": "idmc_summaries_json_2025-10-30T09-00-00-000Z.zip",
  "zipFilePath": "/abs/zips/idmc_summaries_json_....zip",
  "jsonContent": null,
  "conversion": {
    "totalConverted": 15,
    "totalFiles": 15,
    "successRate": 100,
    "convertedFiles": [
      {
        "original": "01_customer.sql",
        "converted": "01_customer_IDMC_Summary.json",
        "oracleContent": "...",
        "idmcContent": "## 🧩 IDMC Mapping Summary...",
        "detectedType": "oracle",
        "success": true
      }
    ],
    "errors": []
  }
}
```

Output formats:

- Snowflake: `sql` (default), `json`, `docx`, `all`
- IDMC: `json` (default), `docx`, `sql` (original input saved), `all`

### 2) Progress API

GET `/api/conversion/progress/:jobId`

Response:

```json
{ "success": true, "job": { "jobId": "...", "status": "pending|completed|failed", "result": {"zipFilename":"..."}, "error": null } }
```

### 3) Download API

POST `/api/conversion/download`

Request (by filename):

```json
{ "filename": "converted_oracle_snowflake_sql_2025-10-30T09-00-00-000Z.zip" }
```

Request (by absolute path under allowed outputs):

```json
{ "filePath": "/absolute/path/under/zips-or-output-or-idmc/any.ext" }
```

### 4) Batch Script → IDMC Summaries

ZIP: POST `/api/idmc/batch`

```json
{
  "inputType": "zip",
  "zipFilePath": "/absolute/path/to/batch.zip",
  "outputFormat": "md" | "txt" // default md
}
```

SINGLE: POST `/api/idmc/batch` (single)

```json
{
  "inputType": "single",
  "script": "sqlplus ...",
  "fileName": "run.bat",
  "scriptType": "oracle|redshift",
  "outputFormat": "md" | "txt"
}
```

Response (single):

```json
{
  "success": true,
  "message": "Batch script processed successfully",
  "fileName": "run.bat",
  "scriptType": "oracle",
  "originalContent": "...",
  "extractionResult": { "totalStatements": 2, "statements": [ {"type":"SELECT","statement":"..."} ] },
  "idmcSummaries": [ { "fileName": "run.bat_statement_1_IDMC_Summary.md", "idmcSummary": "## 🧩 IDMC Mapping Summary ..." } ],
  "jsonContent": "### Statement 1\n\n## 🧩 IDMC Mapping Summary ...",
  "outputFiles": [ { "name": "run.bat_statement_1_IDMC_Summary_...md", "path": "/abs/output/...md", "mime": "text/markdown" } ]
}
```

Response (zip):

```json
{
  "success": true,
  "message": "Batch script processing completed successfully",
  "source": "/abs/path/batch.zip",
  "jobId": "batch_scripts_<zipBase>",
  "jsonContent": "{\n  \"totalFiles\": ...\n}",
  "processing": {
    "totalFiles": 4,
    "processedFiles": 4,
    "failedFiles": 0,
    "successRate": 100,
    "results": [ { "fileName": "LoadTMSnapshot.bat", "scriptType": "oracle", "success": true, "extractionResult": { "totalStatements": 1 } } ]
  },
  "zipFilename": "batch_scripts_idmc_summaries_md_2025-10-30T09-00-00-000Z.zip",
  "zipFilePath": "/abs/zips/batch_scripts_idmc_summaries_md_...zip"
}
```

Output formats (Batch → IDMC): `md` (default) or `txt`

### 5) Batch Script → Human Language Summary

POST `/api/idmc/batch-summary`

```json
{
  "script": "@echo off ...",
  "fileName": "run.bat",
  "outputFormat": "md" | "txt" // default md
}
```

Response:

```json
{
  "success": true,
  "fileName": "run.bat",
  "originalContent": "@echo off ...",
  "summary": "## 🔹 Batch File Summary\n\n### 1. Source File ...",
  "jsonContent": "## 🔹 Batch File Summary\n\n### 1. Source File ...",
  "outputFiles": [ { "name": "run_Summary_...md", "path": "/abs/output/run_Summary_...md", "mime": "text/markdown" } ]
}
```

### 6) WebSocket Progress

- Socket.IO served at `/socket.io`. See `public/progress-listener.html`.
- Events: `connection-established`, `progress-update`, `system-notification`, `job-statistics`.

Client example:

```html
<script src="/socket.io/socket.io.js"></script>
<script>
  const socket = io(location.origin);
  socket.on('progress-update', (p) => console.log(p));
</script>
```

## Output File Types Summary

- Snowflake: `.sql`, `.json`, `.docx`
- IDMC (from SQL): `.json` (markdown string stored), `.docx`, original `.sql` if requested
- Batch → IDMC: `.md` or `.txt`
- Batch → Human Summary: `.md` or `.txt`

## Notes

- Downloads are served only from allowed output roots: `ZIPS_PATH`, `OUTPUT_PATH`, `IDMC_PATH`.
- For security, provide absolute paths under those roots when using the download API.


