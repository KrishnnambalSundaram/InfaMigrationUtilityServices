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
6. Output ONLY clean, executable Snowflake code - NO comments, headers, or explanations
7. Do NOT add any conversion headers, timestamps, or migration comments
8. Do NOT add TODO comments or explanatory text
9. Output ONLY the converted code - no markdown formatting or additional text
10. Ensure the code is syntactically correct and ready to run in Snowflake
11. Use proper Snowflake JavaScript syntax and API calls
12. Handle all variables and data types correctly for Snowflake

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
- Oracle TO_DATE → Snowflake TO_TIMESTAMP

JAVASCRIPT STORED PROCEDURE CONVERSION:
- Use CREATE OR REPLACE PROCEDURE syntax
- Convert PL/SQL blocks to JavaScript functions
- Use Snowflake JavaScript API for database operations (stmt.execute(), stmt.getQueryId(), etc.)
- Handle exceptions with try/catch blocks
- Use proper parameter binding (:1, :2, etc.)
- Use correct Snowflake JavaScript variable declarations (var, let, const)
- Ensure all SQL statements are properly formatted for Snowflake

OUTPUT FORMAT:
- Output ONLY clean, executable Snowflake code
- NO comments, headers, timestamps, or explanations
- NO markdown formatting
- Start directly with CREATE OR REPLACE statements
- Ensure code is syntactically correct and ready to execute
- Use proper Snowflake JavaScript syntax throughout`;

      const userPrompt = `Convert the following Oracle code to Snowflake. Keep schema object names consistent.

Original File: ${fileName}
File Type: ${fileType}

Oracle Code:
${oracleCode}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      });

      const snowflakeCode = response.choices[0].message.content;
      
      // Clean up the response - no headers, just clean working code
      const cleanedCode = this.cleanSnowflakeCode(snowflakeCode, fileName);
      
      return cleanedCode;
    } catch (error) {
      console.error('Error converting Oracle to Snowflake:', error);
      throw error;
    }
  }

  cleanSnowflakeCode(snowflakeCode, fileName) {
    let cleaned = snowflakeCode;
    
    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/```sql\n?/g, '').replace(/```javascript\n?/g, '').replace(/```\n?/g, '');
    
    // Remove common explanatory text patterns
    cleaned = cleaned.replace(/^Here is the converted Snowflake code:\s*\n/gm, '');
    cleaned = cleaned.replace(/^This Snowflake code:\s*\n/gm, '');
    cleaned = cleaned.replace(/^The converted code:\s*\n/gm, '');
    cleaned = cleaned.replace(/^Here's the conversion:\s*\n/gm, '');
    cleaned = cleaned.replace(/^Converted to Snowflake:\s*\n/gm, '');
    cleaned = cleaned.replace(/^Here's the Snowflake equivalent:\s*\n/gm, '');
    cleaned = cleaned.replace(/^The Snowflake version:\s*\n/gm, '');
    cleaned = cleaned.replace(/^Here's how to convert.*?\n/gm, '');
    cleaned = cleaned.replace(/^The equivalent.*?\n/gm, '');
    
    // Remove conversion headers and comments
    cleaned = cleaned.replace(/^-- Converted by.*?\n/gm, '');
    cleaned = cleaned.replace(/^-- Original File:.*?\n/gm, '');
    cleaned = cleaned.replace(/^-- Conversion Date:.*?\n/gm, '');
    cleaned = cleaned.replace(/^-- Target Platform:.*?\n/gm, '');
    cleaned = cleaned.replace(/^-- Migration Utility.*?\n/gm, '');
    cleaned = cleaned.replace(/^-- Conversion of.*?\n/gm, '');
    cleaned = cleaned.replace(/^-- Converted from.*?\n/gm, '');
    cleaned = cleaned.replace(/^-- Conversion Timestamp:.*?\n/gm, '');
    
    // Remove lines that start with explanatory text or comments
    cleaned = cleaned.replace(/^.*?(?:converted|snowflake|oracle|migration|equivalent|replacement|TODO|NOTE|WARNING|conversion|migrated).*?\n/gm, '');
    
    // Remove empty comment lines and standalone comments
    cleaned = cleaned.replace(/^--\s*$/gm, '');
    cleaned = cleaned.replace(/^--\s*[A-Za-z].*?\n/gm, '');
    
    // Remove any lines that don't start with CREATE, ALTER, DROP, or other SQL keywords
    // But keep the actual SQL content
    const lines = cleaned.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      // Keep empty lines, SQL statements, and JavaScript code
      return trimmed === '' || 
             trimmed.startsWith('CREATE') || 
             trimmed.startsWith('ALTER') || 
             trimmed.startsWith('DROP') || 
             trimmed.startsWith('INSERT') || 
             trimmed.startsWith('UPDATE') || 
             trimmed.startsWith('DELETE') || 
             trimmed.startsWith('SELECT') || 
             trimmed.startsWith('WITH') ||
             trimmed.startsWith('$$') ||
             trimmed.startsWith('RETURNS') ||
             trimmed.startsWith('LANGUAGE') ||
             trimmed.startsWith('AS') ||
             trimmed.startsWith('var ') ||
             trimmed.startsWith('let ') ||
             trimmed.startsWith('const ') ||
             trimmed.startsWith('try {') ||
             trimmed.startsWith('catch') ||
             trimmed.startsWith('} catch') ||
             trimmed.startsWith('}') ||
             trimmed.startsWith('{') ||
             trimmed.startsWith('    ') ||
             trimmed.startsWith('\t') ||
             trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*\s*[=:]/) || // Variable assignments
             trimmed.match(/^[A-Za-z_][A-Za-z0-9_]*\s*\(/); // Function calls
    });
    
    cleaned = filteredLines.join('\n');
    
    // Remove multiple consecutive empty lines
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  async analyzeFileType(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const upperContent = content.toUpperCase();
      
      // Check for PL/SQL specific constructs that need JavaScript conversion
      if (upperContent.includes('CREATE OR REPLACE PROCEDURE') ||
          upperContent.includes('CREATE OR REPLACE FUNCTION') ||
          upperContent.includes('CREATE OR REPLACE PACKAGE') ||
          upperContent.includes('DECLARE') ||
          upperContent.includes('BEGIN') ||
          upperContent.includes('END;') ||
          upperContent.includes('EXCEPTION') ||
          upperContent.includes('CURSOR') ||
          upperContent.includes('LOOP') ||
          upperContent.includes('IF') && upperContent.includes('THEN') ||
          upperContent.includes('WHILE') ||
          upperContent.includes('FOR')) {
        return 'plsql';
      }
      
      // Check for SQL statements (DDL, DML, DQL)
      if (upperContent.includes('SELECT') ||
          upperContent.includes('INSERT') ||
          upperContent.includes('UPDATE') ||
          upperContent.includes('DELETE') ||
          upperContent.includes('CREATE TABLE') ||
          upperContent.includes('CREATE VIEW') ||
          upperContent.includes('CREATE INDEX') ||
          upperContent.includes('CREATE SEQUENCE') ||
          upperContent.includes('CREATE TRIGGER')) {
        return 'sql';
      }
      
      return 'sql'; // Default to SQL for safety
    } catch (error) {
      console.error(`Error analyzing file type for ${filePath}:`, error);
      return 'sql';
    }
  }

  getSnowflakeFileName(oraclePath, fileType = 'sql') {
    const ext = path.extname(oraclePath);
    const baseName = path.basename(oraclePath, ext);
    
    // Determine output file extension based on content analysis
    let outputExt = '.sql';
    
    // Convert complex PL/SQL to JavaScript stored procedures
    if (fileType === 'plsql' || fileType === 'pls') {
      outputExt = '.js';
    }
    
    // Add Snowflake suffix to distinguish from original files
    return `${baseName}__sf${outputExt}`;
  }

  async processFile(fileData) {
    const { filePath, extractedPath, convertedPath } = fileData;
    
    try {
      console.log(`Worker processing Oracle file: ${path.basename(filePath)}`);
      
      const oracleCode = await fs.readFile(filePath, 'utf8');
      const relativePath = path.relative(extractedPath, filePath);
      const fileType = await this.analyzeFileType(filePath);
      const snowflakeFileName = this.getSnowflakeFileName(relativePath, fileType);
      
      console.log(`Worker converting: ${path.basename(filePath)} -> ${snowflakeFileName} (type: ${fileType})`);
      
      // Convert Oracle to Snowflake
      const snowflakeCode = await this.convertOracleToSnowflake(oracleCode, path.basename(filePath), fileType);
      
      // Create the converted directory structure and save files
      const snowflakeFilePath = path.join(convertedPath, snowflakeFileName);
      await fs.ensureDir(path.dirname(snowflakeFilePath));
      await fs.writeFile(snowflakeFilePath, snowflakeCode, 'utf8');
      
      console.log(`Worker created file: ${snowflakeFilePath}`);
      
      return {
        original: relativePath,
        converted: snowflakeFileName,
        snowflakeContent: snowflakeCode,
        oracleContent: oracleCode,
        fileType: fileType,
        success: true,
        path: snowflakeFilePath
      };
      
    } catch (error) {
      console.error(`Worker error processing ${filePath}:`, error);
      
      return {
        original: path.relative(extractedPath, filePath),
        converted: null,
        snowflakeContent: null,
        oracleContent: null,
        fileType: null,
        success: false,
        error: error.message
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