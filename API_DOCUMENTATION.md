# Infa Migration Utility Services - Complete API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Base URL](#base-url)
4. [ZIP Conversion Endpoints](#zip-conversion-endpoints)
   - [Oracle/Redshift SQL to IDMC (ZIP)](#1-oracleredshift-sql-to-idmc-zip)
   - [Oracle SQL to Snowflake (ZIP)](#2-oracle-sql-to-snowflake-zip)
   - [Batch Script to IDMC Summary (ZIP)](#3-batch-script-to-idmc-summary-zip)
   - [Batch Script to Human Language (ZIP)](#4-batch-script-to-human-language-zip)
5. [Download API](#download-api)
6. [Progress API](#progress-api)
7. [Single File Conversion Endpoints](#single-file-conversion-endpoints)
8. [Response Structure](#response-structure)
9. [Output Formats](#output-formats)
10. [Error Handling](#error-handling)
11. [Code Examples](#code-examples)

---

## Overview

This service provides conversion utilities for migrating Oracle PL/SQL, Redshift SQL, and batch scripts to various target formats:

- **Oracle/Redshift SQL → Snowflake SQL/JavaScript**
- **Oracle/Redshift SQL → IDMC Mapping Summaries**
- **Batch Scripts → IDMC Summaries**
- **Batch Scripts → Human-Readable Summaries**

All ZIP conversion endpoints return a **standardized response structure** with mandatory fields for easy integration.

---

## Authentication

Most endpoints require JWT authentication. Include the token in the request header:

```
Authorization: Bearer <your-jwt-token>
```

**Exception:** Test endpoints (`/api/conversion/test`) do not require authentication.

---

## Base URL

- **Local Development:** `http://localhost:3001`
- **Production:** Configure based on your deployment

---

## ZIP Conversion Endpoints

All ZIP conversion endpoints follow the same response structure and return:

- `zipFilename` - Name of the generated zip file
- `zipFilePath` - Absolute path to the zip file
- `results` - Array of conversion results with original and converted content
- `processing` - Processing statistics

### 1. Oracle/Redshift SQL to IDMC (ZIP)

**Endpoint:** `POST /api/conversion/convert-unified`

**Description:** Converts a ZIP file containing Oracle or Redshift SQL files into IDMC mapping summaries. Supports multiple output formats (docx, json, sql).

**Request:**

```json
{
  "inputType": "zip",
  "target": "idmc",
  "sourceType": "oracle",
  "zipFilePath": "/absolute/path/to/oracle-files.zip",
  "outputFormat": "docx"
}
```

**Request Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputType` | string | Yes | Must be `"zip"` |
| `target` | string | Yes | Must be `"idmc"` |
| `sourceType` | string | No | `"oracle"`, `"redshift"`, or `"auto"` (default: `"auto"`) |
| `zipFilePath` | string | Yes | Absolute path to the ZIP file containing SQL files |
| `outputFormat` | string | No | `"docx"`, `"json"`, `"sql"`, or `"all"` (default: `"json"`) |

**Response:**

```json
{
  "success": true,
  "target": "idmc",
  "jobId": "unified_idmc_oracle-files",
  "zipFilename": "idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip",
  "zipFilePath": "/absolute/path/to/zips/idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip",
  "results": [
    {
      "fileName": "01_customer_procedures.sql",
      "originalContent": "CREATE OR REPLACE PROCEDURE get_customer...",
      "convertedContent": "## 🧩 IDMC Mapping Summary\n\n### 1. Objective\n...",
      "success": true
    },
    {
      "fileName": "02_order_management.sql",
      "originalContent": "CREATE TABLE orders...",
      "convertedContent": "## 🧩 IDMC Mapping Summary\n\n### 1. Objective\n...",
      "success": true
    }
  ],
  "processing": {
    "totalFiles": 15,
    "processedFiles": 15,
    "failedFiles": 0,
    "successRate": 100
  }
}
```

**Output Formats:**

- `"docx"` - Microsoft Word documents (`.docx` extension)
- `"json"` - JSON files containing the IDMC summary content (`.json` extension)
- `"sql"` - Original SQL files (`.sql` extension)
- `"all"` - All formats combined

**Important Notes:**

- The system **never outputs .md files** - always uses the requested extension
- When `outputFormat` is `"docx"`, only `.docx` files are included in the ZIP
- When `outputFormat` is `"json"`, `.json` files are created (not markdown)
- Original file content and converted content are included in the response for each file

---

### 2. Oracle SQL to Snowflake (ZIP)

**Endpoint:** `POST /api/conversion/convert-unified`

**Description:** Converts a ZIP file containing Oracle PL/SQL files into Snowflake-compatible SQL/JavaScript. Supports multiple output formats.

**Request:**

```json
{
  "inputType": "zip",
  "target": "snowflake",
  "sourceType": "oracle",
  "zipFilePath": "/absolute/path/to/oracle-files.zip",
  "outputFormat": "sql"
}
```

**Request Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputType` | string | Yes | Must be `"zip"` |
| `target` | string | Yes | Must be `"snowflake"` |
| `sourceType` | string | No | `"oracle"` (default) |
| `zipFilePath` | string | Yes | Absolute path to the ZIP file containing Oracle SQL files |
| `outputFormat` | string | No | `"sql"`, `"json"`, `"docx"`, or `"all"` (default: `"sql"`) |

**Response:**

```json
{
  "success": true,
  "target": "snowflake",
  "jobId": "unified_snowflake_oracle-files",
  "zipFilename": "converted_oracle_snowflake_sql_2025-01-15T10-30-45-123Z.zip",
  "zipFilePath": "/absolute/path/to/zips/converted_oracle_snowflake_sql_2025-01-15T10-30-45-123Z.zip",
  "results": [
    {
      "fileName": "01_customer_procedures.sql",
      "originalContent": "CREATE OR REPLACE PROCEDURE get_customer_info(\n    p_customer_id IN NUMBER...",
      "convertedContent": "CREATE OR REPLACE PROCEDURE get_customer_info(\n    p_customer_id NUMBER\n)\nRETURNS VARIANT\nLANGUAGE JAVASCRIPT\nAS\n$$\n    var sql_command = `SELECT customer_name...`;\n    ...\n$$;",
      "success": true
    },
    {
      "fileName": "02_order_management.sql",
      "originalContent": "CREATE TABLE orders...",
      "convertedContent": "CREATE TABLE orders...",
      "success": true
    }
  ],
  "processing": {
    "totalFiles": 15,
    "processedFiles": 15,
    "failedFiles": 0,
    "successRate": 100
  }
}
```

**Output Formats:**

- `"sql"` - Snowflake SQL/JavaScript files (`.sql` extension) - **Default**
- `"json"` - JSON files with conversion metadata (`.json` extension)
- `"docx"` - Microsoft Word documents (`.docx` extension)
- `"all"` - All formats combined

**Alternative Endpoint:** `POST /api/conversion/convert`

This endpoint provides the same functionality with a slightly different response structure (includes `analysis` field):

```json
{
  "success": true,
  "message": "Oracle → Snowflake conversion completed successfully",
  "source": "/absolute/path/to/oracle-files.zip",
  "jobId": "convert_oracle-files",
  "zipFilename": "converted_oracle_snowflake_2025-01-15T10-30-45-123Z.zip",
  "zipFilePath": "/absolute/path/to/zips/converted_oracle_snowflake_2025-01-15T10-30-45-123Z.zip",
  "results": [...],
  "processing": {...},
  "analysis": {
    "totalFiles": 15,
    "sqlFiles": 10,
    "plsqlFiles": 5,
    "linesOfCode": 5000,
    "fileSize": "2.5 MB",
    "procedures": 8,
    "functions": 3,
    "packages": 2,
    "tables": 5,
    "views": 4
  }
}
```

---

### 3. Batch Script to IDMC Summary (ZIP)

**Endpoint:** `POST /api/idmc/batch-idmc-summary`

**Description:** Converts a ZIP file containing batch scripts (`.bat`, `.sh`, `.ksh`, `.py`) into IDMC mapping summaries. Each script is analyzed and converted to structured IDMC documentation.

**Request:**

```json
{
  "inputType": "zip",
  "zipFilePath": "/absolute/path/to/batch-scripts.zip",
  "outputFormat": "doc"
}
```

**Request Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputType` | string | Yes | Must be `"zip"` |
| `zipFilePath` | string | Yes | Absolute path to the ZIP file containing batch scripts |
| `outputFormat` | string | No | `"doc"` or `"txt"` (default: `"doc"`) |

**Response:**

```json
{
  "success": true,
  "message": "Batch script processing completed successfully",
  "source": "/absolute/path/to/batch-scripts.zip",
  "jobId": "batch_scripts_batch-scripts",
  "zipFilename": "batch_scripts_idmc_summaries_doc_2025-01-15T10-30-45-123Z.zip",
  "zipFilePath": "/absolute/path/to/zips/batch_scripts_idmc_summaries_doc_2025-01-15T10-30-45-123Z.zip",
  "results": [
    {
      "fileName": "LoadTMSnapshot.bat",
      "originalContent": "@echo off\nsqlldr user/pass@db control=Table_Management_Snapshots.ctl...",
      "convertedContent": "## 🧩 IDMC Mapping Summary\n\n### 1. Objective\nThis batch script automates...",
      "success": true
    },
    {
      "fileName": "run_oracle.sh",
      "originalContent": "#!/bin/bash\nsqlplus user/pass@db @script.sql...",
      "convertedContent": "## 🧩 IDMC Mapping Summary\n\n### 1. Objective\nThis shell script executes...",
      "success": true
    }
  ],
  "processing": {
    "totalFiles": 4,
    "processedFiles": 4,
    "failedFiles": 0,
    "successRate": 100
  }
}
```

**Output Formats:**

- `"doc"` - Microsoft Word documents (`.docx` extension) - **Default**
- `"txt"` - Plain text files (`.txt` extension)

**Supported File Types:**

- `.bat` - Windows batch scripts
- `.sh` - Shell scripts
- `.ksh` - Korn shell scripts
- `.py` - Python scripts

---

### 4. Batch Script to Human Language (ZIP)

**Endpoint:** `POST /api/idmc/batch-human-language`

**Description:** Converts a ZIP file containing batch scripts into human-readable summaries in a conversational format. Useful for documentation and understanding script functionality.

**Request:**

```json
{
  "inputType": "zip",
  "zipFilePath": "/absolute/path/to/batch-scripts.zip",
  "outputFormat": "doc"
}
```

**Request Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputType` | string | Yes | Must be `"zip"` |
| `zipFilePath` | string | Yes | Absolute path to the ZIP file containing batch scripts |
| `outputFormat` | string | No | `"doc"` or `"txt"` (default: `"doc"`) |

**Response:**

```json
{
  "success": true,
  "message": "Human-readable summary generation completed successfully",
  "source": "/absolute/path/to/batch-scripts.zip",
  "jobId": "human_readable_batch-scripts",
  "zipFilename": "human_readable_summaries_doc_2025-01-15T10-30-45-123Z.zip",
  "zipFilePath": "/absolute/path/to/zips/human_readable_summaries_doc_2025-01-15T10-30-45-123Z.zip",
  "results": [
    {
      "fileName": "LoadTMSnapshot.bat",
      "originalContent": "@echo off\nsqlldr user/pass@db control=Table_Management_Snapshots.ctl...",
      "convertedContent": "## 🧩 LoadTMSnapshot.bat Summary\n\n### 🎯 Objective\nThis script automates the process of loading data into Oracle database tables using SQL*Loader...",
      "success": true
    },
    {
      "fileName": "triggerWorkflow.sh",
      "originalContent": "#!/bin/bash\nfolderName=$1\nworkflowName=$2...",
      "convertedContent": "## 🧩 triggerWorkflow.sh Summary\n\n### 🎯 Objective\nThis Bash script automates the process of triggering an Informatica IICS workflow...",
      "success": true
    }
  ],
  "processing": {
    "totalFiles": 4,
    "processedFiles": 4,
    "failedFiles": 0,
    "successRate": 100
  }
}
```

**Output Formats:**

- `"doc"` - Microsoft Word documents (`.docx` extension) - **Default**
- `"txt"` - Plain text files (`.txt` extension)

---

## Download API

**Endpoint:** `POST /api/conversion/download`

**Description:** Downloads a generated ZIP file or any file from the allowed output directories. Supports downloading by filename or absolute file path.

**Authentication:** Required (JWT token)

**Request Options:**

### Option 1: Download by Filename

**Request:**

```json
{
  "filename": "idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip"
}
```

**Request Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filename` | string | Yes | Name of the file in the `zips` directory |

**Response:**

- **Content-Type:** `application/zip` (or appropriate MIME type)
- **Content-Disposition:** `attachment; filename="<filename>"`
- **Body:** Binary file content (streamed)

### Option 2: Download by Absolute File Path

**Request:**

```json
{
  "filePath": "/absolute/path/to/zips/idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip"
}
```

**Request Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | Yes | Absolute path to the file (must be under allowed output directories) |

**Allowed Output Directories:**

- `ZIPS_PATH` - Default: `./zips`
- `OUTPUT_PATH` - Default: `./output`
- `IDMC_PATH` - Default: `./idmc_output`

**Response:**

- **Content-Type:** Appropriate MIME type based on file extension
- **Content-Disposition:** `attachment; filename="<filename>"`
- **Body:** Binary file content (streamed)

**Error Responses:**

```json
{
  "error": "Zip file not found",
  "filename": "invalid_filename.zip",
  "message": "The requested file does not exist or has been removed"
}
```

```json
{
  "error": "Invalid filePath",
  "message": "Requested path is not in an allowed output directory"
}
```

---

## Progress API

**Endpoint:** `GET /api/conversion/progress/:jobId`

**Description:** Retrieves the current status and progress of a conversion job. Useful for checking job completion status and retrieving results.

**Authentication:** Required (JWT token)

**Request:**

```
GET /api/conversion/progress/unified_idmc_oracle-files
```

**URL Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | Yes | Job ID returned from the conversion endpoint |

**Response:**

```json
{
  "success": true,
  "job": {
    "jobId": "unified_idmc_oracle-files",
    "status": "completed",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "steps": [
      {
        "stepId": 0,
        "name": "Extracting zip file...",
        "progress": 100,
        "status": "completed"
      },
      {
        "stepId": 1,
        "name": "Converting files...",
        "progress": 100,
        "status": "completed"
      },
      {
        "stepId": 2,
        "name": "Creating final package...",
        "progress": 100,
        "status": "completed"
      }
    ],
    "result": {
      "zipFilename": "idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip",
      "zipFilePath": "/absolute/path/to/zips/idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip",
      "results": [...],
      "processing": {...}
    },
    "error": null
  }
}
```

**Job Status Values:**

- `"pending"` - Job is queued but not started
- `"in_progress"` - Job is currently running
- `"completed"` - Job completed successfully
- `"failed"` - Job failed with an error

**Error Response:**

```json
{
  "error": "Job not found",
  "jobId": "invalid_job_id"
}
```

---

## Single File Conversion Endpoints

For single file conversions (not ZIP), the endpoints return different response structures. See the main README.md for details.

---

## Response Structure

All ZIP conversion endpoints return a **standardized response structure**:

```typescript
{
  success: boolean;                    // Always true for successful requests
  target?: string;                     // Conversion target (snowflake, idmc)
  jobId: string;                       // Unique job identifier
  zipFilename: string;                 // Name of the generated ZIP file
  zipFilePath: string;                 // Absolute path to the ZIP file
  results: Array<{                     // Array of conversion results
    fileName: string;                  // Original file name
    originalContent: string;            // Original file content (mandatory)
    convertedContent: string;           // Converted file content (mandatory)
    success: boolean;                   // Conversion success status
  }>;
  processing: {                        // Processing statistics
    totalFiles: number;                // Total number of files processed
    processedFiles: number;             // Number of successfully processed files
    failedFiles: number;                // Number of failed files
    successRate: number;                // Success rate percentage (0-100)
  };
  message?: string;                    // Optional success message
  source?: string;                     // Original source file path
}
```

**Mandatory Fields:**

- `zipFilename` - Always present
- `zipFilePath` - Always present
- `results` - Always present (may be empty array)
- `results[].originalContent` - Always present (may be empty string)
- `results[].convertedContent` - Always present (may be empty string)

---

## Output Formats

### Oracle/Redshift to IDMC

- **docx** - Microsoft Word documents (`.docx`)
- **json** - JSON files (`.json`)
- **sql** - Original SQL files (`.sql`)
- **all** - All formats combined

### Oracle to Snowflake

- **sql** - Snowflake SQL/JavaScript files (`.sql`) - Default
- **json** - JSON files with metadata (`.json`)
- **docx** - Microsoft Word documents (`.docx`)
- **all** - All formats combined

### Batch Scripts

- **doc** - Microsoft Word documents (`.docx`) - Default
- **txt** - Plain text files (`.txt`)

**Important:** The system **never outputs .md (markdown) files**. All conversions use the requested file extension.

---

## Error Handling

All endpoints return appropriate HTTP status codes:

- **200 OK** - Successful request
- **400 Bad Request** - Invalid request parameters
- **401 Unauthorized** - Missing or invalid authentication token
- **404 Not Found** - File or job not found
- **500 Internal Server Error** - Server error during processing

**Error Response Format:**

```json
{
  "error": "Error message",
  "details": "Detailed error message",
  "jobId": "job_id_if_applicable"
}
```

**Common Error Scenarios:**

1. **Missing Required Parameter:**

```json
{
  "error": "zipFilePath is required",
  "example": { "zipFilePath": "/path/to/your/files.zip" }
}
```

2. **File Not Found:**

```json
{
  "error": "Zip file not found",
  "providedPath": "/invalid/path/to/file.zip"
}
```

3. **Invalid Path:**

```json
{
  "error": "Zip path outside allowed roots",
  "message": "Path must be under allowed output directories"
}
```

4. **Processing Failed:**

```json
{
  "error": "Conversion failed",
  "details": "Error message here",
  "jobId": "unified_idmc_oracle-files"
}
```

---

## Code Examples

### Example 1: Convert Oracle ZIP to IDMC (DOCX)

**cURL:**

```bash
curl -X POST http://localhost:3001/api/conversion/convert-unified \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "inputType": "zip",
    "target": "idmc",
    "sourceType": "oracle",
    "zipFilePath": "/absolute/path/to/oracle-files.zip",
    "outputFormat": "docx"
  }'
```

**JavaScript (Fetch):**

```javascript
const response = await fetch('http://localhost:3001/api/conversion/convert-unified', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer YOUR_JWT_TOKEN'
  },
  body: JSON.stringify({
    inputType: 'zip',
    target: 'idmc',
    sourceType: 'oracle',
    zipFilePath: '/absolute/path/to/oracle-files.zip',
    outputFormat: 'docx'
  })
});

const result = await response.json();
console.log('Zip filename:', result.zipFilename);
console.log('Zip path:', result.zipFilePath);
console.log('Files processed:', result.processing.processedFiles);
```

### Example 2: Convert Batch Scripts to IDMC Summary

**Python:**

```python
import requests

url = 'http://localhost:3001/api/idmc/batch-idmc-summary'
headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
}
data = {
    'inputType': 'zip',
    'zipFilePath': '/absolute/path/to/batch-scripts.zip',
    'outputFormat': 'doc'
}

response = requests.post(url, json=data, headers=headers)
result = response.json()

print(f"Zip filename: {result['zipFilename']}")
print(f"Total files: {result['processing']['totalFiles']}")
print(f"Success rate: {result['processing']['successRate']}%")
```

### Example 3: Download Generated ZIP File

**cURL:**

```bash
curl -X POST http://localhost:3001/api/conversion/download \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filename": "idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip"
  }' \
  --output downloaded_file.zip
```

**JavaScript (Fetch with Stream):**

```javascript
const response = await fetch('http://localhost:3001/api/conversion/download', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer YOUR_JWT_TOKEN'
  },
  body: JSON.stringify({
    filename: 'idmc_summaries_docx_2025-01-15T10-30-45-123Z.zip'
  })
});

const blob = await response.blob();
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'idmc_summaries.zip';
a.click();
```

### Example 4: Check Job Progress

**JavaScript:**

```javascript
async function checkProgress(jobId) {
  const response = await fetch(`http://localhost:3001/api/conversion/progress/${jobId}`, {
    headers: {
      Authorization: 'Bearer YOUR_JWT_TOKEN'
    }
  });

  const result = await response.json();

  if (result.job.status === 'completed') {
    console.log('Job completed!');
    console.log('Zip file:', result.job.result.zipFilename);
  } else if (result.job.status === 'failed') {
    console.error('Job failed:', result.job.error);
  } else {
    console.log('Job in progress:', result.job.status);
    // Poll again after a delay
    setTimeout(() => checkProgress(jobId), 2000);
  }
}

// Usage
checkProgress('unified_idmc_oracle-files');
```

### Example 5: Complete Workflow - Convert and Download

**Node.js:**

```javascript
const axios = require('axios');
const fs = require('fs');

async function convertAndDownload(zipFilePath, outputFormat = 'docx') {
  const baseURL = 'http://localhost:3001';
  const token = 'YOUR_JWT_TOKEN';

  // Step 1: Start conversion
  console.log('Starting conversion...');
  const convertResponse = await axios.post(
    `${baseURL}/api/conversion/convert-unified`,
    {
      inputType: 'zip',
      target: 'idmc',
      sourceType: 'oracle',
      zipFilePath: zipFilePath,
      outputFormat: outputFormat
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const { jobId, zipFilename } = convertResponse.data;
  console.log(`Job started: ${jobId}`);
  console.log(`Zip filename: ${zipFilename}`);

  // Step 2: Wait for completion (poll progress)
  let completed = false;
  while (!completed) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const progressResponse = await axios.get(`${baseURL}/api/conversion/progress/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const { status } = progressResponse.data.job;
    if (status === 'completed') {
      completed = true;
      console.log('Conversion completed!');
    } else if (status === 'failed') {
      throw new Error(`Conversion failed: ${progressResponse.data.job.error}`);
    } else {
      console.log(`Progress: ${status}...`);
    }
  }

  // Step 3: Download the file
  console.log('Downloading file...');
  const downloadResponse = await axios.post(
    `${baseURL}/api/conversion/download`,
    { filename: zipFilename },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream'
    }
  );

  // Step 4: Save to local file
  const outputPath = `./downloads/${zipFilename}`;
  const writer = fs.createWriteStream(outputPath);
  downloadResponse.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      console.log(`File saved to: ${outputPath}`);
      resolve(outputPath);
    });
    writer.on('error', reject);
  });
}

// Usage
convertAndDownload('/absolute/path/to/oracle-files.zip', 'docx')
  .then((path) => console.log('Done!', path))
  .catch((err) => console.error('Error:', err));
```

---

## Best Practices

1. **Always use absolute paths** for `zipFilePath` parameter
2. **Store the `jobId`** from conversion responses to track progress
3. **Check job status** before attempting to download files
4. **Handle errors gracefully** - check HTTP status codes and error messages
5. **Use appropriate output formats** - `docx` for documents, `json` for programmatic access
6. **Monitor progress** for large ZIP files using the Progress API
7. **Clean up downloaded files** after processing to save disk space

---

## Rate Limiting

The API implements rate limiting to prevent abuse:

- **Conversion endpoints:** Limited requests per minute
- **Download endpoints:** Limited requests per minute

If rate limited, you'll receive a `429 Too Many Requests` response.

---

## WebSocket Support

For real-time progress updates, the API supports WebSocket connections. See the main README.md for WebSocket documentation.

---

## Support

For issues, questions, or feature requests, please contact the development team or refer to the project repository.

---

**Last Updated:** January 2025
**API Version:** 1.0
