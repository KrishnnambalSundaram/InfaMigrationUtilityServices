const batchScriptService = require('../services/batchScriptService');
const progressService = require('../services/progressService');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const archiver = require('archiver');

// Process batch scripts and convert to IDMC summaries
const handleProcessBatchScripts = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath } = req.body;
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'md';
    // Normalize: only 'md' or 'txt' supported
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'md';
    
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
    
    // Create job ID
    const fileName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `batch_scripts_${fileName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    console.log(`🚀 Starting batch script processing job: ${jobId}`);
    
    // Extract the zip file
    console.log('📦 Extracting zip file...');
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    
    // Use system unzip command
    try {
      await execAsync(`unzip -q "${zipFilePath}" -d "${extractedPath}"`);
      console.log('✅ Zip file extracted using system unzip');
    } catch (error) {
      console.warn('⚠️ System unzip failed, falling back to unzipper library:', error.message);
      
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
    
    console.log(`✅ Zip file extracted to: ${extractedPath}`);
    
    // Process batch scripts
    console.log('🔄 Processing batch scripts...');
    progressService.updateProgress(jobId, 1, 10, 'Processing batch scripts...');
    
    const processingResult = await batchScriptService.processBatchScriptDirectory(extractedPath);
    progressService.updateProgress(jobId, 1, 100, 'Batch script processing complete');
    console.log(`✅ Processing complete: ${processingResult.processedFiles}/${processingResult.totalFiles} files processed`);
    
    // Create final ZIP with IDMC summaries
    console.log('📦 Creating final IDMC package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final IDMC package...');
    const zipsPath = process.env.ZIPS_PATH || './zips';
    await fs.ensureDir(zipsPath);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = outputFormat === 'txt' ? 'txt' : 'md';
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
    console.error('❌ Batch script processing failed:', error);
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
      console.log('🧹 Cleaned up extracted directory');
    }
  }
};

// Process single batch script file
const handleProcessSingleBatchScript = async (req, res) => {
  try {
    const { script, fileName, scriptType, sourceCode, filePath } = req.body;
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'md';
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'md';
    
    // Handle either script, sourceCode parameter, or filePath
    let batchScript = script || sourceCode;
    let actualFileName = fileName;
    
    // Handle file path if provided instead of direct code
    if (filePath && !batchScript) {
      console.log(`🔄 Processing batch script from file: ${filePath}`);
      
      // Check if file exists
      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({
          error: `File not found: ${filePath}`,
          success: false
        });
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
          fileName: 'run_script.bat',
          scriptType: 'oracle' // or 'redshift'
        }
      });
    }
    
    const jobId = `single_batch_${Date.now()}`;
    const job = progressService.createJob(jobId);
    
    console.log(`🚀 Starting single batch script processing: ${actualFileName}`);
    progressService.updateProgress(jobId, 0, 50, 'Processing batch script...');
    
    // Process the batch script content directly (no temp file needed)
    const result = await batchScriptService.processBatchScriptContent(batchScript, actualFileName, scriptType);
    
    progressService.updateProgress(jobId, 0, 100, 'Processing complete');
    
    // Persist IDMC summaries if present according to outputType
    const outputsRoot = process.env.OUTPUT_PATH || './output';
    await fs.ensureDir(outputsRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFiles = [];
    if (Array.isArray(result.idmcSummaries) && result.idmcSummaries.length) {
      for (const s of result.idmcSummaries) {
        const base = (s.fileName || `${actualFileName}_IDMC_Summary.md`).replace(/\.md$/i, '');
        if (outputFormat === 'md') {
          const mdName = `${base}_${timestamp}.md`;
          const mdPath = path.join(outputsRoot, mdName);
          await fs.writeFile(mdPath, s.idmcSummary || '', 'utf8');
          outputFiles.push({ name: mdName, path: path.resolve(mdPath), mime: 'text/markdown', kind: 'single' });
        }
        if (outputFormat === 'txt') {
          const txtName = `${base}_${timestamp}.txt`;
          const txtPath = path.join(outputsRoot, txtName);
          await fs.writeFile(txtPath, s.idmcSummary || '', 'utf8');
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
      scriptType: scriptType || result.scriptType,
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
    console.error('❌ Single batch script processing failed:', error);
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
    let outputFormat = (req.body && (req.body.outputFormat || req.body.outputType)) || 'md';
    outputFormat = (outputFormat === 'txt') ? 'txt' : 'md';

    let batchScript = script;
    let actualFileName = fileName;

    if (filePath && !batchScript) {
      if (!await fs.pathExists(filePath)) {
        return res.status(404).json({ success: false, error: `File not found: ${filePath}` });
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

    // Persist a .md artifact for download convenience
    const outputsRoot = process.env.OUTPUT_PATH || './output';
    await fs.ensureDir(outputsRoot);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = actualFileName.replace(/\.[^.]+$/g, '');
    const outputFiles = [];
    if (outputFormat === 'md') {
      const outNameMd = `${base}_Summary_${timestamp}.md`;
      const outPathMd = path.join(outputsRoot, outNameMd);
      await fs.writeFile(outPathMd, markdown, 'utf8');
      outputFiles.push({ name: outNameMd, path: path.resolve(outPathMd), mime: 'text/markdown', kind: 'single' });
    }
    if (outputFormat === 'txt') {
      const outNameTxt = `${base}_Summary_${timestamp}.txt`;
      const outPathTxt = path.join(outputsRoot, outNameTxt);
      await fs.writeFile(outPathTxt, markdown, 'utf8');
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
async function createBatchIDMCZipFile(results, zipPath, outputType = 'md') {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`📦 Batch IDMC Zip file created: ${archive.pointer()} bytes`);
      resolve();
    });
    
    archive.on('error', (err) => {
      console.error('❌ Error creating batch IDMC zip file:', err);
      reject(err);
    });
    
    archive.pipe(output);
    
    // Add IDMC summary files for each processed batch script
    for (const result of results) {
      if (result.success && result.idmcSummaries) {
        for (const idmcSummary of result.idmcSummaries) {
          if (idmcSummary.idmcSummary) {
            // IDMC summary is markdown; package as .md/.txt depending on outputType
            const base = (idmcSummary.fileName || 'IDMC_Summary.md').replace(/\.md$/i, '');
            const name = outputType === 'txt' ? `${base}.txt` : `${base}.md`;
            archive.append(idmcSummary.idmcSummary, { name });
            console.log(`📄 Added to batch IDMC zip: ${name}`);
          }
        }
      }
    }
    
    archive.finalize();
  });
}

module.exports = { 
  handleProcessBatchScripts,
  handleProcessSingleBatchScript,
  handleSummarizeBatchScript,
  handleProcessBatchUnified
};
