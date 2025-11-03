const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');

class IDMCConversionService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    if (this.apiKey) {
      this.openai = new OpenAI({
        apiKey: this.apiKey
      });
    }
  }

  analyzeSqlContent(sqlText) {
    try {
      const upper = (sqlText || '').toUpperCase();
      // Oracle indicators
      const isOracle = (
        upper.includes('VARCHAR2') ||
        upper.includes('NUMBER') ||
        upper.includes('SYSDATE') ||
        upper.includes('DUAL') ||
        upper.includes('NVL(') ||
        upper.includes('DECODE(') ||
        /ROWNUM\b/.test(upper)
      );

      // Redshift indicators
      const isRedshift = (
        (upper.includes('CREATE TABLE') && (upper.includes('DISTKEY') || upper.includes('SORTKEY'))) ||
        upper.includes('COPY ') ||
        upper.includes('UNLOAD ') ||
        /\bSTL_\w+\b/.test(upper) ||
        /\bSVL_\w+\b/.test(upper) ||
        upper.includes('CHARACTER VARYING')
      );

      if (isOracle && !isRedshift) return 'oracle';
      if (isRedshift && !isOracle) return 'redshift';
      // Tie-breakers: prefer Oracle for DECODE/NVL, Redshift for COPY/UNLOAD
      if (upper.includes('COPY ') || upper.includes('UNLOAD ')) return 'redshift';
      if (upper.includes('DECODE(') || upper.includes('NVL(')) return 'oracle';
      return 'sql';
    } catch (e) {
      return 'sql';
    }
  }

  async convertOracleToIDMC(oracleCode, fileName, fileType = 'sql') {
    try {
      if (!this.apiKey || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      const systemPrompt = `You are an expert Informatica Data Management Cloud (IDMC) solution architect.

Given an SQL statement, your task is to translate it into an **IDMC Mapping Summary** using the below standardized format.

Follow this exact structure and table formatting in your response.

---

## 🧩 IDMC Mapping Summary

### 1. Objective
Provide a one-line description of what the SQL query achieves.

### 2. Source Objects
List the source tables involved and describe their purpose in a markdown table:

| Source Name | Description | Key Columns Used |
|--------------|--------------|------------------|

### 3. Transformations
Break down how each SQL clause or logic would be implemented in IDMC components.
Use a table in this format:

| Transformation | Type | Logic / Description |
|----------------|------|----------------------|

For transformations, use proper IDMC syntax:
- CASE statements → IIF(condition, true_value, false_value)
- DECODE → DECODE() functions
- NVL → ISNULL() functions
- SUBSTR → SUBSTR() functions
- Aggregations → SUM(), COUNT(), AVG(), MAX(), MIN()
- Joins → JOINER transformation with proper join conditions

### 4. Target Object
Describe the final output or destination and list the mapped columns in a table:

| Target | Description | Columns Mapped |
|---------|--------------|----------------|

### 5. Mapping Flow Diagram (Text Summary)
Represent the data flow step-by-step in a visual-text format like this:
Source1 --> Joiner --> Expression --> Aggregator --> Target

### 6. Additional Notes
Mention key join types, transformation order, error handling, reusability, or parameterization options.

CRITICAL REQUIREMENTS:
1. Use proper IDMC transformation types and syntax (IIF, DECODE, etc.)
2. Include detailed field mappings and expressions
3. Use proper IDMC data types and functions
4. Output in markdown format with tables as shown above
5. Be specific about transformation logic and expressions

ORACLE TO IDMC CONVERSION GUIDELINES:
- Oracle CASE statements → IDMC IIF() functions
- Oracle DECODE → IDMC DECODE() functions  
- Oracle NVL → IDMC ISNULL() functions
- Oracle SUBSTR → IDMC SUBSTR() functions
- Oracle TO_CHAR → IDMC TO_CHAR() functions
- Oracle TO_DATE → IDMC TO_DATE() functions
- Oracle ROWNUM → IDMC ROW_NUMBER() window functions
- Oracle SYSDATE → IDMC SYSDATE() functions
- Oracle DUAL table → IDMC VALUES clause
- Oracle cursors → IDMC lookup transformations
- Oracle packages → Multiple IDMC mappings
- Oracle procedures → IDMC expression transformations
- Oracle functions → IDMC expression transformations

IDMC SYNTAX EXAMPLES:
- Conditional: IIF(condition, true_value, false_value)
- String functions: SUBSTR(string, start, length), UPPER(string), LOWER(string)
- Date functions: TO_DATE(string, format), ADD_MONTHS(date, months)
- Math functions: ROUND(number, decimals), TRUNC(number, decimals)
- Aggregation: SUM(expression), COUNT(*), AVG(expression), MAX(expression), MIN(expression)

OUTPUT FORMAT:
- Output in markdown format with tables as specified above
- Use proper IDMC transformation names and syntax
- Include detailed field mappings and expressions
- Provide implementation-ready specifications`;

      const userPrompt = `Now, convert the following SQL query into an IDMC Mapping Summary using the above format:

[INSERT SQL STATEMENT HERE]

SQL Query:
${oracleCode}

File: ${fileName}
Type: ${fileType}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 4000
      });

      const idmcSummary = response.choices[0].message.content.trim();
      
      // Return markdown format directly (no JSON parsing needed)
      return idmcSummary;

    } catch (error) {
      console.error('Error converting Oracle to IDMC:', error);
      throw new Error(`Oracle to IDMC conversion failed: ${error.message}`);
    }
  }

  async convertRedshiftToIDMC(redshiftCode, fileName, fileType = 'sql') {
    try {
      if (!this.apiKey || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      const systemPrompt = `You are an expert Informatica Data Management Cloud (IDMC) solution architect.

Given an SQL statement, your task is to translate it into an **IDMC Mapping Summary** using the below standardized format.

Follow this exact structure and table formatting in your response.

---

## 🧩 IDMC Mapping Summary

### 1. Objective
Provide a one-line description of what the SQL query achieves.

### 2. Source Objects
List the source tables involved and describe their purpose in a markdown table:

| Source Name | Description | Key Columns Used |
|--------------|--------------|------------------|

### 3. Transformations
Break down how each SQL clause or logic would be implemented in IDMC components.
Use a table in this format:

| Transformation | Type | Logic / Description |
|----------------|------|----------------------|

For transformations, use proper IDMC syntax:
- CASE statements → IIF(condition, true_value, false_value)
- DECODE → DECODE() functions
- COALESCE → ISNULL() functions
- SUBSTRING → SUBSTR() functions
- Aggregations → SUM(), COUNT(), AVG(), MAX(), MIN()
- Joins → JOINER transformation with proper join conditions

### 4. Target Object
Describe the final output or destination and list the mapped columns in a table:

| Target | Description | Columns Mapped |
|---------|--------------|----------------|

### 5. Mapping Flow Diagram (Text Summary)
Represent the data flow step-by-step in a visual-text format like this:
Source1 --> Joiner --> Expression --> Aggregator --> Target

### 6. Additional Notes
Mention key join types, transformation order, error handling, reusability, or parameterization options.

CRITICAL REQUIREMENTS:
1. Use proper IDMC transformation types and syntax (IIF, DECODE, etc.)
2. Include detailed field mappings and expressions
3. Use proper IDMC data types and functions
4. Output in markdown format with tables as shown above
5. Be specific about transformation logic and expressions

REDSHIFT TO IDMC CONVERSION GUIDELINES:
- Redshift CASE statements → IDMC IIF() functions
- Redshift COALESCE → IDMC ISNULL() functions
- Redshift SUBSTRING → IDMC SUBSTR() functions
- Redshift TO_CHAR → IDMC TO_CHAR() functions
- Redshift TO_DATE → IDMC TO_DATE() functions
- Redshift ROW_NUMBER() → IDMC ROW_NUMBER() window functions
- Redshift window functions → IDMC aggregator transformations
- Redshift CTEs → IDMC subquery transformations
- Redshift COPY commands → IDMC bulk load operations
- Redshift VACUUM/ANALYZE → IDMC post-session commands
- Redshift DISTKEY/SORTKEY → IDMC performance optimizations
- Redshift UDFs → IDMC expression transformations

IDMC SYNTAX EXAMPLES:
- Conditional: IIF(condition, true_value, false_value)
- String functions: SUBSTR(string, start, length), UPPER(string), LOWER(string)
- Date functions: TO_DATE(string, format), ADD_MONTHS(date, months)
- Math functions: ROUND(number, decimals), TRUNC(number, decimals)
- Aggregation: SUM(expression), COUNT(*), AVG(expression), MAX(expression), MIN(expression)

OUTPUT FORMAT:
- Output in markdown format with tables as specified above
- Use proper IDMC transformation names and syntax
- Include detailed field mappings and expressions
- Provide implementation-ready specifications`;

      const userPrompt = `Now, convert the following SQL query into an IDMC Mapping Summary using the above format:

[INSERT SQL STATEMENT HERE]

SQL Query:
${redshiftCode}

File: ${fileName}
Type: ${fileType}`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 4000
      });

      const idmcSummary = response.choices[0].message.content.trim();
      
      // Return markdown format directly (no JSON parsing needed)
      return idmcSummary;

    } catch (error) {
      console.error('Error converting Redshift to IDMC:', error);
      throw new Error(`Redshift to IDMC conversion failed: ${error.message}`);
    }
  }

  createBasicIDMCStructure(fileName, code) {
    const baseName = path.basename(fileName, path.extname(fileName));
    
    return JSON.stringify({
      "mappingName": `${baseName}_IDMC_Mapping`,
      "description": `IDMC mapping generated from ${fileName}`,
      "mappingFlow": {
        "sources": [
          {
            "name": "Source_Table",
            "type": "TABLE",
            "schema": "default_schema",
            "connection": "default_connection",
            "description": "Source table for data extraction",
            "columns": [
              {
                "name": "id",
                "dataType": "VARCHAR",
                "length": 50,
                "nullable": false,
                "description": "Primary key identifier"
              }
            ]
          }
        ],
        "transformations": [
          {
            "name": "Main_Expression",
            "type": "EXPRESSION",
            "description": "Main transformation logic",
            "inputPorts": [
              {
                "name": "input_data",
                "dataType": "VARCHAR",
                "source": "Source_Table"
              }
            ],
            "outputPorts": [
              {
                "name": "output_data",
                "dataType": "VARCHAR",
                "expression": "input_data"
              }
            ],
            "businessLogic": "Converted from original code - requires manual review",
            "filterConditions": [],
            "groupByPorts": [],
            "aggregatePorts": []
          }
        ],
        "targets": [
          {
            "name": "Target_Table",
            "type": "TABLE",
            "schema": "default_schema",
            "connection": "default_connection",
            "description": "Target table for data loading",
            "columns": [
              {
                "name": "result_data",
                "dataType": "VARCHAR",
                "sourceField": "output_data",
                "transformation": "Main_Expression"
              }
            ]
          }
        ]
      },
      "dataQualityRules": [
        {
          "ruleName": "Data_Validation",
          "description": "Validate data quality before loading",
          "severity": "WARNING",
          "condition": "ISNULL(output_data)",
          "action": "Log warning and continue"
        }
      ],
      "performanceOptimizations": [
        {
          "aspect": "Data Volume",
          "recommendation": "Review and optimize for large datasets",
          "priority": "MEDIUM",
          "implementation": "Consider partitioning and indexing strategies"
        }
      ],
      "implementationNotes": [
        {
          "category": "Manual Review",
          "note": "This mapping requires manual review and testing",
          "actionRequired": true,
          "codeExample": "Review transformation logic and field mappings"
        }
      ]
    }, null, 2);
  }

  async analyzeFileType(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const upperContent = content.toUpperCase();
      
      // Check for Oracle specific constructs
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
          upperContent.includes('FOR') ||
          upperContent.includes('VARCHAR2') ||
          upperContent.includes('NUMBER') ||
          upperContent.includes('SYSDATE') ||
          upperContent.includes('DUAL')) {
        return 'oracle';
      }
      
      // Check for Redshift specific constructs
      if (upperContent.includes('CREATE TABLE') && upperContent.includes('DISTKEY') ||
          upperContent.includes('CREATE TABLE') && upperContent.includes('SORTKEY') ||
          upperContent.includes('COPY') ||
          upperContent.includes('VACUUM') ||
          upperContent.includes('ANALYZE') ||
          upperContent.includes('UNLOAD') ||
          upperContent.includes('STL_') ||
          upperContent.includes('SVL_') ||
          upperContent.includes('INTEGER') ||
          upperContent.includes('BIGINT') ||
          upperContent.includes('CHARACTER VARYING')) {
        return 'redshift';
      }
      
      // Check for general SQL constructs
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

  getIDMCFileName(originalPath, fileType = 'sql') {
    const ext = path.extname(originalPath);
    const baseName = path.basename(originalPath, ext);
    return `${baseName}_IDMC_Summary.md`;
  }

  // Method to convert direct Oracle code input to IDMC mapping
  async convertOracleCodeToIdmc(sourceCode, fileName) {
    try {
      console.log(`🔄 Converting direct Oracle code input to IDMC mapping for ${fileName}`);
      
      // Determine file type from fileName
      const fileType = path.extname(fileName).replace('.', '') || 'sql';
      
      // Use the existing conversion method
      const mappingSummary = await this.convertOracleToIDMC(sourceCode, fileName, fileType);
      
      return mappingSummary;
    } catch (error) {
      console.error('❌ Error converting direct Oracle code to IDMC:', error);
      throw new Error(`Failed to convert Oracle code to IDMC: ${error.message}`);
    }
  }

  // Method to convert direct Redshift code input to IDMC mapping
  async convertRedshiftCodeToIdmc(sourceCode, fileName) {
    try {
      console.log(`🔄 Converting direct Redshift code input to IDMC mapping for ${fileName}`);
      
      // Determine file type from fileName
      const fileType = path.extname(fileName).replace('.', '') || 'sql';
      
      // Use the existing conversion method
      const mappingSummary = await this.convertRedshiftToIDMC(sourceCode, fileName, fileType);
      
      return mappingSummary;
    } catch (error) {
      console.error('❌ Error converting direct Redshift code to IDMC:', error);
      throw new Error(`Failed to convert Redshift code to IDMC: ${error.message}`);
    }
  }

  /**
   * Generic method to convert any file (batch scripts, SQL, Node.js, etc.) to IDMC Mapping Summary
   * This method passes the entire file content to OpenAI with a comprehensive prompt
   * that works for all file types without complex parsing.
   */
  async convertToIDMC(fileContent, fileName, fileType = null) {
    try {
      if (!this.apiKey || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      // Determine file type if not provided
      if (!fileType) {
        const ext = path.extname(fileName).replace('.', '').toLowerCase();
        fileType = ext || 'txt';
      }

      const systemPrompt = `You are an expert Node.js architect and IDMC (Informatica Data Management Cloud) integration specialist.

I will give you a file (which could be a batch script, SQL script, Node.js project, shell script, or any automation/data processing script).  

Your job is to analyze it and generate a **structured documentation summary** similar to an **Informatica IDMC Mapping Summary**, clearly explaining what the script does and how it fits in a data or automation pipeline.

Your summary must include these sections:

## 🧩 IDMC Mapping Summary

### 1. Objective
Explain in one paragraph what the script is trying to achieve (e.g., data processing, automation, API service, ETL orchestration, database operations, stored procedure execution, etc.). Be specific and detailed.

### 2. Source Objects
List all input sources (files, APIs, databases, scripts, environment variables, command-line arguments, etc.) in a markdown table with their purpose.

| Source Type | Source Name | Description |

### 3. Target Objects
List all output or destination systems (databases, files, logs, APIs, etc.).

| Target Type | Target Name | Description |

### 4. Transformation / Logic Details
Step-by-step breakdown of the logic or data flow within the script. Be thorough and detailed.

| Step | Logic Description |

### 5. Parameters / Environment Variables
List all environment variables, parameters, command-line arguments, or configuration inputs used by the script.

| Parameter | Description | Example |

### 6. Error Handling
Explain how the script handles failures, logging, retries, or fallback behavior. Be specific about error codes, error levels, and error propagation.

### 7. Logging & Audit
Explain what logs or monitoring outputs are produced (file logs, console, DB updates, etc.). Include log file names, log formats, and what information is logged.

| Log File | Content |

### 8. Schedule / Execution Context
Describe how and when this script runs — manually, on schedule, or as part of a larger system (e.g., Informatica job, CI/CD pipeline, cron job, task scheduler, ETL workflow).

---

CRITICAL REQUIREMENTS:
1. Analyze the ENTIRE file content thoroughly - don't just skim the surface
2. For batch scripts (.bat, .sh): Explain the full orchestration flow, including how scripts call other scripts, how SQL*Plus or database clients are invoked, how parameters are passed, and what the overall workflow achieves
3. For SQL scripts: Explain stored procedures, functions, tables, and the business logic they implement
4. For any script: Identify ALL dependencies, inputs, outputs, and the complete data flow
5. Be detailed and comprehensive - the summary should be useful for someone who needs to understand or migrate the script
6. Use the exact table formats shown above
7. If the script calls stored procedures or functions, explain what those procedures do and their purpose in the overall flow
8. If the script processes data, explain the transformation logic step by step
9. If the script orchestrates other scripts or processes, explain the orchestration flow

OUTPUT FORMAT:
- Output in markdown format with tables as specified above
- Start with "## 🧩 IDMC Mapping Summary"
- Follow the exact section numbering and structure shown
- Use proper markdown table formatting
- Be comprehensive and detailed`;

      const userPrompt = `Analyze the following file and generate an IDMC Mapping Summary using the format specified above.

File Name: ${fileName}
File Type: ${fileType}

File Content:
\`\`\`
${fileContent}
\`\`\`

Please provide a comprehensive IDMC Mapping Summary that follows the exact format specified above. Analyze the entire file thoroughly and provide detailed information for all 8 sections.`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 4000
      });

      const idmcSummary = response.choices[0].message.content.trim();
      
      return idmcSummary;

    } catch (error) {
      console.error('Error converting file to IDMC:', error);
      throw new Error(`File to IDMC conversion failed: ${error.message}`);
    }
  }
}

module.exports = new IDMCConversionService();
