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

  /**
   * Convert IDMC Mapping Summary (markdown/text) to fully compliant IDMC mapping JSON (.bat export structure)
   * @param {string} idmcSummary - The IDMC mapping summary in markdown/text format
   * @param {string} fileName - Original file name for naming the mapping
   * @returns {Promise<string>} - JSON string of the IDMC mapping (to be saved as .bat file)
   */
  async convertIdmcSummaryToJson(idmcSummary, fileName) {
    try {
      if (!this.apiKey || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      const systemPrompt = `You are an expert Informatica Data Management Cloud (IDMC) metadata generator.

      Your task is to convert a given **IDMC Mapping Summary** into a **fully compliant IDMC mapping JSON file** (.bin export structure).
      
      **IMPORTANT: IDMC Summary Format Flexibility**
      The IDMC Mapping Summary you receive may come in various formats:
      - Markdown tables with structured sections (Source Objects, Transformations, Target Objects, etc.)
      - Plain text descriptions with flow diagrams
      - Structured sections with numbered lists
      - Mixed formats combining tables, text, and diagrams
      - Different section names or ordering (e.g., "Source Objects" vs "Sources" vs "Input Tables")
      - Some summaries may be detailed, others may be brief
      - Some may include field-level details, others may be high-level
      
      **Your parsing approach must be flexible:**
      - Extract information regardless of format structure
      - Look for keywords and patterns, not just specific section headers
      - Infer missing details from context when necessary
      - Use sensible defaults for unspecified fields (e.g., data types, connection names)
      - Handle both detailed and high-level summaries
      - Recognize transformations even if described differently (e.g., "lookup" vs "lookup transformation" vs "fetch from")
      - Parse flow diagrams in text format (e.g., "Source1 --> Joiner --> Expression --> Target")
      - Extract field mappings from tables, lists, or narrative text
      
      The generated JSON must:
      
      1. Follow the **exact internal structure** of an Informatica Cloud export with these required fields:
         - "documentType": "MAPPING"
         - "metadata": { "$$classInfo": {...} } with proper class information
         - "nodes": array containing all transformation nodes
         - "links": array containing data flow connections
         - "groups": array for grouping transformations
         - Prefer including "metadata.logic" for SQL-bearing nodes and "metadata.$$classInfo.transformationType": "SQL" for SQL nodes.
      
      2. Include proper node structure with correct $$class values:
         - Sources: "TmplSource"
         - Lookup: "TmplLookup"
         - Expression: "TmplExpression"
         - Filter: "TmplFilter"
         - Router: "TmplRouter"
         - Joiner: "TmplJoiner"
         - Aggregator: "TmplAggregator"
         - Sequence: "TmplSequence"
         - Update Strategy: "TmplUpdateStrategy"
         - Targets: "TmplTarget"
         
         Each node must have: $$class, $$ID, ##SID, name, x, y, metadata.$$classInfo, and fields array.
         For SQL-bearing Expression nodes, include:
         - metadata.$$classInfo.transformationType = "SQL"
         - metadata.sqlDialect = "Oracle"
         - metadata.logic = "<clear SQL or pseudo-SQL derived from summary>"
      
      3. Use **auto-layout coordinates** for transformations:
         - x increments by 200 for each step
         - y: 100 for sources, 200 for transformations, 300 for targets
         - Parallel branches (like separate INSERT/UPDATE or separate logging branches): use different y coordinates (e.g., 150 for INSERT, 250 for UPDATE, 220/260 for parallel metrics/logging)
         - Start at x=100, y=100
      
      4. Use the following default naming rules:
         - Mapping Name: extract from summary or use fileName
         - Sources: prefix with src_
         - Lookup: prefix with LKP_
         - Aggregator: prefix with AGG_
         - Router: prefix with RTR_
         - Sequence: prefix with SEQ_
         - Expression: prefix with EXP_
         - Update Strategy: prefix with UPD_
         - Filter: prefix with FLT_
         - Joiner: prefix with JNR_
         - Target: prefix with tgt_
      
      5. Maintain consistent data types from the summary (STRING, INTEGER, DATE/TIMESTAMP). Use Oracle-friendly types when unspecified.
      
      6. Follow Oracle data adapter conventions for connections. Prefer Oracle-safe SQL (SYSDATE, NVL/COALESCE, etc.) when composing metadata.logic.
      
      7. **Transformation Flow Rules (CONDITIONAL & CRITICAL):**
         **A) Standard upsert (insert/update) flows** — when the summary mentions insert/update of business targets:
           - Lookup transformations MUST come immediately after Source.
           - Aggregators for existence checks MUST come before Router.
           - Router MUST split into INSERT and UPDATE paths.
           - Sequence Generator MUST be in INSERT path only.
           - Update Strategy MUST be in UPDATE path only.
           - Expression transformations may appear before Aggregator for data cleaning or default handling.
      
           **MANDATORY FLOW PATTERN (for Insert/Update logic):**
           Source → Lookup → Expression → Aggregator → Router
                                                      ├→ Sequence → Target (INSERT)
                                                      └→ UpdateStrategy → Target (UPDATE)
      
           If only insert or only update is mentioned, simplify that branch accordingly while maintaining IDMC logical correctness.
      
         **B) Maintenance/housekeeping flows** — when the summary is about DELETEs, SELECT metrics (SUM/COUNT), integrity checks, and logging to targets:
           - Use one or more SQL **Expression** nodes to model DELETE, SELECT SUM/COUNT, and computed metrics.
           - Sources feeding metrics (e.g., dba_data_files) → Expression nodes with derived fields (e.g., total_gb, used_gb).
           - For orphan checks: Prefer **Lookup** immediately after the source being validated, or a **Joiner (Left Outer) + Filter** to isolate non-matching rows. Aggregator may be used to COUNT.
           - **Insert into log targets** should be modeled as an **Expression** that produces the final log fields, feeding a **Target**.
           - Upsert Router/Sequence/UpdateStrategy are **not required** unless the summary explicitly calls for insert/update branching.
      
      7.1. **🧠 Dynamic Adaptation Rules (AUTOMATIC FLOW DETERMINATION):**
         Automatically determine the mapping flow type based on summary keywords:
         
         **Flow Type Detection:**
         - If summary mentions: DELETE, CLEANUP, ARCHIVE, SELECT (metrics), LOG, MAINTENANCE, PURGE, REMOVE
           → Use **SQL-Expression Maintenance Flow** (Expression-centric with computed fields and log targets)
         - If summary mentions: INSERT, UPDATE, UPSERT, MERGE, TARGET TABLE, LOAD, SYNC
           → Use **Upsert Flow** (Source → Lookup → Expression → Aggregator → Router → Sequence/UpdateStrategy → Target)
         - Otherwise (generic ETL, transformation, data movement)
           → Use **Generic ETL Flow** (Source → Expression → Target, or Source → Joiner → Expression → Target)
         
         **Virtual Source Node Creation:**
         - Automatically create virtual source nodes (TmplSource) for any table/object referenced inside SQL logic or Expression metadata.logic that is NOT explicitly listed under "Source Objects" section
         - These virtual sources should have:
           - connectionId: "oracle_connection" (or inferred from context)
           - object.path: extracted from SQL references (e.g., "SCHEMA.TABLE_NAME")
           - fields: inferred from SQL SELECT statements or use generic field structure if not specified
         - Example: If Expression logic references "SELECT * FROM audit_log WHERE...", create src_audit_log even if not in Source Objects
         
         **Unknown Transformation Handling:**
         - For any transformation type that cannot be clearly identified from the summary
         - Default to "TmplExpression" with:
           - metadata.$$classInfo.transformationType = "SQL"
           - metadata.sqlDialect = "Oracle"
           - metadata.logic = extracted or inferred SQL/pseudo-SQL from the description
         
         **Auto-Wrap Layout (Visual Organization):**
         - If total node count exceeds 10 nodes, implement auto-wrapping:
           - Reset x coordinate to 100 when wrapping
           - Increase y coordinate by +200 for each new visual row
           - Maintain logical flow while organizing visually
           - Example: Nodes 1-10 at y=100-300, Nodes 11-20 at y=500-700, etc.
         
         **Optional Grouping for Clarity:**
         - Group related Expression+Target pairs (especially for maintenance/logging scenarios)
         - Create groups in the "groups" array for:
           - Maintenance operations: group Expression+Target pairs for *_log targets
           - Parallel branches: group INSERT and UPDATE branches separately
           - Related transformations: group Lookup+Expression pairs that work together
         - Group structure: { "name": "Maintenance_Group", "nodes": ["exp_log_1", "tgt_audit_log"], "description": "Logging operations" }
      
      8. **Field Propagation Rules:**
         - All Source fields flow through the mapping unless explicitly dropped.
         - Lookup fields are added (not replaced).
         - Expression fields may modify or create new output fields (define them under "fields" with proper data types).
         - Sequence adds generated ID fields (INSERT branch only).
         - Aggregator outputs group fields and aggregated metrics.
         - Router conditions use Aggregator output fields (e.g., COUNT_RECORDS).
         - UpdateStrategy and Target receive propagated fields.
         - For SQL DELETE Expressions, include a boolean/metric output (e.g., deleted_count) where applicable.
      
      9. **Routing and Grouping Rules (when Router is used):**
         - Router must define at least two groups: INSERT_GROUP and UPDATE_GROUP.
         - INSERT_GROUP condition: "COUNT_RECORDS = 0"
         - UPDATE_GROUP condition: "COUNT_RECORDS > 0"
         - Each branch must connect to its corresponding transformation path.
      
      10. **Update Strategy Logic (when used):**
         - UpdateStrategy should contain update fields if referenced in summary.
         - Use "updateStrategy": "DD_UPDATE" for updates, "updateStrategy": "DD_INSERT" for inserts.
         - Set "updateCondition" based on summary logic or TRUE by default.
      
      11. **Link Flow Rules:**
         - Each "link" must connect valid fromNode → toNode pairs in sequence order.
         - Every toField must exist in fromNode's fields.
         - Router branches must include "fromGroup": "INSERT_GROUP" or "fromGroup": "UPDATE_GROUP".
         - Flow must **terminate at Target nodes** (Targets are sinks; no outgoing links).
         - Reflect any text diagram order from the summary; allow parallel branches for metrics and logging.
      
      12. **Metadata $$classInfo Templates:**
         - Keep your existing $$classInfo definitions for each node type exactly as listed in your base prompt.
         - Additionally, for **TmplExpression** nodes derived from SQL logic, set:
           - metadata.$$classInfo.transformationType = "SQL"
           - metadata.sqlDialect = "Oracle"
           - metadata.logic with the precise SQL or close pseudo-SQL extracted from the summary.
      
      13. **Keyword-to-Transformation Mapping (Flexible Pattern Matching):**
         Recognize transformations even when described differently. Common variations:
         
         **Lookup Transformations:**
         - "lookup", "lookup transformation", "fetch from", "retrieve from", "get from", "reference data", "lookup table", "reference lookup"
         → Create TmplLookup node
         
         **Joiner Transformations:**
         - "join", "joiner", "join two sources", "join tables", "combine sources", "merge tables", "inner join", "left join", "outer join"
         → Create TmplJoiner node with appropriate joinType
         
         **Filter Transformations:**
         - "filter", "filter rows", "filter where", "where condition", "filter condition", "exclude", "include only"
         → Create TmplFilter node
         
         **Expression Transformations:**
         - "calculate", "compute", "transform", "derive", "expression", "formula", "calculation", "convert", "format", "IIF", "DECODE", "CASE"
         → Create TmplExpression node
         
         **Aggregator Transformations:**
         - "aggregate", "group by", "count", "sum", "average", "max", "min", "aggregation", "grouping", "rollup"
         → Create TmplAggregator node
         
         **Sequence Generator:**
         - "sequence", "sequence generator", "auto-increment", "generate id", "nextval", "sequence number", "serial number"
         → Create TmplSequence node (INSERT branch only)
         
         **Router Transformations:**
         - "router", "route", "split", "branch", "conditional routing", "route based on", "split flow", "conditional flow"
         → Create TmplRouter node with groups
         
         **Update Strategy:**
         - "update strategy", "update", "insert", "upsert", "merge", "insert or update", "update existing", "insert new"
         → Create TmplUpdateStrategy node (or Router + UpdateStrategy for upsert)
         
         **Special Patterns:**
         - "orphaned records", "orphan check", "missing reference" → Source → Lookup OR Joiner(Left) + Filter → Aggregator(Count)
         - "disk space", "SUM(bytes)", "total bytes", "calculate size" → Expression (derive total_gb/used_gb fields)
         - "DELETE", "delete older than", "purge", "remove" → Expression with DELETE logic and optional deleted_count output
         - "log results", "insert into log", "audit log", "logging" → Expression (compute fields) → Target(log table)
         - "check existence", "exists", "if exists", "validate existence" → Lookup → Aggregator(COUNT) → Router
         - "insert if not exists", "update if exists" → Full upsert pattern with Router
      
      14. **Validation Checklist (CRITICAL):**
         Before output, ensure:
         - ✅ Every object mentioned in the summary (sources/targets like orders, products, customers, etc.) has a node, even if used only for validation/lookups.
         - ✅ Virtual source nodes created for tables referenced in SQL logic but not in Source Objects section.
         - ✅ Flow type correctly determined (Maintenance/Upsert/Generic ETL) based on summary keywords.
         - ✅ Each transformation mentioned in the summary is represented (DELETE, SUM/COUNT, INSERT log).
         - ✅ Unknown transformations default to TmplExpression with transformationType="SQL" and appropriate metadata.logic.
         - ✅ For upsert scenarios: Aggregator present for existence checks; Router with INSERT/UPDATE groups; Sequence only in INSERT; UpdateStrategy only in UPDATE; Lookup precedes Expression.
         - ✅ For maintenance scenarios: SQL Expression nodes include "logic", and final log INSERT is represented as Expression feeding the log Target(s).
         - ✅ Targets have key fields matching the summary.
         - ✅ Field mappings and data types match the summary.
         - ✅ "metadata.$$classInfo.transformationType" is set to "SQL" for SQL Expressions.
         - ✅ No invalid connections (Target cannot feed other nodes).
         - ✅ Coordinates follow the auto-layout rules (auto-wrap applied if node count > 10).
         - ✅ Optional groups created for related Expression+Target pairs (especially maintenance/logging operations).
      
      15. **Parameterization (if dates/ranges are in the summary):**
         - Define runtime parameters (e.g., P_CLEANUP_DAYS, P_ARCHIVE_DAYS) in a "parameters" section under "metadata" with sensible defaults.
         - Use these parameters in Expression "logic" (e.g., log_date < SYSDATE - :P_ARCHIVE_DAYS).
      
      16. **Output Format:**
         - Output only valid JSON (no markdown or commentary).
         - JSON must be fully parseable.
         - Ensure complete node, link, and group structures are present.
         - Auto-generate any missing but implied nodes (e.g., referenced lookup sources) to keep the flow semantically correct.
      
      ---
      
      ### 🧩 Flow Enforcement Guide
      
      - If the summary mentions **both insert and update**: enforce the upsert pattern (Source → Lookup → Expression → Aggregator → Router → (Sequence→Target | UpdateStrategy→Target)).
      - If the summary is **maintenance/housekeeping** (DELETE/metrics/logging) **without** upsert semantics: build a SQL-Expression-centric flow with computed fields and log-target inserts, and **do not** force a Router/Sequence/UpdateStrategy unless explicitly called for.
      
      ---
      
      **CRITICAL PARSING INSTRUCTIONS:**
      
      Parse the IDMC summary carefully, adapting to its format, to extract:
      
      1. **Mapping Name:**
         - Look for explicit "Mapping Name", "Mapping:", or similar headers
         - Extract from title/header if present
         - Use fileName as fallback if not found
         - May be in various formats: "Customer_Load_Mapping", "mapping_customer_load", etc.
      
      2. **Source and Target Objects:**
         - Search for sections titled: "Source Objects", "Sources", "Input Tables", "Source Tables", "Source Data"
         - May be in tables, lists, or narrative text
         - Extract table/schema names, connection info, and key columns
         - Look for target sections: "Target Objects", "Targets", "Destination", "Output Tables"
         - Handle both explicit tables and inferred targets from flow descriptions
      
      3. **Transformations:**
         - Search transformation sections: "Transformations", "Transformation Logic", "Processing Steps", "Data Flow"
         - May be in tables, numbered lists, or descriptive paragraphs
         - Identify transformation types using keyword matching (see section 13)
         - Extract transformation logic, expressions, and conditions
         - Handle both explicit transformation names and implicit logic descriptions
      
      4. **Field Definitions and Data Types:**
         - Extract from "Columns Mapped", "Field Mappings", "Data Mapping" sections
         - May be in tables with columns like: Field Name | Data Type | Length | Description
         - Or described in narrative: "customer_id (INTEGER)", "customer_name (VARCHAR(255))"
         - Infer data types from context if not specified (e.g., "id" → INTEGER, "name" → STRING)
         - Handle Oracle-specific types: VARCHAR2, NUMBER, DATE, TIMESTAMP
      
      5. **Flow Sequence:**
         - Look for "Mapping Flow Diagram", "Data Flow", "Process Flow" sections
         - Parse text diagrams: "Source1 --> Joiner --> Expression --> Target"
         - Extract from narrative descriptions: "data flows from source through lookup to target"
         - Identify transformation order from context if not explicitly diagrammed
      
      6. **Logic Expressions:**
         - Extract from transformation descriptions, expression fields, or logic sections
         - Look for: IIF, COUNT, SUM, AVG, CASE, DECODE, NVL, COALESCE, SUBSTR, TO_DATE, etc.
         - May be in SQL format, IDMC expression format, or natural language
         - Convert to appropriate IDMC expression syntax
      
      7. **Conditions and Business Rules:**
         - Extract filter conditions, router conditions, update conditions
         - Look for: "WHERE", "IF", "WHEN", "condition", "criteria"
         - May be in SQL format or natural language descriptions
         - Convert to IDMC expression format
      
      8. **Insert/Update Logic:**
         - Identify upsert patterns: "insert or update", "upsert", "merge"
         - Look for existence checks: "check if exists", "validate", "lookup"
         - Extract conditions for insert vs update paths
         - May be explicitly stated or inferred from flow description
      
      9. **Runtime Parameters:**
         - Look for parameterized values: date ranges, thresholds, flags
         - May be in "Parameters" section or embedded in logic descriptions
         - Extract parameter names and default values
         - Examples: "P_CLEANUP_DAYS", "P_ARCHIVE_DATE", "P_BATCH_SIZE"
      
      10. **Missing Information Handling:**
         - If field data types are missing, infer from field names and context
         - If connection names are missing, use defaults: "oracle_connection", "sqlserver_connection"
         - If transformation coordinates are not specified, use auto-layout rules
         - If field mappings are incomplete, infer from source/target field names
         - If transformation order is unclear, follow logical data flow patterns
      
      **After parsing, build a fully valid Informatica Cloud Mapping JSON export** that:
      - Includes all identified sources, transformations, and targets
      - Follows proper IDMC structure and conventions
      - Uses inferred/default values for missing information
      - Maintains logical flow even if summary is incomplete
      - Validates field references and transformation connections`;
      

      const userPrompt = `Convert the following IDMC Mapping Summary into a fully compliant IDMC mapping JSON file.

IDMC Mapping Summary:
${idmcSummary}

Original File: ${fileName}

Generate the complete JSON structure following all the requirements above. Output ONLY valid JSON, no markdown or code blocks.`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 8000,
        response_format: { type: "json_object" }
      });

      let jsonContent = response.choices[0].message.content.trim();
      
      // Remove markdown code blocks if present
      jsonContent = jsonContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Validate JSON
      try {
        JSON.parse(jsonContent);
      } catch (parseError) {
        console.error('Generated JSON is invalid, attempting to fix...');
        // Try to extract JSON from the response
        const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonContent = jsonMatch[0];
        } else {
          throw new Error('Could not extract valid JSON from response');
        }
      }
      
      return jsonContent;

    } catch (error) {
      console.error('Error converting IDMC summary to JSON:', error);
      throw new Error(`IDMC summary to JSON conversion failed: ${error.message}`);
    }
  }
}

module.exports = new IDMCConversionService();
