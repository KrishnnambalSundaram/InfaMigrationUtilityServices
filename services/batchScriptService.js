const fs = require('fs-extra');
const path = require('path');
const idmcConversionService = require('./idmcConversionService');

class BatchScriptService {
  constructor() {
    this.sqlPatterns = {
      // Oracle SQL patterns
      oracle: [
        /sqlplus\s+[^@]*@[^\s]+\s+@([^\s]+)/gi,  // sqlplus user/pass@db @script.sql
        /@([^\s]+\.sql)/gi,                      // @script.sql
        /spool\s+([^\s]+)/gi,                    // spool filename
        /set\s+pages\s+\d+/gi,                   // set pages 0
        /set\s+feedback\s+\w+/gi,                // set feedback off
        /set\s+echo\s+\w+/gi,                    // set echo off
        /set\s+verify\s+\w+/gi,                  // set verify off
        /var\s+(\w+)\s+(\w+)/gi,                 // var x VARCHAR2(10)
        /print\s+(\w+)/gi,                       // print x
        /exit\s*;?/gi,                           // exit
        /quit\s*;?/gi,                           // quit
        /BEGIN\s+[\s\S]*?END\s*;?/gi,            // PL/SQL blocks
        /SELECT\s+[\s\S]*?;?/gi,                 // SELECT statements
        /INSERT\s+[\s\S]*?;?/gi,                 // INSERT statements
        /UPDATE\s+[\s\S]*?;?/gi,                 // UPDATE statements
        /DELETE\s+[\s\S]*?;?/gi,                 // DELETE statements
        /CREATE\s+[\s\S]*?;?/gi,                 // CREATE statements
        /ALTER\s+[\s\S]*?;?/gi,                  // ALTER statements
        /DROP\s+[\s\S]*?;?/gi,                   // DROP statements
        /GRANT\s+[\s\S]*?;?/gi,                  // GRANT statements
        /REVOKE\s+[\s\S]*?;?/gi,                 // REVOKE statements
        /COMMIT\s*;?/gi,                         // COMMIT
        /ROLLBACK\s*;?/gi,                       // ROLLBACK
        /SAVEPOINT\s+[\s\S]*?;?/gi               // SAVEPOINT
      ],
      // Redshift SQL patterns
      redshift: [
        /psql\s+[^@]*@[^\s]+\s+-f\s+([^\s]+)/gi, // psql -h host -U user -d db -f script.sql
        /-f\s+([^\s]+\.sql)/gi,                   // -f script.sql
        /\\i\s+([^\s]+)/gi,                       // \i script.sql
        /\\o\s+([^\s]+)/gi,                       // \o filename
        /\\q/gi,                                  // \q (quit)
        /\\dt/gi,                                 // \dt (list tables)
        /\\d\s+([^\s]+)/gi,                       // \d table_name
        /COPY\s+[\s\S]*?;?/gi,                    // COPY statements
        /UNLOAD\s+[\s\s]*?;?/gi,                  // UNLOAD statements
        /VACUUM\s+[\s\S]*?;?/gi,                  // VACUUM statements
        /ANALYZE\s+[\s\S]*?;?/gi,                 // ANALYZE statements
        /SELECT\s+[\s\S]*?;?/gi,                  // SELECT statements
        /INSERT\s+[\s\S]*?;?/gi,                  // INSERT statements
        /UPDATE\s+[\s\S]*?;?/gi,                  // UPDATE statements
        /DELETE\s+[\s\S]*?;?/gi,                  // DELETE statements
        /CREATE\s+[\s\S]*?;?/gi,                  // CREATE statements
        /ALTER\s+[\s\S]*?;?/gi,                   // ALTER statements
        /DROP\s+[\s\S]*?;?/gi,                    // DROP statements
        /GRANT\s+[\s\S]*?;?/gi,                   // GRANT statements
        /REVOKE\s+[\s\S]*?;?/gi,                  // REVOKE statements
        /COMMIT\s*;?/gi,                          // COMMIT
        /ROLLBACK\s*;?/gi                         // ROLLBACK
      ],
      // General SQL patterns
      general: [
        /SELECT\s+[\s\S]*?;?/gi,                  // SELECT statements
        /INSERT\s+[\s\S]*?;?/gi,                  // INSERT statements
        /UPDATE\s+[\s\S]*?;?/gi,                  // UPDATE statements
        /DELETE\s+[\s\S]*?;?/gi,                  // DELETE statements
        /CREATE\s+[\s\S]*?;?/gi,                  // CREATE statements
        /ALTER\s+[\s\S]*?;?/gi,                   // ALTER statements
        /DROP\s+[\s\S]*?;?/gi,                    // DROP statements
        /GRANT\s+[\s\S]*?;?/gi,                   // GRANT statements
        /REVOKE\s+[\s\S]*?;?/gi,                  // REVOKE statements
        /COMMIT\s*;?/gi,                          // COMMIT
        /ROLLBACK\s*;?/gi,                        // ROLLBACK
        /SAVEPOINT\s+[\s\S]*?;?/gi                // SAVEPOINT
      ]
    };
  }

  summarizeBatchScriptContent(content, fileName) {
    const lines = content.split('\n').map(l => l.trim());
    const upper = content.toUpperCase();

    // Detect inputs/sources
    const sources = [];
    const logs = [];
    const controlFiles = [];
    const sqlFiles = [];
    const dataFiles = [];
    const referencedScripts = [];

    const pushUnique = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };

    for (const l of lines) {
      const mCtl = l.match(/Table_Management_Snapshots\.ctl|\b[^\s]+\.ctl\b/i);
      const mSql = l.match(/\b[^\s]+\.sql\b/i);
      const mCust = l.match(/\*\.CUST|[^\s]+\.CUST/i);
      const mLog = l.match(/\b[^\s]+\.log\b/i);
      const mCall = l.match(/call\s+(["']?[^\s"']+\.bat["']?)/i);

      if (mCtl) pushUnique(controlFiles, mCtl[0]);
      if (mSql) pushUnique(sqlFiles, mSql[0]);
      if (mCust) pushUnique(dataFiles, mCust[0]);
      if (mLog) pushUnique(logs, mLog[0]);
      if (mCall) pushUnique(referencedScripts, mCall[1].replace(/"/g, ''));
    }

    // Detect mechanism
    const usesSqlLoader = /SQLLDR|SQL\*LOADER/i.test(content);
    const usesSqlPlus = /SQLPLUS/i.test(content);

    // Infer target
    let target = '';
    if (/P_TMS_SNAPSHOTS/i.test(content)) target = 'Oracle Database — Table: DW.P_TMS_SNAPSHOTS';
    // Fallbacks
    if (!target && usesSqlLoader) target = 'Oracle Database — table(s) loaded via SQL*Loader';
    if (!target && usesSqlPlus) target = 'Oracle Database — objects referenced in SQL script(s)';

    // Build formatted markdown
    const srcParts = [];
    if (dataFiles.length) srcParts.push(`Input data files: ${dataFiles.join(', ')}`);
    if (controlFiles.length) srcParts.push(`Control file(s): ${controlFiles.join(', ')}`);
    if (sqlFiles.length) srcParts.push(`SQL script(s): ${sqlFiles.join(', ')}`);
    if (logs.length) srcParts.push(`Logs: ${logs.join(', ')}`);
    if (referencedScripts.length) srcParts.push(`Supporting scripts: ${referencedScripts.join(', ')}`);

    const mechParts = [];
    if (usesSqlLoader) mechParts.push('SQL*Loader (sqlldr) used to bulk load data');
    if (usesSqlPlus) mechParts.push('SQL*Plus executes SQL/PLSQL script(s) after load');

    const objective = this.inferObjective(usesSqlLoader, usesSqlPlus, dataFiles, sqlFiles);

    const md = [
      '---',
      '## 🔹 Batch File Summary',
      '',
      '### 1. Source File',
      srcParts.length ? srcParts.map(s => `- ${s}`).join('\n') : 'N/A',
      '',
      '### 2. Stored Procedure or SQL Statement or Loading Mechanism',
      mechParts.length ? mechParts.map(s => `- ${s}`).join('\n') : 'N/A',
      '',
      '### 3. Target',
      target || 'N/A',
      '',
      '### 4. Objective',
      objective,
      '---'
    ].join('\n');

    return md;
  }

  inferObjective(usesSqlLoader, usesSqlPlus, dataFiles, sqlFiles) {
    if (usesSqlLoader && usesSqlPlus) {
      return 'Load input data files via SQL*Loader, then execute SQL/PLSQL to finalize processing.';
    }
    if (usesSqlLoader) {
      return 'Bulk load input data files into Oracle using SQL*Loader.';
    }
    if (usesSqlPlus && sqlFiles.length) {
      return `Execute SQL script(s) (${sqlFiles.join(', ')}) against Oracle.`;
    }
    return 'Execute batch-driven database operations as defined in the script.';
  }

  async extractSQLFromBatchScript(scriptContent, scriptType = 'oracle') {
    try {
      const extractedSQL = [];
      const patterns = this.sqlPatterns[scriptType] || this.sqlPatterns.general;
      
      console.log(`Extracting SQL from ${scriptType} batch script...`);
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(scriptContent)) !== null) {
          const sqlStatement = match[0].trim();
          
          // Skip empty or very short statements
          if (sqlStatement.length < 10) continue;
          
          // Skip common non-SQL commands
          if (this.isNonSQLCommand(sqlStatement)) continue;
          
          extractedSQL.push({
            statement: sqlStatement,
            type: this.classifySQLStatement(sqlStatement),
            lineNumber: this.getLineNumber(scriptContent, match.index),
            context: this.getContext(scriptContent, match.index)
          });
        }
      }
      
      // Remove duplicates and sort by line number
      const uniqueSQL = this.removeDuplicateSQL(extractedSQL);
      uniqueSQL.sort((a, b) => a.lineNumber - b.lineNumber);
      
      console.log(`Extracted ${uniqueSQL.length} SQL statements from batch script`);
      
      return {
        totalStatements: uniqueSQL.length,
        statements: uniqueSQL,
        scriptType: scriptType
      };
      
    } catch (error) {
      console.error('Error extracting SQL from batch script:', error);
      throw new Error(`SQL extraction failed: ${error.message}`);
    }
  }

  isNonSQLCommand(statement) {
    const nonSQLCommands = [
      'set pages',
      'set feedback',
      'set echo',
      'set verify',
      'spool',
      'exit',
      'quit',
      '\\q',
      '\\dt',
      '\\o',
      '\\i',
      'var ',
      'print '
    ];
    
    const upperStatement = statement.toUpperCase();
    return nonSQLCommands.some(cmd => upperStatement.includes(cmd.toUpperCase()));
  }

  classifySQLStatement(statement) {
    const upperStatement = statement.toUpperCase();
    
    if (upperStatement.startsWith('SELECT')) return 'SELECT';
    if (upperStatement.startsWith('INSERT')) return 'INSERT';
    if (upperStatement.startsWith('UPDATE')) return 'UPDATE';
    if (upperStatement.startsWith('DELETE')) return 'DELETE';
    if (upperStatement.startsWith('CREATE')) return 'CREATE';
    if (upperStatement.startsWith('ALTER')) return 'ALTER';
    if (upperStatement.startsWith('DROP')) return 'DROP';
    if (upperStatement.startsWith('GRANT')) return 'GRANT';
    if (upperStatement.startsWith('REVOKE')) return 'REVOKE';
    if (upperStatement.startsWith('COMMIT')) return 'COMMIT';
    if (upperStatement.startsWith('ROLLBACK')) return 'ROLLBACK';
    if (upperStatement.startsWith('SAVEPOINT')) return 'SAVEPOINT';
    if (upperStatement.startsWith('BEGIN')) return 'PL/SQL_BLOCK';
    if (upperStatement.startsWith('COPY')) return 'COPY';
    if (upperStatement.startsWith('UNLOAD')) return 'UNLOAD';
    if (upperStatement.startsWith('VACUUM')) return 'VACUUM';
    if (upperStatement.startsWith('ANALYZE')) return 'ANALYZE';
    
    return 'UNKNOWN';
  }

  getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  getContext(content, index, contextLines = 2) {
    const lines = content.split('\n');
    const lineNumber = this.getLineNumber(content, index);
    const start = Math.max(0, lineNumber - contextLines - 1);
    const end = Math.min(lines.length, lineNumber + contextLines);
    
    return lines.slice(start, end).join('\n');
  }

  removeDuplicateSQL(extractedSQL) {
    const seen = new Set();
    return extractedSQL.filter(item => {
      const key = item.statement.toLowerCase().trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async processBatchScriptFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const fileName = path.basename(filePath);
      return await this.processBatchScriptContent(content, fileName);
    } catch (error) {
      console.error(`Error processing batch script file ${filePath}:`, error);
      return {
        fileName: path.basename(filePath),
        scriptType: 'unknown',
        extractionResult: null,
        idmcSummaries: [],
        success: false,
        error: error.message
      };
    }
  }

  async processBatchScriptContent(content, fileName, scriptType = null) {
    try {
      const fileExt = path.extname(fileName).toLowerCase();
      
      // Determine script type based on file extension and content
      let detectedScriptType = scriptType || 'general';
      if (!scriptType) {
        if (fileExt === '.bat' || fileExt === '.cmd') {
          if (content.includes('sqlplus') || content.includes('@') || content.includes('spool')) {
            detectedScriptType = 'oracle';
          }
        } else if (fileExt === '.sh' || fileExt === '.bash') {
          if (content.includes('psql') || content.includes('-f') || content.includes('\\i')) {
            detectedScriptType = 'redshift';
          }
        } else if (fileExt === '.sql') {
          // Check content for Oracle vs Redshift patterns
          if (content.includes('VARCHAR2') || content.includes('NUMBER') || content.includes('SYSDATE')) {
            detectedScriptType = 'oracle';
          } else if (content.includes('DISTKEY') || content.includes('SORTKEY') || content.includes('COPY')) {
            detectedScriptType = 'redshift';
          }
        } else {
          // No extension or unknown extension - detect from content
          if (content.includes('sqlplus') || content.includes('@') || content.includes('spool') || 
              content.includes('VARCHAR2') || content.includes('NUMBER') || content.includes('SYSDATE')) {
            detectedScriptType = 'oracle';
          } else if (content.includes('psql') || content.includes('-f') || content.includes('\\i') ||
                     content.includes('DISTKEY') || content.includes('SORTKEY') || content.includes('COPY')) {
            detectedScriptType = 'redshift';
          }
        }
      }
      
      console.log(`Processing batch script: ${fileName} (type: ${detectedScriptType})`);
      
      // Extract SQL statements
      const extractionResult = await this.extractSQLFromBatchScript(content, detectedScriptType);

      // Convert each SQL statement to IDMC summary
      const idmcSummaries = [];
      for (let i = 0; i < extractionResult.statements.length; i++) {
        const sqlStatement = extractionResult.statements[i];
        try {
          console.log(`Converting SQL statement ${i + 1}/${extractionResult.statements.length}: ${sqlStatement.type}`);
          
          let idmcSummary;
          if (detectedScriptType === 'redshift') {
            idmcSummary = await idmcConversionService.convertRedshiftToIDMC(
              sqlStatement.statement, 
              `${fileName}_statement_${i + 1}.sql`, 
              'sql'
            );
          } else {
            idmcSummary = await idmcConversionService.convertOracleToIDMC(
              sqlStatement.statement, 
              `${fileName}_statement_${i + 1}.sql`, 
              'sql'
            );
          }
          
          idmcSummaries.push({
            statement: sqlStatement.statement,
            type: sqlStatement.type,
            lineNumber: sqlStatement.lineNumber,
            idmcSummary: idmcSummary, // Store as markdown string, not JSON
            fileName: `${fileName}_statement_${i + 1}_IDMC_Summary.md`
          });
          
        } catch (error) {
          console.error(`Error converting SQL statement ${i + 1}:`, error);
          idmcSummaries.push({
            statement: sqlStatement.statement,
            type: sqlStatement.type,
            lineNumber: sqlStatement.lineNumber,
            idmcSummary: null,
            error: error.message,
            fileName: `${fileName}_statement_${i + 1}_IDMC_Summary.md`
          });
        }
      }
      
      // Fallback: If no SQL statements were found, still produce a high-level IDMC-style summary
      if (extractionResult.totalStatements === 0) {
        console.log('No SQL detected in batch script; generating orchestration-level IDMC summary');
        const md = this.summarizeBatchScriptContent(content, fileName);
        idmcSummaries.push({
          statement: null,
          type: 'BATCH_FLOW',
          lineNumber: null,
          idmcSummary: md,
          fileName: `${fileName}_IDMC_Summary.md`
        });
      }

      return {
        fileName: fileName,
        scriptType: detectedScriptType,
        extractionResult: extractionResult,
        idmcSummaries: idmcSummaries,
        success: true
      };
      
    } catch (error) {
      console.error(`Error processing batch script content for ${fileName}:`, error);
      return {
        fileName: fileName,
        scriptType: scriptType || 'unknown',
        extractionResult: null,
        idmcSummaries: [],
        success: false,
        error: error.message
      };
    }
  }

  async processBatchScriptDirectory(directoryPath) {
    try {
      const files = [];
      const results = [];
      
      // Find all batch script files
      await this.findBatchScriptFiles(directoryPath, files);
      
      console.log(`Found ${files.length} batch script files to process`);
      
      // Process each file
      for (const filePath of files) {
        const result = await this.processBatchScriptFile(filePath);
        results.push(result);
      }
      
      return {
        totalFiles: files.length,
        processedFiles: results.filter(r => r.success).length,
        failedFiles: results.filter(r => !r.success).length,
        results: results
      };
      
    } catch (error) {
      console.error('Error processing batch script directory:', error);
      throw new Error(`Batch script processing failed: ${error.message}`);
    }
  }

  async findBatchScriptFiles(directory, files) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      
      if (entry.isDirectory()) {
        await this.findBatchScriptFiles(fullPath, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.bat' || ext === '.cmd' || ext === '.sh' || ext === '.bash' || ext === '.sql') {
          files.push(fullPath);
        }
      }
    }
  }
}

module.exports = new BatchScriptService();
