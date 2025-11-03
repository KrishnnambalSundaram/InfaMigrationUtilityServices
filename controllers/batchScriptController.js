const batchScriptService = require('../services/batchScriptService');
const progressService = require('../services/progressService');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const archiver = require('archiver');
const config = require('../config');
const { assertPathUnder } = require('../utils/pathUtils');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('controllers/batchScriptController');

// Process batch scripts and convert to IDMC summaries
const handleProcessBatchScripts = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath } = req.body;
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'doc';
    // Normalize: only 'doc' or 'txt' supported
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'doc';
    
    if (!zipFilePath) {
      return res.status(400).json({ 
        error: 'zipFilePath is required',
        example: { zipFilePath: '/path/to/your/batch-scripts.zip' }
      });
    }
    
    // Check if zip file exists
    if (!await fs.pathExists(zipFilePath)) {
      return res.status(404).json({ 
        error: 'Zip file not found',
        providedPath: zipFilePath
      });
    }
    // Ensure provided zip path is under allowed roots (uploads or zips)
    try {
      assertPathUnder([config.paths.uploads, config.paths.zips], zipFilePath, 'Zip path outside allowed roots');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    
    // Create job ID
    const fileName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `batch_scripts_${fileName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    log.info(`🚀 Starting batch script processing job: ${jobId}`);
    
    // Extract the zip file
    log.info('📦 Extracting zip file...');
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');
    const uploadPath = config.paths.uploads;
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    
    // Use system unzip command
    try {
      await execAsync(`unzip -q "${zipFilePath}" -d "${extractedPath}"`);
      log.info('✅ Zip file extracted using system unzip');
    } catch (error) {
      log.warn('⚠️ System unzip failed, falling back to unzipper library', { message: error.message });
      
      await new Promise((resolve, reject) => {
        const extract = unzipper.Extract({ path: extractedPath });
        extract.on('error', reject);
        extract.on('close', () => {
          setTimeout(resolve, 100);
        });
        
        fs.createReadStream(zipFilePath)
          .pipe(extract);
      });
    }
    
    log.info(`✅ Zip file extracted to: ${extractedPath}`);
    
    // Process batch scripts
    log.info('🔄 Processing batch scripts...');
    progressService.updateProgress(jobId, 1, 10, 'Processing batch scripts...');
    
    const processingResult = await batchScriptService.processBatchScriptDirectory(extractedPath);
    progressService.updateProgress(jobId, 1, 100, 'Batch script processing complete');
    log.info(`✅ Processing complete: ${processingResult.processedFiles}/${processingResult.totalFiles} files processed`);
    
    // Create final ZIP with IDMC summaries
    log.info('📦 Creating final IDMC package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final IDMC package...');
    const zipsPath = config.paths.zips;
    await fs.ensureDir(zipsPath);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = outputFormat === 'txt' ? 'txt' : 'doc';
    const zipFileName = `batch_scripts_idmc_summaries_${suffix}_${timestamp}.zip`;
    const zipPath = path.join(zipsPath, zipFileName);
    
    // Create zip file with IDMC summaries
    await createBatchIDMCZipFile(processingResult.results, zipPath, outputFormat);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Complete the job
    const result = {
      processing: {
        totalFiles: processingResult.totalFiles,
        processedFiles: processingResult.processedFiles,
        failedFiles: processingResult.failedFiles,
        successRate: Math.round((processingResult.processedFiles / processingResult.totalFiles) * 100),
        results: processingResult.results
      },
      zipFilename: zipFileName,
      zipFilePath: path.resolve(zipPath)
    };
    
    progressService.completeJob(jobId, result);
    
    res.status(200).json({
      success: true,
      message: 'Batch script processing completed successfully',
      source: zipFilePath,
      jobId: jobId,
      jsonContent: JSON.stringify(processingResult, null, 2),
      ...result
    });
    
  } catch (error) {
    log.error('❌ Batch script processing failed', { error: error.message, stack: error.stack });
    progressService.failJob(jobId, error.message);
    
    res.status(500).json({ 
      error: 'Batch script processing failed', 
      details: error.message,
      jobId: jobId
    });
  } finally {
    // Clean up extracted directory
    if (extractedPath && await fs.pathExists(extractedPath)) {
      await fs.remove(extractedPath);
      log.info('🧹 Cleaned up extracted directory');
    }
  }
};

// Process single batch script file
const handleProcessSingleBatchScript = async (req, res) => {
  try {
    const { script, fileName, sourceCode, filePath } = req.body;
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'doc';
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'doc';
    
    // Handle either script, sourceCode parameter, or filePath
    let batchScript = script || sourceCode;
    let actualFileName = fileName;
    
    // Handle file path if provided instead of direct code
    if (filePath && !batchScript) {
      log.info(`🔄 Processing batch script from file: ${filePath}`);
      
      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({
          error: `File not found: ${filePath}`,
          success: false
        });
      }
      // Ensure provided path is under allowed roots
      try {
        assertPathUnder([config.paths.uploads, config.paths.output, config.paths.zips], filePath, 'File path outside allowed roots');
      } catch (e) {
        return res.status(400).json({ success: false, error: e.message });
      }
      
      // Read the batch script file
      batchScript = await fs.readFile(filePath, 'utf8');
      actualFileName = actualFileName || path.basename(filePath);
    }
    
    if (!batchScript || !actualFileName) {
      return res.status(400).json({ 
        error: 'Either script/sourceCode with fileName OR filePath is required',
        example: { 
          script: 'sqlplus user/pass@db @script.sql\nexit',
          fileName: 'run_script.bat'
        }
      });
    }
    
    const jobId = `single_batch_${Date.now()}`;
    const job = progressService.createJob(jobId);
    
    log.info(`🚀 Starting single batch script processing: ${actualFileName}`);
    progressService.updateProgress(jobId, 0, 50, 'Processing batch script...');
    
    // Process the batch script content directly (scriptType is auto-detected - pass null)
    const result = await batchScriptService.processBatchScriptContent(batchScript, actualFileName, null);
    
    progressService.updateProgress(jobId, 0, 100, 'Processing complete');
    
    // Persist IDMC summaries if present according to outputType
    const outputsRoot = config.paths.output;
    await fs.ensureDir(outputsRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFiles = [];
    if (Array.isArray(result.idmcSummaries) && result.idmcSummaries.length) {
      for (const s of result.idmcSummaries) {
        const base = (s.fileName || `${actualFileName}_IDMC_Summary`).replace(/\.(md|docx?|txt)$/i, '');
        if (outputFormat === 'doc') {
          const docName = `${base}_${timestamp}.docx`;
          const docPath = path.join(outputsRoot, docName);
          await convertMarkdownToDocx(s.idmcSummary || '', docPath);
          outputFiles.push({ name: docName, path: path.resolve(docPath), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'single' });
        }
        if (outputFormat === 'txt') {
          const txtName = `${base}_${timestamp}.txt`;
          const txtPath = path.join(outputsRoot, txtName);
          // Convert markdown to plain text
          const plainText = (s.idmcSummary || '').replace(/#{1,6}\s+/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\|.*\|/g, '')
            .replace(/-{3,}/g, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/\n{3,}/g, '\n\n');
          await fs.writeFile(txtPath, plainText, 'utf8');
          outputFiles.push({ name: txtName, path: path.resolve(txtPath), mime: 'text/plain', kind: 'single' });
        }
      }
    }

    // Build response with optional content
    const combinedContent = Array.isArray(result.idmcSummaries)
      ? result.idmcSummaries.map((s, i) => `### Statement ${i + 1}\n\n${s.idmcSummary || ''}`).join(`\n\n---\n\n`)
      : '';

    const response = {
      success: true,
      message: 'Batch script processed successfully',
      fileName: actualFileName,
      scriptType: result.scriptType, // Auto-detected
      originalContent: batchScript,
      extractionResult: result.extractionResult,
      idmcSummaries: result.idmcSummaries,
      jobId: jobId,
      jsonContent: combinedContent || null,
      outputFiles
    };
    
    progressService.completeJob(jobId, response);
    
    res.status(200).json(response);
    
  } catch (error) {
    log.error('❌ Single batch script processing failed', { error: error.message, stack: error.stack });
    res.status(500).json({ 
      error: 'Single batch script processing failed', 
      details: error.message
    });
  }
};

// Summarize a single batch script into 4-section markdown
const handleSummarizeBatchScript = async (req, res) => {
  try {
    const { script, fileName, filePath } = req.body;
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'doc';
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'doc';

    let batchScript = script;
    let actualFileName = fileName;

    if (filePath && !batchScript) {
      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({ success: false, error: `File not found: ${filePath}` });
      }
      try {
        assertPathUnder([config.paths.uploads, config.paths.output, config.paths.zips], filePath, 'File path outside allowed roots');
      } catch (e) {
        return res.status(400).json({ success: false, error: e.message });
      }
      batchScript = await fs.readFile(filePath, 'utf8');
      actualFileName = actualFileName || path.basename(filePath);
    }

    if (!batchScript || !actualFileName) {
      return res.status(400).json({ 
        success: false,
        error: 'script and fileName are required (or provide filePath)',
        example: { script: 'sqlldr ...', fileName: 'LoadTMSnapshot.bat' }
      });
    }

    const markdown = batchScriptService.summarizeBatchScriptContent(batchScript, actualFileName);

    // Persist artifact for download convenience
    const outputsRoot = config.paths.output;
    await fs.ensureDir(outputsRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = actualFileName.replace(/\.[^.]+$/g, '');
    const outputFiles = [];
    if (outputFormat === 'doc') {
      const outNameDoc = `${base}_Summary_${timestamp}.docx`;
      const outPathDoc = path.join(outputsRoot, outNameDoc);
      await convertMarkdownToDocx(markdown, outPathDoc);
      outputFiles.push({ name: outNameDoc, path: path.resolve(outPathDoc), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'single' });
    }
    if (outputFormat === 'txt') {
      const outNameTxt = `${base}_Summary_${timestamp}.txt`;
      const outPathTxt = path.join(outputsRoot, outNameTxt);
      // Convert markdown to plain text
      const plainText = markdown.replace(/#{1,6}\s+/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\|.*\|/g, '')
        .replace(/-{3,}/g, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/\n{3,}/g, '\n\n');
      await fs.writeFile(outPathTxt, plainText, 'utf8');
      outputFiles.push({ name: outNameTxt, path: path.resolve(outPathTxt), mime: 'text/plain', kind: 'single' });
    }

    return res.status(200).json({ 
      success: true,
      fileName: actualFileName,
      originalContent: batchScript,
      summary: markdown,
      jsonContent: markdown,
      outputFiles
    });
  } catch (error) {
    console.error('❌ Batch script summary failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Unified handler: inputType 'zip'|'single'. For 'zip' expects zipFilePath. For 'single' expects script and fileName.
const handleProcessBatchUnified = async (req, res) => {
  const { inputType, zipFilePath, script, fileName, scriptType, filePath } = req.body;
  if (inputType === 'zip') {
    // Delegate to existing ZIP flow
    req.body = { zipFilePath };
    return handleProcessBatchScripts(req, res);
  }

  // Single
  req.body = { script, fileName, scriptType, filePath };
  return handleProcessSingleBatchScript(req, res);
};

// Function to create zip file with batch script IDMC summaries
async function createBatchIDMCZipFile(results, zipPath, outputType = 'doc') {
  return new Promise(async (resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      log.info(`📦 Batch IDMC Zip file created: ${archive.pointer()} bytes`);
      resolve();
    });
    
    archive.on('error', (err) => {
      log.error('❌ Error creating batch IDMC zip file:', err);
      reject(err);
    });
    
    archive.pipe(output);
    
    // Add IDMC summary files for each processed batch script
    for (const result of results) {
      if (result.success && result.idmcSummaries) {
        for (const idmcSummary of result.idmcSummaries) {
          if (idmcSummary.idmcSummary) {
            const base = (idmcSummary.fileName || 'IDMC_Summary').replace(/\.(md|docx?|txt)$/i, '');
            if (outputType === 'doc') {
              const docName = `${base}.docx`;
              const tempDocPath = path.join(require('os').tmpdir(), `idmc_${Date.now()}_${Math.random().toString(36).substring(7)}_${docName}`);
              try {
                await convertMarkdownToDocx(idmcSummary.idmcSummary, tempDocPath);
                archive.file(tempDocPath, { name: docName });
                // Clean up temp file after adding to archive
                setTimeout(() => fs.remove(tempDocPath).catch(() => {}), 1000);
                log.info(`📄 Added to batch IDMC zip: ${docName}`);
              } catch (error) {
                log.error(`Error creating docx for ${docName}:`, error);
              }
            } else {
              const txtName = `${base}.txt`;
              const plainText = idmcSummary.idmcSummary.replace(/#{1,6}\s+/g, '')
                .replace(/\*\*(.*?)\*\*/g, '$1')
                .replace(/\*(.*?)\*/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/\|.*\|/g, '')
                .replace(/-{3,}/g, '')
                .replace(/^\s*[-*+]\s+/gm, '')
                .replace(/\n{3,}/g, '\n\n');
              archive.append(plainText, { name: txtName });
              log.info(`📄 Added to batch IDMC zip: ${txtName}`);
            }
          }
        }
      }
    }
    
    archive.finalize();
  });
}

// Helper function to convert markdown to HTML then to DOCX
async function convertMarkdownToDocx(markdownContent, outputPath) {
  const htmlToDocx = require('html-to-docx');
  const marked = require('marked');

  // Convert markdown to HTML
  const htmlContent = marked.parse(markdownContent);
  
  // Convert HTML to DOCX
  const docxBuffer = await htmlToDocx(htmlContent, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true,
  });

  await fs.writeFile(outputPath, docxBuffer);
}

// Process single batch script to human-readable summary
const handleGenerateHumanReadableSummarySingle = async (req, res) => {
  try {
    const { script, fileName, filePath } = req.body;
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'doc';
    // Normalize: only 'doc' or 'txt' supported
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'doc';

    let batchScript = script;
    let actualFileName = fileName;

    if (filePath && !batchScript) {
      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({ success: false, error: `File not found: ${filePath}` });
      }
      try {
        assertPathUnder([config.paths.uploads, config.paths.output, config.paths.zips], filePath, 'File path outside allowed roots');
      } catch (e) {
        return res.status(400).json({ success: false, error: e.message });
      }
      batchScript = await fs.readFile(filePath, 'utf8');
      actualFileName = actualFileName || path.basename(filePath);
    }

    if (!batchScript || !actualFileName) {
      return res.status(400).json({ 
        success: false,
        error: 'script and fileName are required (or provide filePath)',
        example: { script: '#!/bin/bash\nfolderName=$1\n...', fileName: 'triggerWorkflow.sh' }
      });
    }

    const summary = await batchScriptService.generateHumanReadableSummary(batchScript, actualFileName);

    // Persist summary artifact
    const outputsRoot = config.paths.output;
    await fs.ensureDir(outputsRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = actualFileName.replace(/\.[^.]+$/g, '');
    const outputFiles = [];
    
    if (outputFormat === 'doc') {
      const outNameDoc = `${base}_HumanReadable_Summary_${timestamp}.docx`;
      const outPathDoc = path.join(outputsRoot, outNameDoc);
      await convertMarkdownToDocx(summary, outPathDoc);
      outputFiles.push({ name: outNameDoc, path: path.resolve(outPathDoc), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'single' });
    }
    if (outputFormat === 'txt') {
      const outNameTxt = `${base}_HumanReadable_Summary_${timestamp}.txt`;
      const outPathTxt = path.join(outputsRoot, outNameTxt);
      // Convert markdown to plain text
      const plainText = summary.replace(/#{1,6}\s+/g, '') // Remove headers
        .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
        .replace(/\*(.*?)\*/g, '$1') // Remove italic
        .replace(/`([^`]+)`/g, '$1') // Remove code
        .replace(/\|.*\|/g, '') // Remove tables
        .replace(/-{3,}/g, '') // Remove horizontal rules
        .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
        .replace(/\n{3,}/g, '\n\n'); // Normalize line breaks
      await fs.writeFile(outPathTxt, plainText, 'utf8');
      outputFiles.push({ name: outNameTxt, path: path.resolve(outPathTxt), mime: 'text/plain', kind: 'single' });
    }

    return res.status(200).json({ 
      success: true,
      fileName: actualFileName,
      originalContent: batchScript,
      humanReadableSummary: summary,
      summary: summary,
      jsonContent: summary,
      outputFiles
    });
  } catch (error) {
    log.error('❌ Human-readable summary generation failed:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Process zip file of batch scripts to human-readable summaries
const handleGenerateHumanReadableSummaryZip = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath } = req.body;
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'doc';
    // Normalize: only 'doc' or 'txt' supported
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'doc';
    
    if (!zipFilePath) {
      return res.status(400).json({ 
        error: 'zipFilePath is required',
        example: { zipFilePath: '/path/to/your/batch-scripts.zip' }
      });
    }
    
    // Check if zip file exists
    if (!await fs.pathExists(zipFilePath)) {
      return res.status(404).json({ 
        error: 'Zip file not found',
        providedPath: zipFilePath
      });
    }
    // Ensure provided zip path is under allowed roots
    try {
      assertPathUnder([config.paths.uploads, config.paths.zips], zipFilePath, 'Zip path outside allowed roots');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    
    // Create job ID
    const fileName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `human_readable_${fileName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    log.info(`🚀 Starting human-readable summary generation job: ${jobId}`);
    
    // Extract the zip file
    log.info('📦 Extracting zip file...');
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');
    const uploadPath = config.paths.uploads;
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    
    // Use system unzip command
    try {
      await execAsync(`unzip -q "${zipFilePath}" -d "${extractedPath}"`);
      log.info('✅ Zip file extracted using system unzip');
    } catch (error) {
      log.warn('⚠️ System unzip failed, falling back to unzipper library', { message: error.message });
      
      await new Promise((resolve, reject) => {
        const extract = unzipper.Extract({ path: extractedPath });
        extract.on('error', reject);
        extract.on('close', () => {
          setTimeout(resolve, 100);
        });
        
        fs.createReadStream(zipFilePath)
          .pipe(extract);
      });
    }
    
    log.info(`✅ Zip file extracted to: ${extractedPath}`);
    
    // Process batch scripts
    log.info('🔄 Generating human-readable summaries...');
    progressService.updateProgress(jobId, 1, 10, 'Generating human-readable summaries...');
    
    // Find all batch script files
    const files = [];
    await batchScriptService.findBatchScriptFiles(extractedPath, files);
    const sortedFiles = files.sort((a, b) => {
      const nameA = path.basename(a);
      const nameB = path.basename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    const totalFiles = sortedFiles.length;
    const processedFiles = [];
    
    for (let i = 0; i < totalFiles; i++) {
      const filePath = sortedFiles[i];
      try {
        log.info(`Processing file ${i + 1}/${totalFiles}: ${path.basename(filePath)}`);
        progressService.updateProgress(jobId, 1, Math.round(((i + 1) / totalFiles) * 90), `Processing file ${i + 1}/${totalFiles}: ${path.basename(filePath)}`);
        
        const content = await fs.readFile(filePath, 'utf8');
        const fileName = path.basename(filePath);
        const summary = await batchScriptService.generateHumanReadableSummary(content, fileName);
        
        processedFiles.push({
          original: path.relative(extractedPath, filePath),
          fileName: fileName,
          summary: summary,
          success: true
        });
        
      } catch (error) {
        log.error(`❌ Error processing file ${filePath}`, { error: error.message });
        processedFiles.push({
          original: path.relative(extractedPath, filePath),
          fileName: path.basename(filePath),
          summary: null,
          success: false,
          error: error.message
        });
      }
    }
    
    progressService.updateProgress(jobId, 2, 10, 'Creating final package...');
    
    // Create final ZIP with summaries
    const zipsPath = config.paths.zips;
    await fs.ensureDir(zipsPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = outputFormat === 'txt' ? 'txt' : 'doc';
    const zipFileName = `human_readable_summaries_${suffix}_${timestamp}.zip`;
    const zipPath = path.join(zipsPath, zipFileName);
    
    // Create zip file with summaries
    await createHumanReadableZipFile(processedFiles, zipPath, outputFormat);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Complete the job
    const result = {
      processing: {
        totalFiles: totalFiles,
        processedFiles: processedFiles.filter(f => f.success).length,
        failedFiles: processedFiles.filter(f => !f.success).length,
        successRate: totalFiles > 0 ? Math.round((processedFiles.filter(f => f.success).length / totalFiles) * 100) : 0,
        results: processedFiles
      },
      zipFilename: zipFileName,
      zipFilePath: path.resolve(zipPath)
    };
    
    progressService.completeJob(jobId, result);
    
    res.status(200).json({
      success: true,
      message: 'Human-readable summary generation completed successfully',
      source: zipFilePath,
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    log.error('❌ Human-readable summary generation failed', { error: error.message, stack: error.stack });
    progressService.failJob(jobId, error.message);
    
    res.status(500).json({ 
      error: 'Human-readable summary generation failed', 
      details: error.message,
      jobId: jobId
    });
  } finally {
    // Clean up extracted directory
    if (extractedPath && await fs.pathExists(extractedPath)) {
      await fs.remove(extractedPath);
      log.info('🧹 Cleaned up extracted directory');
    }
  }
};

// Unified handler for human-readable summaries (single or zip)
const handleGenerateHumanReadableSummary = async (req, res) => {
  const { inputType, zipFilePath, script, fileName, filePath } = req.body;
  if (inputType === 'zip' || zipFilePath) {
    // Delegate to ZIP flow
    req.body = { zipFilePath: zipFilePath || req.body.zipFilePath };
    return handleGenerateHumanReadableSummaryZip(req, res);
  }

  // Single
  req.body = { script, fileName, filePath };
  return handleGenerateHumanReadableSummarySingle(req, res);
};

// Function to create zip file with human-readable summaries
async function createHumanReadableZipFile(processedFiles, zipPath, outputFormat = 'doc') {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      log.info(`📦 Human-readable summaries zip file created: ${archive.pointer()} bytes`);
      resolve();
    });
    
    archive.on('error', (err) => {
      log.error('❌ Error creating human-readable summaries zip file:', err);
      reject(err);
    });
    
    archive.pipe(output);
    
    // Add summary files for each processed script
    const addFilesPromises = processedFiles.map(async (file) => {
      if (file.success && file.summary) {
        const base = file.fileName.replace(/\.[^.]+$/g, '');
        if (outputFormat === 'doc') {
          const docName = `${base}_HumanReadable_Summary.docx`;
          const tempDocPath = path.join(require('os').tmpdir(), docName);
          await convertMarkdownToDocx(file.summary, tempDocPath);
          archive.file(tempDocPath, { name: docName });
          // Clean up temp file after adding to archive
          setTimeout(() => fs.remove(tempDocPath).catch(() => {}), 1000);
        } else {
          const txtName = `${base}_HumanReadable_Summary.txt`;
          const plainText = file.summary.replace(/#{1,6}\s+/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\|.*\|/g, '')
            .replace(/-{3,}/g, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/\n{3,}/g, '\n\n');
          archive.append(plainText, { name: txtName });
        }
        log.info(`📄 Added to zip: ${outputFormat === 'doc' ? `${base}_HumanReadable_Summary.docx` : `${base}_HumanReadable_Summary.txt`}`);
      }
    });
    
    Promise.all(addFilesPromises).then(() => {
      archive.finalize();
    }).catch(reject);
  });
}

// Batch to IDMC Summary - unified handler for single or zip
const handleBatchToIdmcSummary = async (req, res) => {
  const { inputType, script, filePath, zipPath, zipFilePath, outputFormat, name } = req.body;
  let actualZipPath = zipPath || zipFilePath;
  
  if (inputType === 'zip') {
    // Process ZIP file
    req.body = { zipFilePath: actualZipPath, outputFormat };
    return handleProcessBatchScripts(req, res);
  } else {
    // Process single file
    req.body = { script, filePath, fileName: name, outputFormat };
    return handleProcessSingleBatchScript(req, res);
  }
};

// Batch to Human Language - unified handler for single or zip
const handleBatchToHumanLanguage = async (req, res) => {
  const { inputType, script, filePath, zipPath, zipFilePath, outputFormat, name } = req.body;
  let actualZipPath = zipPath || zipFilePath;
  
  if (inputType === 'zip') {
    // Process ZIP file
    req.body = { zipFilePath: actualZipPath, outputFormat };
    return handleGenerateHumanReadableSummaryZip(req, res);
  } else {
    // Process single file
    req.body = { script, filePath, fileName: name, outputFormat };
    return handleGenerateHumanReadableSummarySingle(req, res);
  }
};

module.exports = { 
  handleProcessBatchScripts,
  handleProcessSingleBatchScript,
  handleSummarizeBatchScript,
  handleProcessBatchUnified,
  handleGenerateHumanReadableSummary,
  handleBatchToIdmcSummary,
  handleBatchToHumanLanguage
};
