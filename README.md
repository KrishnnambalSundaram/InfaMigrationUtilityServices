# Oracle → Snowflake SQL Migration Utility

A working prototype that converts Oracle SQL/PLSQL procedures to Snowflake SQL/JavaScript stored procedures using an LLM-based translation approach.

## 🎯 Objective

Build a working prototype that converts Oracle SQL/PLSQL procedures to Snowflake SQL/JavaScript stored procedures using an LLM-based translation approach, with upload/download through an existing web UI. The prototype demonstrates end-to-end flow and core conversion accuracy.

## 🧩 Features

### ✅ Included

- **Input**: Upload a ZIP file containing .sql or .pls files
- **Analysis**: Display overall size, number of SQL files, number of PL files, number of lines of code, and list PL/SQL files in the UI
- **Processing**:
  - Extract ZIP files
  - For each file: send content to an LLM (GPT-4 Turbo / Claude Sonnet)
  - Prompt instructs LLM to rewrite Oracle PL/SQL into Snowflake SQL/JS syntax
  - Collect responses, store in memory
- **Output**: Re-zip converted files and allow download
- **Basic logging**: Success/failure list per file
- **Optional**: Generate simple run_summary.json (count of files processed, converted, failed)

### ❌ Excluded (for now)

- Deep dependency resolution
- Full metadata mapping or Informatica integration
- Direct Snowflake validation
- Large-scale performance optimization

## ⚙️ Functional Flow

1. **User Uploads ZIP** via existing UI
2. **Backend Steps**:
   - Extract to temp folder
   - Loop through .sql/.pls files
   - For each file:
     - Call LLM endpoint with structured prompt
     - Save LLM output as `<original_name>__sf.sql` or `<original_name>__sf.js`
   - Zip all converted files + summary log
3. **User Downloads ZIP** from the same UI

## 🧠 LLM Prompt

The system uses an optimized prompt that:

- Converts Oracle PL/SQL procedures/functions into Snowflake-compatible SQL or JavaScript stored procedures
- Maintains logical flow and comments
- Does not invent new logic
- Adds `-- TODO:` comments for constructs that need manual review
- Preserves schema object names where possible

## 📦 Expected Output Structure

```
/converted/
  customer_pkg__sf.js
  invoice_load_proc__sf.js
  customer_proc__sf.js
/logs/
  conversion_summary.json
  run_summary.json (if enabled)
```

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- OpenAI API key (set in environment variables)

### Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:

   ```bash
   export OPENAI_API_KEY="your-openai-api-key"
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. Open your browser to `http://localhost:3001`

### Usage

1. **Test Conversion**: Click "Start Test Oracle → Snowflake Conversion" to test with sample Oracle files
2. **Custom Conversion**: Click "Start Custom Oracle → Snowflake Conversion" and provide a path to your Oracle ZIP file
3. **Monitor Progress**: Watch real-time progress updates via WebSocket
4. **Download Results**: Once complete, download the converted Snowflake files

## 🧰 Tech Stack

- **Backend**: Node.js, Express.js
- **LLM Integration**: OpenAI GPT-4 Turbo
- **Real-time Updates**: Socket.IO
- **File Processing**: fs-extra, unzipper, archiver
- **Authentication**: JWT (optional)

## 📊 API Endpoints

- `POST /api/test` - Test Oracle → Snowflake migration with sample files
- `POST /api/convert` - Convert Oracle ZIP file to Snowflake
- `GET /api/progress/:jobId` - Get real-time progress status
- `POST /api/download` - Download converted ZIP file
- `POST /api/upload` - Upload Oracle ZIP file

## ✅ Acceptance Criteria

- ✅ Can upload a ZIP with multiple .sql files
- ✅ Converts each file using LLM and produces a downloadable ZIP
- ✅ Each converted file starts with a comment header `-- Converted by Inflecto Migration Utility`
- ✅ Optional run_summary.json lists file count and statuses
- ✅ Works for small inputs (<10 MB ZIP) in <1 minute

## 🔧 Configuration

The application can be configured via environment variables:

- `OPENAI_API_KEY` - Required for LLM conversion
- `PORT` - Server port (default: 3001)
- `UPLOAD_PATH` - Path for uploaded files (default: ./uploads)
- `CONVERTED_PATH` - Path for converted files (default: ./converted)
- `ZIPS_PATH` - Path for final ZIP files (default: ./zips)

## 📝 Sample Oracle Files

The test conversion includes sample Oracle files:

- `customer_proc.sql` - Oracle stored procedure
- `invoice_function.sql` - Oracle function
- `customer_package.sql` - Oracle package with procedures and functions

## 🚨 Known Limitations

1. **API Key Required**: OpenAI API key must be configured for actual conversion
2. **Manual Review**: Some Oracle constructs may need manual review (marked with `-- TODO:`)
3. **Complex Dependencies**: Deep dependency resolution not implemented
4. **Performance**: Not optimized for large-scale migrations

## 🔄 Migration from .NET to Java System

This project was transformed from a .NET to Java migration utility. Key changes:

- Replaced C# file analysis with Oracle SQL/PLSQL analysis
- Updated LLM prompts for Oracle → Snowflake conversion
- Modified file processing to handle .sql/.pls files instead of .cs files
- Updated UI to reflect Oracle → Snowflake migration purpose
- Removed Java/Quarkus specific services and components

## 📞 Support

For issues or questions, please check the logs in the browser console or server output for detailed error messages.
