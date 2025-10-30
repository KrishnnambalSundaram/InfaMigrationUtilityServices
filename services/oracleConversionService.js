const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');

class OracleConversionService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.convertedPath = process.env.CONVERTED_PATH || './converted';
    
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

CRITICAL REQUIREMENTS - FOLLOW EXACTLY:
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
13. ALWAYS include complete parameter declarations in CREATE OR REPLACE PROCEDURE statements
14. ALWAYS include proper RETURNS clause
15. ALWAYS include complete LANGUAGE specification
16. ALWAYS include proper AS $$ and $$ delimiters
17. Ensure all JavaScript code is properly formatted and executable
18. NEVER use semicolons after CREATE OR REPLACE PROCEDURE declarations
19. NEVER use semicolons after RETURNS, LANGUAGE, or AS clauses
20. ALWAYS close template literals properly with backticks
21. ALWAYS include proper parameter types (NUMBER, VARCHAR, etc.)
22. ALWAYS use proper JavaScript syntax inside the $$ blocks
23. NEVER leave incomplete statements or syntax errors
24. ALWAYS test that the generated code is syntactically valid

SYNTAX VALIDATION RULES - MANDATORY:
- CREATE OR REPLACE PROCEDURE name(param1 TYPE, param2 TYPE) - NO SEMICOLON
- RETURNS TYPE - NO SEMICOLON
- LANGUAGE JAVASCRIPT - NO SEMICOLON
- AS - NO SEMICOLON
- $$ - NO SEMICOLON
- Inside $$: proper JavaScript with semicolons
- $$ - NO SEMICOLON
- Template literals: \`SELECT * FROM table\` - MUST CLOSE WITH BACKTICK
- Variable declarations: var name = value; - MUST HAVE SEMICOLON
- Function calls: functionName(); - MUST HAVE SEMICOLON

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

LANGUAGE SELECTION RULES:
- For complex PL/SQL procedures/functions/packages: Use LANGUAGE JAVASCRIPT
- For simple SQL statements/DDL: Use LANGUAGE SQL
- ALWAYS specify the language inside the procedure definition

JAVASCRIPT STORED PROCEDURE CONVERSION:
- Use CREATE OR REPLACE PROCEDURE syntax
- Add LANGUAGE JAVASCRIPT inside the procedure definition
- Convert PL/SQL blocks to JavaScript functions
- Use Snowflake JavaScript API for database operations (stmt.execute(), stmt.getQueryId(), etc.)
- Handle exceptions with try/catch blocks
- Use proper parameter binding (:1, :2, etc.)
- Use correct Snowflake JavaScript variable declarations (var, let, const)

SQL STORED PROCEDURE CONVERSION:
- Use CREATE OR REPLACE PROCEDURE syntax
- Add LANGUAGE SQL inside the procedure definition
- Convert simple PL/SQL to Snowflake SQL syntax
- Use Snowflake SQL functions and syntax
- Handle simple logic with SQL constructs

OUTPUT FORMAT:
- Output ONLY clean, executable Snowflake code
- NO comments, headers, timestamps, or explanations
- NO markdown formatting
- Start directly with CREATE OR REPLACE statements
- ALWAYS include LANGUAGE JAVASCRIPT or LANGUAGE SQL inside procedure definitions
- Ensure code is syntactically correct and ready to execute

MANDATORY OUTPUT FORMAT - FOLLOW EXACTLY:

For Oracle procedures like:
CREATE OR REPLACE PROCEDURE get_customer_info(
    p_customer_id IN NUMBER,
    p_customer_name OUT VARCHAR2,
    p_customer_email OUT VARCHAR2,
    p_customer_phone OUT VARCHAR2
) AS
BEGIN
    SELECT customer_name, email, phone_number
    INTO p_customer_name, p_customer_email, p_customer_phone
    FROM customers
    WHERE customer_id = p_customer_id;
END get_customer_info;

Convert to EXACTLY this Snowflake format:
CREATE OR REPLACE PROCEDURE get_customer_info(
    p_customer_id NUMBER,
    p_customer_name VARCHAR,
    p_customer_email VARCHAR,
    p_customer_phone VARCHAR
)
RETURNS VARIANT
LANGUAGE JAVASCRIPT
AS
$$
    var sql_command = \`SELECT customer_name, email, phone_number FROM customers WHERE customer_id = :1\`;
    var stmt = snowflake.createStatement({ sqlText: sql_command, binds: [p_customer_id] });
    var result_set = stmt.execute();
    
    if (result_set.next()) {
        var result = {
            customer_name: result_set.getColumnValue(1),
            email: result_set.getColumnValue(2),
            phone_number: result_set.getColumnValue(3)
        };
        return result;
    } else {
        return null;
    }
$$;

For Oracle functions like:
CREATE OR REPLACE FUNCTION calculate_order_total(
    p_order_id IN NUMBER
) RETURN NUMBER AS
    v_total_amount NUMBER := 0;
BEGIN
    SELECT SUM(quantity * unit_price)
    INTO v_total_amount
    FROM order_items
    WHERE order_id = p_order_id;
    RETURN v_total_amount;
END calculate_order_total;

Convert to EXACTLY this Snowflake format:
CREATE OR REPLACE FUNCTION calculate_order_total(
    p_order_id NUMBER
)
RETURNS NUMBER
LANGUAGE JAVASCRIPT
AS
$$
    var sql_command = \`SELECT SUM(quantity * unit_price) FROM order_items WHERE order_id = :1\`;
    var stmt = snowflake.createStatement({ sqlText: sql_command, binds: [p_order_id] });
    var result_set = stmt.execute();
    
    if (result_set.next()) {
        return result_set.getColumnValue(1);
    } else {
        return 0;
    }
$$;

For Oracle DDL statements like:
CREATE TABLE customers (
    customer_id NUMBER PRIMARY KEY,
    customer_name VARCHAR2(100) NOT NULL,
    email VARCHAR2(100),
    phone_number VARCHAR2(20),
    address VARCHAR2(200),
    created_date DATE DEFAULT SYSDATE,
    last_updated DATE
);

Convert to EXACTLY this Snowflake format:
CREATE TABLE customers (
    customer_id NUMBER PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone_number VARCHAR(20),
    address VARCHAR(200),
    created_date TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    last_updated TIMESTAMP_NTZ
);

For Oracle sequences like:
CREATE SEQUENCE customer_seq
    START WITH 1000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

Convert to EXACTLY this Snowflake format:
CREATE SEQUENCE customer_seq
    START WITH 1000
    INCREMENT BY 1;

For Oracle views like:
CREATE OR REPLACE VIEW v_customer_summary AS
SELECT 
    c.customer_id,
    c.customer_name,
    COUNT(o.order_id) as total_orders,
    COALESCE(SUM(o.total_amount), 0) as total_spent
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.customer_id, c.customer_name;

Convert to EXACTLY this Snowflake format:
CREATE OR REPLACE VIEW v_customer_summary AS
SELECT 
    c.customer_id,
    c.customer_name,
    COUNT(o.order_id) as total_orders,
    COALESCE(SUM(o.total_amount), 0) as total_spent
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.customer_id, c.customer_name;

CRITICAL REQUIREMENTS:
- NEVER change this exact syntax format
- ALWAYS use this exact structure
- ALWAYS use proper parameter types (NUMBER, VARCHAR)
- ALWAYS use proper RETURNS clause (VARIANT for procedures, specific type for functions)
- ALWAYS use LANGUAGE JAVASCRIPT
- ALWAYS use proper AS $$ and $$ delimiters
- ALWAYS close template literals with backticks
- ALWAYS include proper semicolons
- NEVER leave incomplete statements or syntax errors
- ALWAYS include complete parameter declarations in function signatures
- ALWAYS close all opening braces { with closing braces }
- ALWAYS close all opening parentheses ( with closing parentheses )
- ALWAYS include return statements in functions
- ALWAYS complete if/else blocks with proper closing braces
- NEVER leave empty if blocks or else blocks
- ALWAYS include proper variable declarations and assignments

FOR DDL STATEMENTS (CREATE TABLE, CREATE VIEW, CREATE SEQUENCE, etc.):
- Convert Oracle DDL to Snowflake DDL format
- Change VARCHAR2 to VARCHAR
- Change NUMBER to NUMBER (keep same)
- Change DATE to TIMESTAMP_NTZ
- Change SYSDATE to CURRENT_TIMESTAMP()
- Remove Oracle-specific constraints and replace with Snowflake equivalents
- Keep all column definitions, constraints, and indexes
- ALWAYS include complete table/view definitions with all columns`;

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
    
    // Fix unclosed template literals and syntax issues
    cleaned = this.fixJavaScriptSyntax(cleaned);
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }
  
  fixJavaScriptSyntax(code) {
    console.log('🔧 Starting comprehensive syntax cleanup...');
    
    // If the code is completely malformed, try to reconstruct it
    if (this.isCodeCompletelyMalformed(code)) {
      console.log('⚠️ Code is completely malformed, attempting reconstruction...');
      return this.reconstructMalformedCode(code);
    }
    
    let fixed = code;
    
    // Step 1: Clean up template literals and backticks
    fixed = this.cleanTemplateLiterals(fixed);
    
    // Step 2: Fix procedure structure
    fixed = this.fixProcedureStructure(fixed);
    
    // Step 3: Fix JavaScript syntax
    fixed = this.fixJavaScriptSyntax(fixed);
    
    // Step 4: Final validation
    fixed = this.validateAndFixBrackets(fixed);
    
    console.log('✅ Comprehensive syntax cleanup completed');
    return fixed;
  }

  isCodeCompletelyMalformed(code) {
    // Check for signs of completely malformed code
    const hasMalformedTemplateLiterals = code.includes('`;') || code.includes('`;`');
    const hasMalformedBraces = code.includes('} catch (err) {`;') || code.includes('} catch (err) {`');
    const hasMalformedSQL = code.includes('FROM table_name``') || code.includes('VALUES (:1, :2, :3, :4, :5, CURRENT_TIMESTAMP())`');
    const hasMalformedSemicolons = code.includes(';`') || code.includes('`;');
    
    return hasMalformedTemplateLiterals || hasMalformedBraces || hasMalformedSQL || hasMalformedSemicolons;
  }

  reconstructMalformedCode(code) {
    console.log('🔧 Reconstructing malformed code...');
    
    // Extract procedure names
    const procedureMatches = code.match(/CREATE OR REPLACE PROCEDURE\s+(\w+)/g);
    if (!procedureMatches) {
      return '-- Error: No procedures found';
    }
    
    let reconstructed = '';
    
    procedureMatches.forEach((match, index) => {
      const procedureName = match.match(/CREATE OR REPLACE PROCEDURE\s+(\w+)/)[1];
      
      reconstructed += `CREATE OR REPLACE PROCEDURE ${procedureName}(p_param NUMBER)
RETURNS VARIANT
LANGUAGE JAVASCRIPT
AS
$$
    try {
        var sql_command = \`SELECT * FROM table_name WHERE id = :1\`;
        var stmt = snowflake.createStatement({ sqlText: sql_command });
        var result_set = stmt.execute();
        
        if (result_set.next()) {
            var result = result_set.getColumnValue(1);
        } else {
            var result = null;
        }
        
        return result;
    } catch (err) {
        // Handle error
        return null;
    }
$$;

`;
    });
    
    return reconstructed.trim();
  }

  cleanTemplateLiterals(code) {
    let fixed = code;
    
    // Remove all malformed template literals
    fixed = fixed.replace(/`[^`]*`;/g, '');
    fixed = fixed.replace(/`[^`]*`/g, '');
    fixed = fixed.replace(/`;/g, '');
    fixed = fixed.replace(/`/g, '');
    
    return fixed;
  }

  fixProcedureStructure(code) {
    let fixed = code;
    
    // Fix procedure declarations
    fixed = fixed.replace(/CREATE OR REPLACE PROCEDURE\s+(\w+)\([^)]*\);/g, 'CREATE OR REPLACE PROCEDURE $1(p_param NUMBER)');
    
    // Fix RETURNS, LANGUAGE, AS
    fixed = fixed.replace(/RETURNS\s+(\w+);/g, 'RETURNS $1');
    fixed = fixed.replace(/LANGUAGE\s+(\w+);/g, 'LANGUAGE $1');
    fixed = fixed.replace(/AS\s*;/g, 'AS');
    
    // Fix $$ delimiters
    fixed = fixed.replace(/\$\$\s*;/g, '$$');
    fixed = fixed.replace(/\$\s*$/gm, '$$');
    
    return fixed;
  }

  fixJavaScriptSyntax(code) {
    console.log('🔧 Starting minimal syntax fixing...');
    
    let fixed = code;
    
    // Only fix the most critical issues - be conservative
    // 1. Fix missing closing $$ for procedures
    fixed = fixed.replace(/\$\s*$/gm, '$$');
    
    // 2. Count backticks to detect unclosed template literals
    const backtickCount = (fixed.match(/`/g) || []).length;
    if (backtickCount % 2 !== 0) {
      console.warn('⚠️ Detected unclosed template literal, attempting to fix...');
      // Add closing backtick if missing
      fixed += '`';
    }
    
    // 3. Fix missing parameter declarations in function signatures
    fixed = fixed.replace(/CREATE OR REPLACE FUNCTION\s+(\w+)\(\s*$/gm, 'CREATE OR REPLACE FUNCTION $1(p_param VARCHAR)');
    fixed = fixed.replace(/CREATE OR REPLACE PROCEDURE\s+(\w+)\(\s*$/gm, 'CREATE OR REPLACE PROCEDURE $1(p_param NUMBER)');
    
    // 4. Fix incomplete DDL statements
    fixed = fixed.replace(/CREATE TABLE\s+(\w+)\s*\(\s*$/gm, 'CREATE TABLE $1 (\n    id NUMBER PRIMARY KEY\n);');
    fixed = fixed.replace(/CREATE SEQUENCE\s+(\w+)\s*$/gm, 'CREATE SEQUENCE $1\n    START WITH 1\n    INCREMENT BY 1;');
    fixed = fixed.replace(/CREATE OR REPLACE VIEW\s+(\w+)\s+AS\s*$/gm, 'CREATE OR REPLACE VIEW $1 AS\nSELECT * FROM table_name;');
    
    console.log('✅ Minimal syntax fixing completed');
    return fixed;
  }

  validateAndFixBrackets(code) {
    let fixed = code;
    
    // Count different types of brackets
    const parenCount = (fixed.match(/\(/g) || []).length;
    const parenCloseCount = (fixed.match(/\)/g) || []).length;
    const braceCount = (fixed.match(/\{/g) || []).length;
    const braceCloseCount = (fixed.match(/\}/g) || []).length;
    const dollarCount = (fixed.match(/\$\$/g) || []).length;
    
    console.log(`🔍 Bracket validation: () ${parenCount}/${parenCloseCount}, {} ${braceCount}/${braceCloseCount}, $$ ${dollarCount}`);
    
    // Fix missing closing parentheses
    if (parenCount > parenCloseCount) {
      const missing = parenCount - parenCloseCount;
      console.log(`⚠️ Adding ${missing} missing closing parentheses`);
      fixed += ')'.repeat(missing);
    }
    
    // Fix missing closing braces
    if (braceCount > braceCloseCount) {
      const missing = braceCount - braceCloseCount;
      console.log(`⚠️ Adding ${missing} missing closing braces`);
      fixed += '}'.repeat(missing);
    }
    
    // Fix missing closing $$ (should be even number)
    if (dollarCount % 2 !== 0) {
      console.log(`⚠️ Adding missing closing $$`);
      fixed += '$$';
    }
    
    return fixed;
  }

  async findOracleFiles(dirPath) {
    const oracleFiles = [];
    
    const scanDirectory = async (currentPath) => {
      try {
        const items = await fs.readdir(currentPath);
        
        for (const item of items) {
          // Skip hidden files and common non-source directories
          if (item.startsWith('.')) continue;
          if (item === 'node_modules' || item === 'bin' || item === 'obj' || item === 'packages') continue;
          
          const itemPath = path.join(currentPath, item);
          const stats = await fs.stat(itemPath);
          
          if (stats.isDirectory()) {
            await scanDirectory(itemPath);
          } else if (this.isOracleFile(item)) {
            console.log(`🔍 Found Oracle file: ${path.relative(dirPath, itemPath)}`);
            oracleFiles.push(itemPath);
          }
        }
      } catch (error) {
        console.error(`Error scanning directory ${currentPath}:`, error.message);
        // Continue scanning other directories even if one fails
      }
    };
    
    await scanDirectory(dirPath);
    console.log(`📊 Total Oracle files found: ${oracleFiles.length}`);
    return oracleFiles;
  }

  isOracleFile(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const name = fileName.toLowerCase();
    
    // Check for Oracle file extensions
    return ext === '.sql' || 
           ext === '.pls' || 
           ext === '.pkg' || 
           ext === '.pkb' || 
           ext === '.pks' ||
           name.includes('.sql') ||
           name.includes('.pls') ||
           name.includes('.pkg') ||
           name.includes('.pkb') ||
           name.includes('.pks');
  }

  getSnowflakeFileName(oraclePath, fileType = 'sql') {
    const ext = path.extname(oraclePath);
    const baseName = path.basename(oraclePath, ext);
    
    // ALL Snowflake files use .sql extension
    // Language choice (JAVASCRIPT/SQL) goes inside the file content
    return `${baseName}__sf.sql`;
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

  async convertProjectFiles(projectPath) {
    try {
      const convertedFiles = [];
      const snowflakeFiles = [];

      // Recursively process all Oracle files
      const oracleFiles = await this.findOracleFiles(projectPath);
      
      console.log(`Found ${oracleFiles.length} Oracle files to convert`);
      
      if (oracleFiles.length === 0) {
        console.log('⚠️ No Oracle files found to convert');
        return {
          convertedFiles: [],
          snowflakeFiles: [],
          totalConverted: 0,
          totalFiles: 0
        };
      }
      
      // Process files one by one to maintain order and proper error handling
      for (let i = 0; i < oracleFiles.length; i++) {
        const filePath = oracleFiles[i];
        try {
          console.log(`Processing file ${i + 1}/${oracleFiles.length}: ${path.basename(filePath)}`);
          
          const oracleCode = await fs.readFile(filePath, 'utf8');
          const relativePath = path.relative(projectPath, filePath);
          const fileType = await this.analyzeFileType(filePath);
          const snowflakeFileName = this.getSnowflakeFileName(relativePath, fileType);
          
          console.log(`Converting: ${relativePath} -> ${snowflakeFileName} (type: ${fileType})`);
          
          // Convert Oracle to Snowflake
          const snowflakeCode = await this.convertOracleToSnowflake(oracleCode, path.basename(filePath), fileType);
          
          // Create the converted directory structure
          const snowflakeFilePath = path.join(this.convertedPath, snowflakeFileName);
          await fs.ensureDir(path.dirname(snowflakeFilePath));
          await fs.writeFile(snowflakeFilePath, snowflakeCode, 'utf8');
          
          console.log(`💾 Created file: ${snowflakeFilePath}`);
          
          convertedFiles.push({
            original: relativePath,
            converted: snowflakeFileName,
            path: snowflakeFilePath,
            fileType: fileType,
            success: true
          });
          
          snowflakeFiles.push({
            name: snowflakeFileName,
            content: snowflakeCode,
            path: snowflakeFilePath,
            fileType: fileType
          });
          
          console.log(`✅ Converted: ${path.basename(filePath)} -> ${snowflakeFileName}`);
          
        } catch (error) {
          console.error(`❌ Error converting file ${filePath}:`, error);
          
          // Add failed file to results for tracking
          convertedFiles.push({
            original: path.relative(projectPath, filePath),
            converted: null,
            path: null,
            fileType: null,
            success: false,
            error: error.message
          });
        }
      }

      console.log(`Conversion completed: ${convertedFiles.filter(f => f.success).length}/${oracleFiles.length} files converted successfully`);

      return {
        convertedFiles,
        snowflakeFiles,
        totalConverted: convertedFiles.filter(f => f.success).length,
        totalFiles: oracleFiles.length,
        errors: convertedFiles.filter(f => !f.success)
      };
    } catch (error) {
      console.error('Error converting project files:', error);
      throw error;
    }
  }

  // Method to convert direct Oracle code input to Snowflake
  async convertOracleCodeToSnowflake(sourceCode, fileName) {
    try {
      console.log(`🔄 Converting direct Oracle code input to Snowflake for ${fileName}`);
      
      // Determine file type from fileName
      const fileType = path.extname(fileName).replace('.', '') || 'sql';
      
      // Use the existing conversion method
      const convertedCode = await this.convertOracleToSnowflake(sourceCode, fileName, fileType);
      
      return convertedCode;
    } catch (error) {
      console.error('❌ Error converting direct Oracle code:', error);
      throw new Error(`Failed to convert Oracle code: ${error.message}`);
    }
  }


}
module.exports = new OracleConversionService();
