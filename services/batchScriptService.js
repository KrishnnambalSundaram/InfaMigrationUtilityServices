const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');
const idmcConversionService = require('./idmcConversionService');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('services/batchScriptService');

class BatchScriptService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    if (this.apiKey) {
      this.openai = new OpenAI({
        apiKey: this.apiKey
      });
    }
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
        /CREATE\s+DATABASE\s+[\s\S]*?;?/gi,        // CREATE DATABASE statements
        /USE\s+[\s\S]*?;?/gi,                      // USE statements
        /SELECT\s+[\s\S]*?;?/gi,                   // SELECT statements
        /INSERT\s+[\s\S]*?;?/gi,                   // INSERT statements
        /UPDATE\s+[\s\S]*?;?/gi,                   // UPDATE statements
        /DELETE\s+[\s\S]*?;?/gi,                   // DELETE statements
        /CREATE\s+[\s\S]*?;?/gi,                   // CREATE statements
        /ALTER\s+[\s\S]*?;?/gi,                    // ALTER statements
        /DROP\s+[\s\S]*?;?/gi,                     // DROP statements
        /GRANT\s+[\s\S]*?;?/gi,                    // GRANT statements
        /REVOKE\s+[\s\S]*?;?/gi,                   // REVOKE statements
        /COMMIT\s*;?/gi,                           // COMMIT
        /ROLLBACK\s*;?/gi,                         // ROLLBACK
        /SAVEPOINT\s+[\s\S]*?;?/gi                 // SAVEPOINT
      ]
    };
  }

  summarizeBatchScriptContent(content, fileName) {
    const lines = content.split('\n').map(l => l.trim());
    const upper = content.toUpperCase();

    // Check if this is a pure SQL file
    const isPureSQL = this.isPureSQLFile(content);
    
    if (isPureSQL) {
      return this.summarizePureSQLFile(content, fileName);
    }

    // Check if this is an Informatica IICS workflow execution script
    const isIICSScript = this.isIICSScript(content);
    
    if (isIICSScript) {
      return this.summarizeIICSScript(content, fileName);
    }

    // Detect inputs/sources (for batch scripts)
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

  summarizePureSQLFile(content, fileName) {
    const upper = content.toUpperCase();
    
    // Extract table names from CREATE TABLE statements
    const tableMatches = content.match(/CREATE\s+TABLE\s+(\w+)/gi) || [];
    const tables = tableMatches.map(m => m.replace(/CREATE\s+TABLE\s+/i, '').trim()).filter(Boolean);
    
    // Extract database/schema name from CREATE DATABASE/USE statements
    const dbMatch = content.match(/CREATE\s+DATABASE\s+(\w+)/i);
    const useMatch = content.match(/USE\s+(\w+)/i);
    const dbName = (dbMatch && dbMatch[1]) || (useMatch && useMatch[1]) || null;
    
    // Detect statement types
    const hasCreateTable = /CREATE\s+TABLE/i.test(content);
    const hasInsert = /INSERT\s+INTO/i.test(content);
    const hasSelect = /SELECT\s+.*\s+FROM/i.test(content);
    const hasCreateDatabase = /CREATE\s+DATABASE/i.test(content);
    
    // Detect target database type
    let targetDb = 'Database';
    if (content.includes('AUTO_INCREMENT')) targetDb = 'MySQL Database';
    else if (upper.includes('VARCHAR2') || upper.includes('NUMBER')) targetDb = 'Oracle Database';
    else if (upper.includes('IDENTITY') || upper.includes('GO')) targetDb = 'SQL Server Database';
    else if (upper.includes('DISTKEY') || upper.includes('SORTKEY')) targetDb = 'Redshift Database';
    else if (upper.includes('SERIAL')) targetDb = 'PostgreSQL Database';
    
    // Extract source information
    const srcParts = [];
    if (dbName) srcParts.push(`Database/Schema: ${dbName}`);
    if (tables.length > 0) {
      srcParts.push(`Tables created: ${tables.slice(0, 5).join(', ')}${tables.length > 5 ? '...' : ''}`);
    }
    
    // Detect operations
    const mechParts = [];
    if (hasCreateDatabase) mechParts.push('Creates database/schema');
    if (hasCreateTable) mechParts.push('Creates table structures');
    if (hasInsert) mechParts.push('Inserts sample/seed data');
    if (hasSelect) mechParts.push('Defines query operations');
    
    // Infer objective
    let objective = 'Execute database schema creation and data operations.';
    if (hasCreateDatabase && hasCreateTable && hasInsert) {
      objective = 'Create database schema, define tables, and populate with initial data.';
    } else if (hasCreateTable && hasInsert) {
      objective = 'Create table structures and insert data.';
    } else if (hasCreateTable) {
      objective = 'Define database table structures.';
    } else if (hasInsert) {
      objective = 'Insert data into database tables.';
    } else if (hasSelect) {
      objective = 'Perform data query operations.';
    }
    
    const md = [
      '---',
      '## 🔹 Batch File Summary',
      '',
      '### 1. Source File',
      srcParts.length ? srcParts.map(s => `- ${s}`).join('\n') : `SQL Script: ${fileName}`,
      '',
      '### 2. Stored Procedure or SQL Statement or Loading Mechanism',
      mechParts.length ? mechParts.map(s => `- ${s}`).join('\n') : 'Direct SQL execution',
      '',
      '### 3. Target',
      dbName ? `${targetDb} — ${dbName}` : targetDb,
      '',
      '### 4. Objective',
      objective,
      '---'
    ].join('\n');

    return md;
  }

  // Check if content is an Informatica IICS workflow execution script
  isIICSScript(content) {
    const upper = content.toUpperCase();
    return (
      upper.includes('RUNDAJOB') ||
      upper.includes('RUNDAJOB CLI') ||
      upper.includes('INFORMATICA_IICS') ||
      upper.includes('INFAAGENT') ||
      (upper.includes('CLI.SH') && (upper.includes('-UN') || upper.includes('-FP') || upper.includes('-T'))) ||
      upper.includes('IICS')
    );
  }

  // Summarize Informatica IICS workflow execution script
  summarizeIICSScript(content, fileName) {
    const lines = content.split('\n');
    const upper = content.toUpperCase();
    
    // Extract workflow parameters
    const workflowParams = {
      folderName: null,
      workflowName: null,
      taskType: null,
      waitParam: null,
      cliPath: null
    };
    
    // Look for parameter assignments (bash variables)
    const paramMap = {};
    for (const line of lines) {
      // Extract folderName from $1 or folderName=$1
      if (/folderName\s*=\s*\$?1\b/.test(line)) {
        paramMap.folderName = '$1';
        workflowParams.folderName = '$1';
      }
      // Extract workflowName from $2 or workflowName=$2
      if (/workflowName\s*=\s*\$?2\b/.test(line)) {
        paramMap.workflowName = '$2';
        workflowParams.workflowName = '$2';
      }
      // Extract taskType from $3 or Tasktype=$3
      if (/tasktype\s*=\s*\$?3\b/i.test(line) || /taskType\s*=\s*\$?3\b/.test(line)) {
        paramMap.taskType = '$3';
        workflowParams.taskType = '$3';
      }
      // Extract waitParam from $4 or waitParam=$4
      if (/waitParam\s*=\s*\$?4\b/.test(line)) {
        paramMap.waitParam = '$4';
        workflowParams.waitParam = '$4';
      }
    }
    
    // Look for CLI command parameters
    for (const line of lines) {
      // Extract -fp (folder path)
      const fpMatch = line.match(/-fp\s+(\S+)/i);
      if (fpMatch) {
        const fpValue = fpMatch[1];
        if (/\$folderName|\$\{folderName\}/.test(fpValue)) {
          workflowParams.folderName = paramMap.folderName || '$folderName';
        } else if (!workflowParams.folderName) {
          workflowParams.folderName = fpValue;
        }
      }
      
      // Extract -un (workflow name)
      const unMatch = line.match(/-un\s+(\S+)/i);
      if (unMatch) {
        const unValue = unMatch[1];
        if (/\$workflowName|\$\{workflowName\}/.test(unValue)) {
          workflowParams.workflowName = paramMap.workflowName || '$workflowName';
        } else if (!workflowParams.workflowName) {
          workflowParams.workflowName = unValue;
        }
      }
      
      // Extract -t (task type)
      const tMatch = line.match(/-t\s+(\S+)/i);
      if (tMatch) {
        const tValue = tMatch[1];
        if (/\$Tasktype|\$\{Tasktype\}|\$taskType/.test(tValue)) {
          workflowParams.taskType = paramMap.taskType || '$Tasktype';
        } else if (!workflowParams.taskType) {
          workflowParams.taskType = tValue;
        }
      }
      
      // Extract CLI path
      const cliMatch = line.match(/(\/[^\s]+\/cli\.sh)/i);
      if (cliMatch) {
        workflowParams.cliPath = cliMatch[1];
      }
    }
    
    // Extract Informatica IICS agent path if present
    const agentPathMatch = content.match(/(\/[^\s]+\/infaagent)/i);
    const agentPath = agentPathMatch ? agentPathMatch[1] : null;
    const cliDirectory = agentPath ? `${agentPath}/apps/runAJobCli` : '/u01/local/Informatica_IICS/infaagent/apps/runAJobCli';
    
    // Detect wait mode and error handling
    const hasNowait = /nowait/i.test(content);
    const hasConditionalWait = /if\s+\[.*waitParam.*nowait/i.test(content);
    const hasErrorHandling = /\$\?\s*-\w+\s*\d+/.test(content) || /exit\s+\d+/.test(content);
    const hasExitCodeCheck = /if\s+\[.*\$\?.*\]/.test(content);
    
    // Extract error handling details - look for patterns like "$? -ne 0 -a $? -ne 6"
    const acceptedExitCodes = [];
    // Pattern 1: "$? -ne 0 -a $? -ne 6" - means exit codes 0 and 6 are accepted
    const nePattern = content.match(/\$\?\s*-ne\s*(\d+)(?:\s*-a\s*\$\?\s*-ne\s*(\d+))?/i);
    if (nePattern) {
      // If it's "not equal to 0 AND not equal to 6", then 0 and 6 are the accepted codes
      if (nePattern[1] === '0' && nePattern[2]) {
        acceptedExitCodes.push('0', nePattern[2]);
      } else {
        // Otherwise, track what codes are NOT accepted
        acceptedExitCodes.push('0'); // 0 is always success
      }
    }
    // Pattern 2: Look for explicit exit code checks
    const explicitCodes = content.match(/\$\?\s*-\w+\s*(\d+)/g);
    if (explicitCodes && acceptedExitCodes.length === 0) {
      explicitCodes.forEach(m => {
        const code = m.match(/(\d+)/);
        if (code) {
          const codeNum = code[1];
          // If it's "-ne 6", then 6 is an accepted code
          if (m.includes('-ne') && codeNum !== '0') {
            if (!acceptedExitCodes.includes(codeNum)) {
              acceptedExitCodes.push(codeNum);
            }
          }
        }
      });
    }
    // Always include 0 as success
    if (acceptedExitCodes.length === 0) {
      acceptedExitCodes.push('0');
    }
    
    // Build detailed markdown
    const md = [
      '🧩 IDMC Mapping Summary',
      '',
      '',
      '## 1. Objective',
      '',
      hasConditionalWait
        ? `This Bash script automates the process of triggering an Informatica IICS (Intelligent Data Management Cloud) workflow using the command-line interface (cli.sh). It supports both wait and no-wait execution modes based on the wait parameter.`
        : hasNowait
        ? `This Bash script automates the process of triggering an Informatica IICS (Intelligent Data Management Cloud) workflow using the command-line interface (cli.sh). It executes workflows asynchronously without waiting for completion.`
        : `This Bash script automates the process of triggering an Informatica IICS (Intelligent Data Management Cloud) workflow using the command-line interface (cli.sh). It executes workflows and waits for completion.`,
      '',
      '',
      '## 2. Input Parameters',
      '',
      '| Parameter | Description | Example |',
      '|-----------|-------------|---------|',
      workflowParams.folderName 
        ? `| folderName | The IICS folder path where the workflow resides | ${workflowParams.folderName.includes('$') ? '/Finance/ETL/CustomerJobs' : workflowParams.folderName} |`
        : '| folderName | The IICS folder path where the workflow resides | /Finance/ETL/CustomerJobs |',
      workflowParams.workflowName
        ? `| workflowName | The name of the workflow or task to trigger | ${workflowParams.workflowName.includes('$') ? 'LoadCustomerData' : workflowParams.workflowName} |`
        : '| workflowName | The name of the workflow or task to trigger | LoadCustomerData |',
      workflowParams.taskType
        ? `| Tasktype | The type of IICS object to execute (e.g., mapping, taskflow) | ${workflowParams.taskType.includes('$') ? 'taskflow' : workflowParams.taskType} |`
        : '| Tasktype | The type of IICS object to execute (e.g., mapping, taskflow) | taskflow |',
      hasConditionalWait
        ? `| waitParam | Optional parameter to specify execution mode: nowait (asynchronous) or default (wait until completion) | nowait |`
        : hasNowait
        ? '| waitParam | Execution mode parameter: nowait (asynchronous) | nowait |'
        : '| waitParam | (Not used in this script) | - |',
      '',
      '',
      '## 3. Process Flow',
      '',
      '| Step | Description |',
      '|------|-------------|',
      '| 1 | The script accepts 4 arguments (folder name, workflow name, task type, and wait parameter). |',
      hasConditionalWait
        ? '| 2 | It checks if the fourth argument equals "nowait". |'
        : '| 2 | It processes the workflow execution parameters. |',
      hasConditionalWait
        ? '| 3 | If "nowait", the script runs the IICS CLI with the `-w nowait` flag to trigger the job asynchronously. |'
        : hasNowait
        ? '| 3 | The script runs the IICS CLI with the `-w nowait` flag to trigger the job asynchronously. |'
        : '| 3 | The script runs the IICS CLI to trigger the job and waits for completion. |',
      hasErrorHandling && hasExitCodeCheck && acceptedExitCodes.length > 1
        ? `| 4 | If the exit code is not 0${acceptedExitCodes.filter(c => c !== '0').length > 0 ? ` or ${acceptedExitCodes.filter(c => c !== '0').join('/')}` : ''}, the script terminates with an error. |`
        : hasErrorHandling && hasExitCodeCheck
        ? '| 4 | If the exit code indicates failure, the script terminates with an error. |'
        : hasErrorHandling
        ? '| 4 | The script checks the exit status and handles errors accordingly. |'
        : '| 4 | The script executes the workflow trigger command. |',
      hasConditionalWait
        ? '| 5 | Otherwise, if waitParam is not "nowait", it triggers the job normally and waits for completion. |'
        : '| 5 | The workflow execution completes with appropriate exit codes. |',
      '',
      '',
      '## 4. Key Commands Used',
      '',
      '| Command | Description |',
      '|---------|-------------|',
      `| \`cd ${cliDirectory}\` | Navigates to the CLI tool directory. |`,
      hasConditionalWait || hasNowait
        ? `| \`sh -x cli.sh runAJobCli -t $${workflowParams.taskType || 'Tasktype'} -un $${workflowParams.workflowName || 'workflowName'} -fp $${workflowParams.folderName || 'folderName'} -w nowait\` | Executes the workflow asynchronously. |`
        : `| \`sh -x cli.sh runAJobCli -t $${workflowParams.taskType || 'Tasktype'} -un $${workflowParams.workflowName || 'workflowName'} -fp $${workflowParams.folderName || 'folderName'} -w nowait\` | Executes the workflow asynchronously (if nowait is specified). |`,
      hasConditionalWait
        ? `| \`sh -x cli.sh runAJobCli -t $${workflowParams.taskType || 'Tasktype'} -un $${workflowParams.workflowName || 'workflowName'} -fp $${workflowParams.folderName || 'folderName'}\` | Executes the workflow synchronously (waits for completion). |`
        : '',
      '',
      '',
      '## 5. Error Handling',
      '',
      hasErrorHandling && hasExitCodeCheck
        ? acceptedExitCodes.length > 1
          ? `The script checks the exit status ($?) of the CLI execution.\n\nIf the return code is neither 0 (success) nor ${acceptedExitCodes.filter(c => c !== '0').join('/')} (accepted conditions), the script exits with code 1.\n\nThis ensures failed or invalid workflow triggers are detected.`
          : `The script checks the exit status ($?) of the CLI execution.\n\nIf the return code is not 0 (success), the script exits with code 1.\n\nThis ensures failed or invalid workflow triggers are detected.`
        : hasErrorHandling
        ? 'The script monitors the exit status of the CLI execution and handles errors appropriately.'
        : 'The script executes the workflow trigger without explicit error handling.',
      '',
      '',
      '## 6. Output / Expected Results',
      '',
      '| Mode | Description |',
      '|------|-------------|',
      hasConditionalWait || hasNowait
        ? '| nowait | The script immediately exits after triggering the job. The workflow continues in the background. |'
        : '',
      hasConditionalWait
        ? '| default | The script waits for the job to complete before exiting. |'
        : !hasNowait
        ? '| wait | The script waits for the job to complete before exiting. |'
        : '',
      '| Exit Code 0 | Successful trigger. |',
      acceptedExitCodes.includes('6')
        ? '| Exit Code 6 | Workflow already running (non-fatal). |'
        : '',
      hasErrorHandling
        ? '| Exit Code 1 | Error occurred during trigger. |'
        : '',
      '',
      '',
      '## 7. Example Execution',
      '',
      '```bash',
      `./${fileName || 'triggerWorkflow.sh'} ${workflowParams.folderName && !workflowParams.folderName.includes('$') ? workflowParams.folderName : '/Finance/ETL'} ${workflowParams.workflowName && !workflowParams.workflowName.includes('$') ? workflowParams.workflowName : 'LoadCustomerData'} ${workflowParams.taskType && !workflowParams.taskType.includes('$') ? workflowParams.taskType : 'taskflow'}${hasConditionalWait || hasNowait ? ' nowait' : ''}`,
      '```',
      '',
      'Expected Output:',
      '',
      '```',
      hasConditionalWait || hasNowait
        ? `+ sh -x cli.sh runAJobCli -t ${workflowParams.taskType && !workflowParams.taskType.includes('$') ? workflowParams.taskType : 'taskflow'} -un ${workflowParams.workflowName && !workflowParams.workflowName.includes('$') ? workflowParams.workflowName : 'LoadCustomerData'} -fp ${workflowParams.folderName && !workflowParams.folderName.includes('$') ? workflowParams.folderName : '/Finance/ETL'} -w nowait\n\nTriggering IICS workflow '${workflowParams.workflowName && !workflowParams.workflowName.includes('$') ? workflowParams.workflowName : 'LoadCustomerData'}' in folder '${workflowParams.folderName && !workflowParams.folderName.includes('$') ? workflowParams.folderName : '/Finance/ETL'}' (asynchronous)\n\nJob submitted successfully.`
        : `+ sh -x cli.sh runAJobCli -t ${workflowParams.taskType && !workflowParams.taskType.includes('$') ? workflowParams.taskType : 'taskflow'} -un ${workflowParams.workflowName && !workflowParams.workflowName.includes('$') ? workflowParams.workflowName : 'LoadCustomerData'} -fp ${workflowParams.folderName && !workflowParams.folderName.includes('$') ? workflowParams.folderName : '/Finance/ETL'}\n\nTriggering IICS workflow '${workflowParams.workflowName && !workflowParams.workflowName.includes('$') ? workflowParams.workflowName : 'LoadCustomerData'}' in folder '${workflowParams.folderName && !workflowParams.folderName.includes('$') ? workflowParams.folderName : '/Finance/ETL'}' (synchronous)\n\nJob completed successfully.`,
      '```',
      ''
    ].filter(line => line !== '').join('\n');

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
      
      log.info(`Extracting SQL from ${scriptType} batch script...`);
      
      // First, try to extract SQL statements using a smarter approach for pure SQL files
      // Check if this looks like a pure SQL file (not a batch script)
      const isPureSQLFile = this.isPureSQLFile(scriptContent);
      
      if (isPureSQLFile) {
        log.info('Detected pure SQL file - using statement splitting approach');
        const statements = this.extractSQLStatements(scriptContent);
        
        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i];
          if (stmt.trim().length < 10) continue;
          if (this.isNonSQLCommand(stmt)) continue;
          
          extractedSQL.push({
            statement: stmt.trim(),
            type: this.classifySQLStatement(stmt),
            lineNumber: this.getStatementLineNumber(scriptContent, stmt, i),
            context: this.getStatementContext(scriptContent, stmt)
          });
        }
      } else {
        // Use regex patterns for batch scripts
        for (const pattern of patterns) {
          let match;
          // Reset regex lastIndex to avoid issues with global regex
          pattern.lastIndex = 0;
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
      }
      
      // Remove duplicates and sort by line number
      const uniqueSQL = this.removeDuplicateSQL(extractedSQL);
      uniqueSQL.sort((a, b) => a.lineNumber - b.lineNumber);
      
      log.info(`Extracted ${uniqueSQL.length} SQL statements from batch script`);
      
      return {
        totalStatements: uniqueSQL.length,
        statements: uniqueSQL,
        scriptType: scriptType
      };
      
    } catch (error) {
      log.error('Error extracting SQL from batch script', { error: error.message, stack: error.stack });
      throw new Error(`SQL extraction failed: ${error.message}`);
    }
  }

  // Check if content is a pure SQL file (not a batch script)
  isPureSQLFile(content) {
    const upper = content.toUpperCase();
    // If it has batch script indicators, it's not pure SQL
    const hasBatchIndicators = (
      upper.includes('SQLPLUS') || 
      upper.includes('SQL*LOADER') || 
      upper.includes('SQLLDR') ||
      upper.includes('PSQL') ||
      /^\s*@\s*\w+/.test(content) || // @script.sql pattern
      /^\s*SPOOL\s+/im.test(content) ||
      /^\s*SET\s+PAGES/im.test(content)
    );
    
    // If it has SQL statements but no batch indicators, it's likely pure SQL
    const hasSQLStatements = (
      /CREATE\s+(DATABASE|SCHEMA|TABLE|VIEW|INDEX|SEQUENCE|PROCEDURE|FUNCTION|TRIGGER)/i.test(content) ||
      /INSERT\s+INTO/i.test(content) ||
      /SELECT\s+.*\s+FROM/i.test(content) ||
      /UPDATE\s+.*\s+SET/i.test(content) ||
      /DELETE\s+FROM/i.test(content)
    );
    
    return hasSQLStatements && !hasBatchIndicators;
  }

  // Extract SQL statements by splitting on semicolons (handling multi-line)
  extractSQLStatements(content) {
    const statements = [];
    let currentStatement = '';
    let inString = false;
    let stringChar = null;
    let inComment = false;
    let commentType = null; // '--' or '/*'
    
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let i_char = 0;
      
      while (i_char < line.length) {
        const char = line[i_char];
        const nextChar = i_char < line.length - 1 ? line[i_char + 1] : '';
        const twoChars = char + nextChar;
        
        // Handle comments
        if (!inString && !inComment) {
          if (twoChars === '--') {
            // Single-line comment, skip rest of line
            currentStatement += ' ';
            break;
          } else if (twoChars === '/*') {
            inComment = true;
            commentType = '/*';
            currentStatement += ' ';
            i_char += 2;
            continue;
          }
        }
        
        // Handle comment end
        if (inComment && commentType === '/*' && twoChars === '*/') {
          inComment = false;
          commentType = null;
          currentStatement += ' ';
          i_char += 2;
          continue;
        }
        
        // Skip characters inside comments
        if (inComment) {
          currentStatement += ' ';
          i_char++;
          continue;
        }
        
        // Handle strings
        if ((char === '"' || char === "'") && !inComment) {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            // Check for escaped quote
            if (i_char > 0 && line[i_char - 1] === '\\') {
              // Escaped quote, continue
            } else {
              inString = false;
              stringChar = null;
            }
          }
        }
        
        // Handle statement termination
        if (!inString && char === ';') {
          currentStatement += char;
          const trimmed = currentStatement.trim();
          if (trimmed.length > 0) {
            statements.push(trimmed);
          }
          currentStatement = '';
          i_char++;
          continue;
        }
        
        currentStatement += char;
        i_char++;
      }
      
      // Add newline unless we're at the end
      if (i < lines.length - 1) {
        currentStatement += '\n';
      }
    }
    
    // Add final statement if it exists (might not end with semicolon)
    const trimmed = currentStatement.trim();
    if (trimmed.length > 0) {
      statements.push(trimmed);
    }
    
    return statements.filter(s => s.length > 0);
  }

  getStatementLineNumber(content, statement, index) {
    // Find the first occurrence of the statement in the content
    const normalizedContent = content.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const normalizedStatement = statement.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const firstLine = normalizedStatement.split('\n')[0].trim();
    
    const lines = normalizedContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstLine.substring(0, Math.min(30, firstLine.length)))) {
        return i + 1;
      }
    }
    return index + 1;
  }

  getStatementContext(content, statement) {
    const lines = content.split('\n');
    const stmtLines = statement.split('\n');
    const firstLineText = stmtLines[0].trim();
    
    // Find the line number where statement starts
    let startLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(firstLineText.substring(0, Math.min(30, firstLineText.length)))) {
        startLine = i;
        break;
      }
    }
    
    const contextLines = 2;
    const start = Math.max(0, startLine - contextLines);
    const end = Math.min(lines.length, startLine + stmtLines.length + contextLines);
    
    return lines.slice(start, end).join('\n');
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
    const upperStatement = statement.toUpperCase().trim();
    
    if (upperStatement.startsWith('SELECT')) return 'SELECT';
    if (upperStatement.startsWith('INSERT')) return 'INSERT';
    if (upperStatement.startsWith('UPDATE')) return 'UPDATE';
    if (upperStatement.startsWith('DELETE')) return 'DELETE';
    if (upperStatement.startsWith('CREATE DATABASE')) return 'CREATE_DATABASE';
    if (upperStatement.startsWith('CREATE TABLE')) return 'CREATE_TABLE';
    if (upperStatement.startsWith('CREATE VIEW')) return 'CREATE_VIEW';
    if (upperStatement.startsWith('CREATE INDEX')) return 'CREATE_INDEX';
    if (upperStatement.startsWith('CREATE PROCEDURE')) return 'CREATE_PROCEDURE';
    if (upperStatement.startsWith('CREATE FUNCTION')) return 'CREATE_FUNCTION';
    if (upperStatement.startsWith('CREATE TRIGGER')) return 'CREATE_TRIGGER';
    if (upperStatement.startsWith('CREATE SCHEMA')) return 'CREATE_SCHEMA';
    if (upperStatement.startsWith('CREATE')) return 'CREATE';
    if (upperStatement.startsWith('USE ')) return 'USE';
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
      const result = await this.processBatchScriptContent(content, fileName);
      return { ...result, originalContent: content };
    } catch (error) {
      console.error(`Error processing batch script file ${filePath}:`, error);
      return {
        fileName: path.basename(filePath),
        scriptType: 'unknown',
        extractionResult: null,
        idmcSummaries: [],
        originalContent: null,
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
        if (fileExt === '.bat') {
          // Windows batch scripts - often Oracle-related
          if (content.includes('sqlplus') || content.includes('@') || content.includes('spool')) {
            detectedScriptType = 'oracle';
          }
        } else if (fileExt === '.sh' || fileExt === '.ksh') {
          // Shell scripts (.sh, .ksh) - can be Redshift or general
          if (content.includes('psql') || content.includes('-f') || content.includes('\\i')) {
            detectedScriptType = 'redshift';
          }
        } else if (fileExt === '.py') {
          // Python scripts - detect from content (could be Oracle, Redshift, or general)
          if (content.includes('sqlplus') || content.includes('VARCHAR2') || content.includes('NUMBER') || content.includes('SYSDATE')) {
            detectedScriptType = 'oracle';
          } else if (content.includes('psql') || content.includes('DISTKEY') || content.includes('SORTKEY') || content.includes('COPY')) {
            detectedScriptType = 'redshift';
          }
          // Otherwise remains 'general'
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
      
      log.info(`Processing batch script: ${fileName} (type: ${detectedScriptType})`);
      
      // Use the generic convertToIDMC method - it handles all file types including batch scripts
      // This approach passes the entire file to OpenAI, which provides better analysis
      log.info(`Converting batch script to IDMC using generic converter: ${fileName}`);
      
      let idmcSummary;
      try {
        // Determine file extension for file type
        const fileExt = path.extname(fileName).toLowerCase();
        const fileType = fileExt.replace('.', '') || 'txt';
        
        // Use the generic conversion method that works for any file type
        idmcSummary = await idmcConversionService.convertToIDMC(content, fileName, fileType);
        
        log.info(`✅ Successfully converted ${fileName} to IDMC summary`);
      } catch (error) {
        log.error(`Error converting ${fileName} to IDMC`, { error: error.message, stack: error.stack });
        // Fallback: Generate a basic summary if OpenAI conversion fails
        idmcSummary = this.summarizeBatchScriptContent(content, fileName);
        log.warn(`Used fallback summary for ${fileName}`);
      }

      // Extract the main IDMC summary for convertedContent field
      const mainIdmcSummary = idmcSummary || '';
      
      const idmcSummariesArray = [{
        statement: null,
        type: 'BATCH_SCRIPT',
        lineNumber: null,
        idmcSummary: idmcSummary,
        fileName: `${fileName}_IDMC_Summary.md`
      }];
      
      return {
        fileName: fileName,
        scriptType: detectedScriptType,
        extractionResult: { totalStatements: 0, statements: [] },
        idmcSummaries: idmcSummariesArray,
        originalContent: content, // ✅ Original file content
        convertedContent: mainIdmcSummary, // ✅ Converted content for UI consistency (matches Oracle to Snowflake pattern)
        success: true
      };
      
    } catch (error) {
      log.error(`Error processing batch script content for ${fileName}`, { error: error.message, stack: error.stack });
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
        // Supported extensions: .bat, .sh, .ksh, and optionally .py
        if (ext === '.bat' || ext === '.sh' || ext === '.ksh' || ext === '.py') {
          files.push(fullPath);
        }
      }
    }
  }

  // Generate human-readable summary for batch scripts (separate from IDMC format)
  async generateHumanReadableSummary(content, fileName) {
    // Use OpenAI-based generic method for all file types
    if (this.apiKey && this.openai) {
      try {
        log.info(`Generating human-readable summary using OpenAI for: ${fileName}`);
        return await this.generateHumanReadableSummaryWithOpenAI(content, fileName);
      } catch (error) {
        log.error(`OpenAI generation failed, falling back to basic summary`, { error: error.message });
        // Fallback to basic summary
        return this.generateGenericHumanReadableSummary(content, fileName);
      }
    } else {
      log.warn('OpenAI API key not configured, using basic summary');
      // Fallback to basic summary if OpenAI not available
      return this.generateGenericHumanReadableSummary(content, fileName);
    }
  }

  /**
   * Generic method to generate human-readable summary using OpenAI
   * Works for any file type (batch scripts, SQL, shell scripts, etc.)
   */
  async generateHumanReadableSummaryWithOpenAI(content, fileName) {
    try {
      if (!this.apiKey || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      // Determine file type from extension
      const fileExt = path.extname(fileName).toLowerCase().replace('.', '') || 'txt';
      
      const systemPrompt = `You are an expert in DevOps, shell scripting, ETL (Informatica/Oracle), and software development.

I will provide you with code (which could be a shell script, batch file, SQL script, Python script, Node.js script, or any automation/data processing code).

Your task is to generate a professional, structured summary with the following format:

## 🧩 <File Name> Summary

### 🎯 Objective

(A clear 2–3 sentence explanation of what the code does.)

### 🔹 Key Components

(Describe the major files, variables, tools, and paths used in a markdown table.)

### 🔹 Script Flow

(A step-by-step explanation of how the code executes, including condition checks, commands, and logic flow.)

### 🔹 Key Notes

(Highlight special behaviors, command options, or error handling.)

### 🧠 In Short

(A one-line simplified explanation of what the code automates or achieves.)

---

**Rules:**

- Keep the explanation simple, professional, and formatted in Markdown.
- Use code blocks for small SQL, shell, or command examples when relevant.
- Include tables for clarity.
- Avoid repeating file paths unnecessarily.
- Analyze the ENTIRE code thoroughly - don't just skim the surface.
- For batch scripts: Explain how scripts call other scripts, how database clients are invoked, how parameters are passed, etc.
- For SQL scripts: Explain stored procedures, functions, tables, and business logic.
- For any code: Identify ALL dependencies, inputs, outputs, and the complete flow.
- Be detailed and comprehensive - the summary should help someone understand or maintain the code.`;

      const userPrompt = `Analyze the following code and generate a human-readable summary using the format specified above.

File Name: ${fileName}
File Type: ${fileExt}

Code Content:
\`\`\`${fileExt}
${content}
\`\`\`

Please provide a comprehensive summary that follows the exact format specified above. Analyze the entire code thoroughly and provide detailed information for all sections.`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2000
      });

      const summary = response.choices[0].message.content.trim();
      
      return summary;

    } catch (error) {
      log.error('Error generating human-readable summary with OpenAI:', error);
      throw new Error(`Human-readable summary generation failed: ${error.message}`);
    }
  }

  // Generate human-readable summary for IICS scripts
  generateIICSHumanReadableSummary(content, fileName) {
    // Extract parameters
    const params = [];
    const folderMatch = content.match(/folderName\s*=\s*\$?1\b/i);
    const workflowMatch = content.match(/workflowName\s*=\s*\$?2\b/i);
    const taskMatch = content.match(/tasktype\s*=\s*\$?3\b/i);
    const waitMatch = content.match(/waitParam\s*=\s*\$?4\b/i);

    if (folderMatch) params.push({ param: '$1', desc: 'Folder name in IICS where the workflow/task resides' });
    if (workflowMatch) params.push({ param: '$2', desc: 'Workflow (or task) name to be executed' });
    if (taskMatch) params.push({ param: '$3', desc: 'Task type (e.g., Mapping, Taskflow, etc.)' });
    if (waitMatch) params.push({ param: '$4', desc: 'Wait parameter — determines whether to wait for completion or not (nowait or default wait mode)' });

    // Extract CLI path
    const cliPathMatch = content.match(/(\/[^\s]+\/infaagent\/apps\/runAJobCli)/i);
    const cliPath = cliPathMatch ? cliPathMatch[1] : '/u01/local/Informatica_IICS/infaagent/apps/runAJobCli';

    // Detect wait mode
    const hasConditionalWait = /if\s+\[.*waitParam.*nowait/i.test(content);
    const hasNowait = /nowait/i.test(content);
    const hasErrorHandling = /\$\?\s*-ne\s*0/i.test(content);

    // Extract error handling
    const exitCodeMatch = content.match(/\$\?\s*-ne\s*(\d+)\s*-a\s*\$\?\s*-ne\s*(\d+)/i);
    const hasExitCode6 = exitCodeMatch && (exitCodeMatch[2] === '6' || exitCodeMatch[1] === '6');

    const md = [
      '🧩 Script Summary: IICS Workflow Trigger Script',
      '',
      '',
      '## Objective',
      '',
      'This script triggers a workflow (or task) in Informatica Intelligent Cloud Services (IICS) using the runAJobCli command-line utility.',
      '',
      '',
      '## 🔹 Parameters',
      '',
      '| Parameter | Description |',
      '|-----------|-------------|',
      ...params.map(p => `| ${p.param} | ${p.desc} |`),
      '',
      '',
      '## 🔹 Script Flow',
      '',
      '### Read Input Parameters',
      '',
      `Accepts ${params.map(p => p.param).join(', ')} from command-line arguments.`,
      '',
      '',
      '### Navigate to the CLI Directory',
      '',
      `Moves to the IICS agent directory:\n\n\`${cliPath}\``,
      '',
      '',
      '### Run Workflow Based on Wait Mode',
      '',
      hasConditionalWait
        ? `**If waitParam = nowait:**\n\nExecutes the workflow without waiting for completion:\n\n\`sh -x cli.sh runAJobCli -t $Tasktype -un $workflowName -fp $folderName -w nowait\`\n\n${hasErrorHandling && hasExitCode6 ? 'If the command fails (exit code ≠ 0 and ≠ 6), the script exits with an error code 1.' : hasErrorHandling ? 'If the command fails, the script exits with an error code 1.' : ''}` 
        : hasNowait
        ? `Executes the workflow without waiting for completion:\n\n\`sh -x cli.sh runAJobCli -t $Tasktype -un $workflowName -fp $folderName -w nowait\``
        : '',
      hasConditionalWait
        ? `\n\n**Else (Default Wait Mode):**\n\nExecutes the workflow normally (waits until completion):\n\n\`sh -x cli.sh runAJobCli -t $Tasktype -un $workflowName -fp $folderName\``
        : !hasNowait
        ? `Executes the workflow normally (waits until completion):\n\n\`sh -x cli.sh runAJobCli -t $Tasktype -un $workflowName -fp $folderName\``
        : '',
      '',
      '',
      '## 🔹 Key Notes',
      '',
      '- The `-x` option enables debug mode, showing executed commands.',
      hasErrorHandling ? '- Exit code handling ensures the script stops on critical failures.' : '',
      hasConditionalWait || hasNowait ? '- Supports both synchronous (wait) and asynchronous (nowait) execution modes.' : '- Executes workflows in synchronous mode (waits for completion).',
      '',
      '',
      '## 🧠 In Short',
      '',
      hasConditionalWait || hasNowait
        ? 'This script automates the process of running an IICS workflow from the command line, giving flexibility to either wait for completion or trigger it asynchronously depending on your need.'
        : 'This script automates the process of running an IICS workflow from the command line and waits for the workflow to complete before finishing.',
      ''
    ].filter(line => line !== '').join('\n');

    return md;
  }

  // Generate generic human-readable summary for non-IICS scripts
  generateGenericHumanReadableSummary(content, fileName) {
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const isSQL = this.isPureSQLFile(content);
    const usesSqlLoader = /SQLLDR|SQL\*LOADER/i.test(content);
    const usesSqlPlus = /SQLPLUS/i.test(content);

    let objective = 'This script performs batch operations as defined in the script.';
    let flowSteps = [];

    if (isSQL) {
      objective = 'This script contains SQL statements for database operations.';
      flowSteps.push('Executes SQL statements sequentially.');
    } else if (usesSqlLoader) {
      objective = 'This script uses SQL*Loader to bulk load data into a database.';
      flowSteps.push('Loads data files using SQL*Loader.');
      flowSteps.push('Executes any post-load SQL statements if present.');
    } else if (usesSqlPlus) {
      objective = 'This script uses SQL*Plus to execute SQL/PLSQL statements.';
      flowSteps.push('Connects to the database.');
      flowSteps.push('Executes SQL/PLSQL statements.');
    }

    const md = [
      `🧩 Script Summary: ${fileName}`,
      '',
      '',
      '## Objective',
      '',
      objective,
      '',
      '',
      '## 🔹 Script Flow',
      '',
      ...flowSteps.map((step, i) => `${i + 1}. ${step}`),
      '',
      '',
      '## 🧠 In Short',
      '',
      objective,
      ''
    ].filter(line => line !== '').join('\n');

    return md;
  }
}

module.exports = new BatchScriptService();
