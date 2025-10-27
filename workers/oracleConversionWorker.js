const { parentPort, workerData } = require('worker_threads');
const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');

class OracleConversionWorker {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.openai = null;
    
    if (this.apiKey) {
      this.openai = new OpenAI({
        apiKey: this.apiKey
      });
    }
  }

  async convertOracleToSnowflake(oracleCode, fileName, fileType = 'sql') {
    try {
      if (!this.apiKey || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      const systemPrompt = `You are a database migration specialist. Convert Oracle PL/SQL procedures, functions, and SQL statements into Snowflake-compatible SQL or JavaScript stored procedures.

CRITICAL REQUIREMENTS:
1. Maintain logical flow and preserve all business logic
2. Keep schema object names consistent where possible
3. Convert Oracle-specific syntax to Snowflake equivalents
4. For complex PL/SQL procedures, convert to Snowflake JavaScript stored procedures
5. For simple SQL statements, convert to Snowflake SQL syntax
6. Add comments starting with -- TODO: for constructs that need manual review
7. Preserve all comments from the original code
8. Output ONLY the converted code - no explanations or additional text

SNOWFLAKE CONVERSION GUIDELINES:
- Oracle VARCHAR2 → Snowflake VARCHAR
- Oracle NUMBER → Snowflake NUMBER
- Oracle DATE → Snowflake TIMESTAMP_NTZ
- Oracle CURSOR → Snowflake RESULT_SET
- Oracle EXCEPTION handling → Snowflake TRY/CATCH in JavaScript
- Oracle %TYPE → Snowflake explicit data types
- Oracle packages → Snowflake JavaScript stored procedures
- Oracle sequences → Snowflake sequences (with adjustments)
- Oracle triggers → Snowflake tasks/streams (with manual review needed)
- Oracle ROWNUM → Snowflake ROW_NUMBER() window function
- Oracle SYSDATE → Snowflake CURRENT_TIMESTAMP()
- Oracle DUAL table → Snowflake VALUES clause
- Oracle DECODE → Snowflake CASE statement
- Oracle NVL → Snowflake COALESCE
- Oracle SUBSTR → Snowflake SUBSTRING
- Oracle TO_CHAR → Snowflake TO_VARCHAR
- Oracle TO_DATE → Snowflake TO_DATE
- Oracle TRUNC → Snowflake DATE_TRUNC
- Oracle ROUND → Snowflake ROUND
- Oracle MOD → Snowflake MOD
- Oracle LENGTH → Snowflake LENGTH
- Oracle UPPER/LOWER → Snowflake UPPER/LOWER
- Oracle TRIM → Snowflake TRIM
- Oracle CONCAT → Snowflake CONCAT or ||
- Oracle INSTR → Snowflake POSITION
- Oracle REPLACE → Snowflake REPLACE
- Oracle LPAD/RPAD → Snowflake LPAD/RPAD
- Oracle LTRIM/RTRIM → Snowflake LTRIM/RTRIM

JAVASCRIPT STORED PROCEDURE CONVERSION:
- Use Snowflake JavaScript stored procedure syntax
- Convert Oracle procedures to JavaScript functions
- Use Snowflake's JavaScript API for database operations
- Handle parameters and return values appropriately
- Use proper error handling with try/catch blocks

SQL CONVERSION:
- Convert Oracle SQL to Snowflake SQL syntax
- Adjust data types and functions as needed
- Maintain query logic and structure
- Add appropriate Snowflake-specific optimizations

Original File: ${fileName}
File Type: ${fileType}

Oracle Code:
${oracleCode}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a database migration specialist. Convert Oracle PL/SQL to Snowflake SQL/JavaScript. Output ONLY the converted code.'
          },
          {
            role: 'user',
            content: systemPrompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      });

      const convertedCode = response.choices[0].message.content;
      return this.cleanConvertedCode(convertedCode, fileName, fileType);
    } catch (error) {
      console.error('Error converting Oracle to Snowflake:', error);
      throw error;
    }
  }

  cleanConvertedCode(code, fileName = '', fileType = 'sql') {
    let cleaned = code;
    
    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/```sql\n?/g, '').replace(/```javascript\n?/g, '').replace(/```js\n?/g, '').replace(/```\n?/g, '');
    
    // Remove common explanatory text patterns
    cleaned = cleaned.replace(/^Here is the converted.*?\n/gm, '');
    cleaned = cleaned.replace(/^This code.*?\n/gm, '');
    cleaned = cleaned.replace(/^The converted.*?\n/gm, '');
    cleaned = cleaned.replace(/^Please note.*?\n/gm, '');
    cleaned = cleaned.replace(/^Note:.*?\n/gm, '');
    cleaned = cleaned.replace(/^Important:.*?\n/gm, '');
    
    // Add conversion header
    const header = `-- Converted by Inflecto Migration Utility
-- Original file: ${fileName}
-- Conversion date: ${new Date().toISOString()}
-- Target: Snowflake SQL/JavaScript

`;
    
    cleaned = header + cleaned;
    
    // Remove multiple consecutive empty lines
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  async getSnowflakeFileName(oraclePath, oracleCode = '') {
    const ext = path.extname(oraclePath);
    const baseName = path.basename(oraclePath, ext);
    const dirName = path.dirname(oraclePath).toLowerCase();
    
    // Determine if it should be SQL or JavaScript based on content
    const isComplexPLSQL = oracleCode.toLowerCase().includes('procedure') || 
                          oracleCode.toLowerCase().includes('function') ||
                          oracleCode.toLowerCase().includes('package') ||
                          oracleCode.toLowerCase().includes('declare') ||
                          oracleCode.toLowerCase().includes('begin') ||
                          oracleCode.toLowerCase().includes('exception');
    
    const fileExtension = isComplexPLSQL ? 'js' : 'sql';
    const snowflakeFileName = `${baseName}__sf.${fileExtension}`;
    
    return {
      snowflakeFileName: snowflakeFileName,
      fileExtension: fileExtension,
      isComplexPLSQL: isComplexPLSQL
    };
  }

  async processFile(fileData) {
    const { filePath, extractedPath } = fileData;
    
    try {
      console.log(`Worker processing Oracle file: ${path.basename(filePath)}`);
      
      const oracleCode = await fs.readFile(filePath, 'utf8');
      const relativePath = path.relative(extractedPath, filePath);
      const { snowflakeFileName, fileExtension, isComplexPLSQL } = await this.getSnowflakeFileName(relativePath, oracleCode);
      
      // Add timeout to prevent hanging
      const conversionPromise = this.convertOracleToSnowflake(oracleCode, snowflakeFileName, fileExtension);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI conversion timeout after 2 minutes')), 120000)
      );
      
      const snowflakeCode = await Promise.race([conversionPromise, timeoutPromise]);
      
      return {
        success: true,
        original: relativePath,
        converted: snowflakeFileName,
        fileExtension: fileExtension,
        isComplexPLSQL: isComplexPLSQL,
        snowflakeCode: snowflakeCode,
        filePath: filePath
      };
    } catch (error) {
      console.error(`Worker error processing ${filePath}:`, error);
      return {
        success: false,
        error: error.message,
        filePath: filePath
      };
    }
  }
}

// Worker thread entry point
if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

const worker = new OracleConversionWorker();

parentPort.on('message', async (message) => {
  try {
    const result = await worker.processFile(message);
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
});
