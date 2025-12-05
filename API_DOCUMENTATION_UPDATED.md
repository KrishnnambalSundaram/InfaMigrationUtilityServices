# API Documentation - Updated Features

This document describes the updated API endpoints with new features including single file uploads, custom file names, and enhanced IDMC conversion support.

## Table of Contents

1. [File Upload API](#file-upload-api)
2. [Unified Conversion API](#unified-conversion-api)
3. [IDMC Conversion APIs](#idmc-conversion-apis)
4. [IDMC Summary to JSON API](#idmc-summary-to-json-api)
5. [Download API](#download-api)
6. [Custom File Name Support](#custom-file-name-support)

---

## File Upload API

**Endpoint:** `POST /api/upload`

**Description:** Upload single files (SQL, ZIP, TXT, BIN, etc.) for processing. Supports both ZIP archives and individual files.

**Authentication:** Not required (rate limited)

**Request:**

### Option 1: Upload ZIP File (Legacy)

```javascript
const formData = new FormData();
formData.append('zipFile', fileInput.files[0]);

fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

### Option 2: Upload Single File (New)

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]); // Can be .sql, .txt, .bin, etc.

fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

**Supported File Types:**

- ZIP files (`.zip`)
- SQL files (`.sql`, `.pls`, `.pkg`, `.prc`, `.fnc`, `.rs`, `.redshift`)
- Text files (`.txt`, `.md`)
- Binary files (`.bin`)
- Any other file type

**Response:**

```json
{
  "success": true,
  "message": "File uploaded successfully",
  "file": {
    "filename": "input-1234567890.sql",
    "originalName": "input.sql",
    "path": "/path/to/uploads/input-1234567890.sql",
    "size": "15.2 KB",
    "mimetype": "text/plain"
  }
}
```

**Use Case:** Upload a file first, then use the returned `file.path` in conversion APIs.

---

## Unified Conversion API

**Endpoint:** `POST /api/conversion/convert-unified`

**Description:** Unified endpoint for all conversion types. Supports Oracle/Redshift → Snowflake/IDMC conversions with single file or ZIP input.

**Authentication:** Required (JWT token)

**Request Headers:**

```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

### Single File Conversion

**Request:**

```json
{
  "inputType": "single",
  "target": "snowflake" | "idmc",
  "sourceType": "oracle" | "redshift" | "auto",
  "sourceCode": "SELECT * FROM users WHERE id = 1;",
  "fileName": "query.sql",
  "customFileName": "my_custom_output",  // Optional: custom output file name
  "outputFormat": "sql" | "json" | "docx" | "all"  // For snowflake: sql|json|docx|all, for idmc: json|docx|sql|all
}
```

**Response (Snowflake):**

```json
{
  "success": true,
  "conversionType": "oracle-to-snowflake",
  "fileName": "my_custom_output.sql",
  "jsonContent": "CREATE OR REPLACE PROCEDURE...",
  "jobId": "unified_snowflake_single_2025-01-15T10-30-45-123Z",
  "outputFiles": [
    {
      "name": "my_custom_output.sql",
      "path": "/absolute/path/to/output/my_custom_output.sql",
      "mime": "text/sql",
      "kind": "single"
    }
  ]
}
```

**Response (IDMC):**

```json
{
  "success": true,
  "conversionType": "oracle-to-idmc",
  "fileName": "my_custom_output",
  "jsonContent": "## 🧩 IDMC Mapping Summary...",
  "originalContent": "SELECT * FROM users...",
  "jobId": "unified_idmc_single_2025-01-15T10-30-45-123Z",
  "outputFiles": [
    {
      "name": "my_custom_output.json",
      "path": "/absolute/path/to/output/my_custom_output.json",
      "mime": "application/json",
      "kind": "single"
    },
    {
      "name": "my_custom_output.docx",
      "path": "/absolute/path/to/output/my_custom_output.docx",
      "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "kind": "single"
    }
  ]
}
```

### ZIP File Conversion

**Request:**

```json
{
  "inputType": "zip",
  "target": "snowflake" | "idmc",
  "sourceType": "oracle" | "redshift" | "auto",
  "zipFilePath": "/absolute/path/to/files.zip",
  "customFileName": "my_conversion_output",  // Optional: custom output ZIP name
  "outputFormat": "sql" | "json" | "docx" | "all"
}
```

**Response:**

```json
{
  "success": true,
  "target": "idmc",
  "jobId": "unified_idmc_oracle-files",
  "zipFilename": "my_conversion_output_2025-01-15T10-30-45-123Z.zip",
  "zipFilePath": "/absolute/path/to/zips/my_conversion_output_2025-01-15T10-30-45-123Z.zip",
  "conversion": {
    "totalConverted": 15,
    "totalFiles": 15,
    "successRate": 100,
    "convertedFiles": [...],
    "errors": []
  }
}
```

**Parameters:**

| Parameter        | Type   | Required | Description                                                                                                |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| `inputType`      | string | Yes      | `"single"` or `"zip"`                                                                                      |
| `target`         | string | Yes      | `"snowflake"` or `"idmc"`                                                                                  |
| `sourceType`     | string | No       | `"oracle"`, `"redshift"`, or `"auto"` (default: `"auto"`)                                                  |
| `sourceCode`     | string | Yes\*    | Source code content (required for `inputType: "single"`)                                                   |
| `fileName`       | string | Yes\*    | Original file name (required for `inputType: "single"`)                                                    |
| `zipFilePath`    | string | Yes\*    | Absolute path to ZIP file (required for `inputType: "zip"`)                                                |
| `customFileName` | string | No       | Custom name for output files (without extension)                                                           |
| `outputFormat`   | string | No       | Output format: `"sql"`, `"json"`, `"docx"`, or `"all"` (default: `"json"` for IDMC, `"sql"` for Snowflake) |

---

## IDMC Conversion APIs

### Oracle to IDMC

**Endpoint:** `POST /api/idmc/oracle-to-idmc`

**Description:** Convert Oracle SQL/PL-SQL code to IDMC mapping summaries.

**Authentication:** Required (JWT token)

**Request (Single File):**

```json
{
  "sourceCode": "SELECT * FROM customers WHERE id = 1;",
  "fileName": "query.sql",
  "customFileName": "customer_query_idmc",  // Optional
  "outputFormat": "json" | "docx" | "sql" | "all"
}
```

**Request (ZIP File):**

```json
{
  "zipFilePath": "/absolute/path/to/oracle-files.zip",
  "customFileName": "oracle_idmc_conversion" // Optional
}
```

**Response:**

```json
{
  "success": true,
  "message": "Oracle → IDMC conversion completed successfully",
  "source": "/path/to/oracle-files.zip",
  "jobId": "oracle_idmc_oracle-files",
  "conversion": {
    "totalConverted": 15,
    "totalFiles": 15,
    "successRate": 100
  },
  "zipFilename": "oracle_idmc_summaries_2025-01-15T10-30-45-123Z.zip"
}
```

### Redshift to IDMC

**Endpoint:** `POST /api/idmc/redshift-to-idmc`

**Description:** Convert Redshift SQL code to IDMC mapping summaries.

**Authentication:** Required (JWT token)

**Request (Single File):**

```json
{
  "sourceCode": "SELECT * FROM users WHERE id = 1;",
  "fileName": "query.sql",
  "customFileName": "redshift_query_idmc",  // Optional
  "outputFormat": "json" | "docx" | "sql" | "all"
}
```

**Request (ZIP File):**

```json
{
  "zipFilePath": "/absolute/path/to/redshift-files.zip",
  "customFileName": "redshift_idmc_conversion" // Optional
}
```

**Response:** Same format as Oracle to IDMC

### Auto-Detect to IDMC

**Endpoint:** `POST /api/idmc/auto-to-idmc`

**Description:** Automatically detect source type (Oracle/Redshift) and convert to IDMC.

**Authentication:** Required (JWT token)

**Request:** Same as Oracle/Redshift endpoints

---

## IDMC Summary to JSON API

**Endpoint:** `POST /api/idmc/summary-to-json`

**Description:** Convert IDMC mapping summaries (markdown/text) to IDMC mapping JSON files. **Now supports `.txt` and `.bin` input files and outputs `.bin` files.**

**Authentication:** Required (JWT token)

### Single File Conversion

**Request:**

```json
{
  "sourceCode": "## 🧩 IDMC Mapping Summary\n\n### 1. Objective\n...",
  "fileName": "mapping.md",
  "customFileName": "my_idmc_mapping", // Optional: custom output file name
  "outputFormat": "bin" | "txt" | "doc" | "all" // Default: "bin"
}
```

**Output Format Options:**

| `outputFormat` Value | Output Files Generated         | Description                                                     |
| -------------------- | ------------------------------ | --------------------------------------------------------------- |
| `"bin"` (default)    | `.bin` file only               | Creates a single `.bin` file with the IDMC mapping JSON content |
| `"txt"`              | `.bin` + `.txt` files          | Creates both `.bin` and `.txt` files with the same content      |
| `"doc"`              | `.bin` + `.doc` files          | Creates both `.bin` and `.doc` files with the same content      |
| `"all"`              | `.bin` + `.txt` + `.doc` files | Creates all three file formats (.bin, .txt, .doc)               |

**Note:** The `.bin` file is always created (it's the primary output format). The `outputFormat` parameter controls which additional files are also generated.

**Supported Input File Types:**

- Markdown files (`.md`)
- Text files (`.txt`) - **NEW**
- Binary files (`.bin`) - **NEW**
- JSON files (`.json`)

**Response:**

```json
{
  "success": true,
  "message": "IDMC summary converted to JSON successfully",
  "fileName": "mapping.md",
  "originalContent": "## 🧩 IDMC Mapping Summary...",
  "convertedContent": "{\"documentType\":\"MAPPING\",...}",
  "outputFiles": [
    {
      "name": "my_idmc_mapping.bin",
      "path": "/absolute/path/to/output/my_idmc_mapping.bin",
      "mime": "application/octet-stream",
      "kind": "single"
    },
    {
      "name": "my_idmc_mapping.txt",
      "path": "/absolute/path/to/output/my_idmc_mapping.txt",
      "mime": "text/plain",
      "kind": "single"
    },
    {
      "name": "my_idmc_mapping.doc",
      "path": "/absolute/path/to/output/my_idmc_mapping.doc",
      "mime": "application/msword",
      "kind": "single"
    }
  ]
}
```

### ZIP File Conversion

**Request:**

```json
{
  "zipFilePath": "/absolute/path/to/idmc-summaries.zip",
  "customFileName": "idmc_mappings" // Optional: custom output ZIP name
}
```

**Response:**

```json
{
  "success": true,
  "message": "IDMC Summary → JSON conversion completed successfully",
  "source": "/path/to/idmc-summaries.zip",
  "jobId": "idmc_summary_json_idmc-summaries",
  "zipFilename": "idmc_mappings_2025-01-15T10-30-45-123Z.zip",
  "zipFilePath": "/absolute/path/to/zips/idmc_mappings_2025-01-15T10-30-45-123Z.zip",
  "results": [
    {
      "fileName": "mapping1.md",
      "originalContent": "...",
      "convertedContent": "{...}",
      "success": true
    }
  ],
  "processing": {
    "totalFiles": 10,
    "processedFiles": 10,
    "failedFiles": 0,
    "successRate": 100
  }
}
```

**Key Changes:**

- ✅ Now accepts `.txt` and `.bin` input files
- ✅ Output format changed from `.bat` to `.bin`
- ✅ Supports custom file names
- ✅ Can generate `.bin`, `.txt`, and `.doc` outputs based on `outputFormat` parameter

**Output Format Details:**

- **Default (`outputFormat: "bin"`):** Creates only a `.bin` file
- **TXT Format (`outputFormat: "txt"`):** Creates both `.bin` and `.txt` files
- **DOC Format (`outputFormat: "doc"`):** Creates both `.bin` and `.doc` files
- **All Format (`outputFormat: "all"`):** Creates all three formats (`.bin`, `.txt`, `.doc`)

**Parameters:**

| Parameter        | Type   | Required | Description                                                                                                                                                  |
| ---------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sourceCode`     | string | Yes\*    | IDMC summary content (required for single file)                                                                                                              |
| `fileName`       | string | Yes\*    | Original file name (required for single file)                                                                                                                |
| `zipFilePath`    | string | Yes\*    | Absolute path to ZIP file (required for ZIP conversion)                                                                                                      |
| `customFileName` | string | No       | Custom name for output files (without extension)                                                                                                             |
| `outputFormat`   | string | No       | `"bin"` (default - creates `.bin` only), `"txt"` (creates `.bin` + `.txt`), `"doc"` (creates `.bin` + `.doc`), or `"all"` (creates `.bin` + `.txt` + `.doc`) |

---

## Download API

**Endpoint:** `POST /api/conversion/download` or `GET /api/conversion/download`

**Description:** Download generated files using filename or file path. **Automatically uses custom file names when provided.**

**Authentication:** Required (JWT token)

### Download by Filename

**Request:**

```json
{
  "filename": "my_custom_output_2025-01-15T10-30-45-123Z.zip"
}
```

**Response:**

- **Content-Type:** `application/zip` (or appropriate MIME type)
- **Content-Disposition:** `attachment; filename="my_custom_output_2025-01-15T10-30-45-123Z.zip"`
- **Body:** Binary file content (streamed)

### Download by File Path

**Request:**

```json
{
  "filePath": "/absolute/path/to/output/my_custom_output.bin"
}
```

**Response:**

- **Content-Type:** Appropriate MIME type based on file extension
- **Content-Disposition:** `attachment; filename="my_custom_output.bin"`
- **Body:** Binary file content (streamed)

**Note:** The download API automatically uses the custom file name from the conversion response, so if you provided `customFileName` during conversion, the downloaded file will have that name.

---

## Custom File Name Support

### Overview

All conversion APIs now support an optional `customFileName` parameter. When provided, this name is used for output files instead of the auto-generated names with timestamps.

### Usage Examples

#### Example 1: Single File Conversion with Custom Name

```javascript
// Convert Oracle SQL to IDMC with custom output name
const response = await fetch('/api/conversion/convert-unified', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    inputType: 'single',
    target: 'idmc',
    sourceType: 'oracle',
    sourceCode: 'SELECT * FROM customers;',
    fileName: 'query.sql',
    customFileName: 'customer_mapping', // Custom name
    outputFormat: 'all'
  })
});

// Response will include:
// - customer_mapping.json
// - customer_mapping.docx
// - customer_mapping_original.sql
```

#### Example 2: ZIP Conversion with Custom Name

```javascript
// Convert ZIP file with custom output ZIP name
const response = await fetch('/api/idmc/oracle-to-idmc', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    zipFilePath: '/path/to/oracle-files.zip',
    customFileName: 'production_oracle_idmc' // Custom name
  })
});

// Response will include:
// - zipFilename: "production_oracle_idmc_2025-01-15T10-30-45-123Z.zip"
```

#### Example 3: IDMC Summary to JSON with Custom Name

```javascript
// Convert IDMC summary to JSON with custom name
const response = await fetch('/api/idmc/summary-to-json', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    sourceCode: '## 🧩 IDMC Mapping Summary...',
    fileName: 'mapping.md',
    customFileName: 'customer_etl_mapping', // Custom name
    outputFormat: 'all'
  })
});

// Response will include:
// - customer_etl_mapping.bin
// - customer_etl_mapping.json
```

### File Naming Rules

1. **With Custom Name:**

   - Single file outputs: Uses `customFileName` + appropriate extension
   - ZIP outputs: Uses `customFileName` + timestamp + `.zip`
   - Extensions are automatically added based on output format

2. **Without Custom Name (Standard):**
   - Single file outputs: Uses original filename + conversion type + timestamp + extension
   - ZIP outputs: Uses conversion type + timestamp + `.zip`

### UI Implementation Tips

```javascript
// Example: Form with custom file name input
const formData = {
  inputType: 'single',
  target: 'idmc',
  sourceCode: codeEditor.getValue(),
  fileName: fileInput.files[0].name,
  customFileName: document.getElementById('customFileName').value || undefined, // Optional
  outputFormat: document.getElementById('outputFormat').value
};

// If customFileName is empty, don't send it (use standard naming)
if (!formData.customFileName) {
  delete formData.customFileName;
}
```

---

## Complete Workflow Examples

### Workflow 1: Upload Single File → Convert → Download

```javascript
// Step 1: Upload file
const uploadFormData = new FormData();
uploadFormData.append('file', fileInput.files[0]);
const uploadResponse = await fetch('/api/upload', {
  method: 'POST',
  body: uploadFormData
});
const { file } = await uploadResponse.json();

// Step 2: Convert with custom name
const convertResponse = await fetch('/api/conversion/convert-unified', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    inputType: 'single',
    target: 'idmc',
    sourceType: 'auto',
    sourceCode: await fs.readFile(file.path, 'utf8'),
    fileName: file.originalName,
    customFileName: 'my_conversion',
    outputFormat: 'all'
  })
});

const { outputFiles } = await convertResponse.json();

// Step 3: Download first output file
const downloadResponse = await fetch('/api/conversion/download', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    filePath: outputFiles[0].path
  })
});

const blob = await downloadResponse.blob();
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = outputFiles[0].name;
a.click();
```

### Workflow 2: Direct Conversion with Custom Name

```javascript
// Convert directly without upload step
const response = await fetch('/api/idmc/summary-to-json', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    sourceCode: idmcSummaryText,
    fileName: 'mapping.txt', // Can be .txt, .bin, .md, .json
    customFileName: 'production_mapping',
    outputFormat: 'all' // Creates .bin, .txt, and .doc files
  })
});

const { outputFiles } = await response.json();
// outputFiles[0].name will be "production_mapping.bin"
```

---

## Error Responses

All APIs return consistent error responses:

```json
{
  "error": "Error message",
  "details": "Detailed error description",
  "jobId": "job_id_if_applicable"
}
```

**Common HTTP Status Codes:**

- `200` - Success
- `400` - Bad Request (missing/invalid parameters)
- `401` - Unauthorized (missing/invalid JWT token)
- `404` - Not Found (file not found)
- `500` - Internal Server Error

---

## Summary of Changes

### ✅ New Features

1. **Single File Upload Support**

   - Upload endpoint now accepts individual files (not just ZIP)
   - Supports `.sql`, `.txt`, `.bin`, `.md`, and any other file type

2. **IDMC Summary to JSON Enhancements**

   - Added `.txt` and `.bin` as supported input file types
   - Changed output format from `.bat` to `.bin`
   - Supports multiple output formats (`bin`, `txt`, `doc`, or `all`)

3. **Custom File Name Support**

   - All conversion APIs accept optional `customFileName` parameter
   - Output files use custom names when provided
   - Download API automatically uses custom names

4. **Enhanced Output Formats**
   - IDMC conversions support `json`, `docx`, `sql`, and `all` formats
   - IDMC Summary to JSON supports `bin`, `json`, and `all` formats

### 📝 Migration Notes

- **Backward Compatible:** All existing API calls continue to work
- **New Parameters:** `customFileName` and enhanced `outputFormat` are optional
- **File Extensions:** `.bat` outputs changed to `.bin` for IDMC Summary to JSON
- **Input Types:** Can now use `.txt` and `.bin` files as input for IDMC Summary to JSON

---

## Quick Reference

### All 4 Conversion Types

1. **Oracle → Snowflake:** `POST /api/conversion/convert-unified` with `target: "snowflake"`, `sourceType: "oracle"`
2. **Oracle → IDMC:** `POST /api/conversion/convert-unified` with `target: "idmc"`, `sourceType: "oracle"`
3. **Redshift → Snowflake:** `POST /api/conversion/convert-unified` with `target: "snowflake"`, `sourceType: "redshift"`
4. **Redshift → IDMC:** `POST /api/conversion/convert-unified` with `target: "idmc"`, `sourceType: "redshift"`

### File Upload Options

- **Single File:** `POST /api/upload` with `file` field
- **ZIP File:** `POST /api/upload` with `zipFile` field (legacy) or `file` field

### Custom File Names

- Add `customFileName: "your_custom_name"` to any conversion request
- Output files will use this name instead of auto-generated names
- Extensions are automatically added based on output format

---

**Last Updated:** 2025-01-15
**Version:** 2.0
