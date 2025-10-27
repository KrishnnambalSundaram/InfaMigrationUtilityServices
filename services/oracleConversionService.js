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
- Oracle TO_DATE → Snowflake TO_TIMESTAMP

JAVASCRIPT STORED PROCEDURE CONVERSION:
- Use CREATE OR REPLACE PROCEDURE syntax
- Convert PL/SQL blocks to JavaScript functions
- Use Snowflake JavaScript API for database operations
- Handle exceptions with try/catch blocks
- Use Snowflake session variables for parameters

OUTPUT FORMAT:
- Start with conversion header comment
- Include original file name and conversion timestamp
- Output clean, executable Snowflake code
- No markdown formatting or explanations`;

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
      
      // Clean up the response and add conversion header
      const cleanedCode = this.cleanSnowflakeCode(snowflakeCode, fileName);
      const codeWithHeader = this.addConversionHeader(cleanedCode, fileName);
      
      return codeWithHeader;
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
    
    // Remove lines that start with explanatory text
    cleaned = cleaned.replace(/^.*?(?:converted|snowflake|oracle|migration|equivalent|replacement).*?\n/gm, '');
    
    // Remove multiple consecutive empty lines
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  addConversionHeader(snowflakeCode, fileName) {
    const timestamp = new Date().toISOString();
    const header = `-- Converted by Inflecto Migration Utility
-- Original File: ${fileName}
-- Conversion Date: ${timestamp}
-- Target Platform: Snowflake

`;

    return header + snowflakeCode;
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
    
    // Determine output file extension based on content analysis
    let outputExt = '.sql';
    if (fileType === 'plsql' || fileType === 'pls') {
      outputExt = '.js'; // Convert PL/SQL procedures to JavaScript stored procedures
    }
    
    return `${baseName}__sf${outputExt}`;
  }

  async analyzeFileType(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const upperContent = content.toUpperCase();
      
      // Check for PL/SQL specific constructs
      if (upperContent.includes('CREATE OR REPLACE PROCEDURE') ||
          upperContent.includes('CREATE OR REPLACE FUNCTION') ||
          upperContent.includes('CREATE OR REPLACE PACKAGE') ||
          upperContent.includes('DECLARE') ||
          upperContent.includes('BEGIN') ||
          upperContent.includes('END;') ||
          upperContent.includes('EXCEPTION')) {
        return 'plsql';
      }
      
      // Check for SQL statements
      if (upperContent.includes('SELECT') ||
          upperContent.includes('INSERT') ||
          upperContent.includes('UPDATE') ||
          upperContent.includes('DELETE') ||
          upperContent.includes('CREATE TABLE') ||
          upperContent.includes('CREATE VIEW')) {
        return 'sql';
      }
      
      return 'sql'; // Default to SQL
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
}

module.exports = new OracleConversionService();
