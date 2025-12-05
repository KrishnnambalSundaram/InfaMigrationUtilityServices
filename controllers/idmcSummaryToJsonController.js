const idmcConversionService = require('../services/idmcConversionService');
const progressService = require('../services/progressService');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const archiver = require('archiver');
const { Worker } = require('worker_threads');
const config = require('../config');
const { assertPathUnder } = require('../utils/pathUtils');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('controllers/idmcSummaryToJsonController');

// Helper function to find IDMC summary files (markdown, text, json, bin)
async function findIdmcSummaryFiles(directory) {
  const files = [];
  
  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const name = entry.name.toLowerCase();
        // Look for IDMC summary files - now includes .txt and .bin
        if (ext === '.md' || ext === '.txt' || ext === '.json' || ext === '.bin' ||
            name.includes('idmc') || name.includes('summary')) {
          files.push(fullPath);
        }
      }
    }
  }
  
  await scanDir(directory);
  return files;
}

// Convert IDMC summary files to JSON using worker threads (for ZIP)
async function convertIdmcSummaryFilesWithWorkers(extractedPath, files, jobId) {
  const maxWorkers = Math.min(8, files.length || 0);
  if (maxWorkers === 0) {
    return { idmcJsonFiles: [], convertedFiles: [] };
  }

  const workers = [];
  const fileQueue = [...files];
  const results = [];

  const startNext = (worker) => {
    if (fileQueue.length === 0) {
      worker.terminate();
      return;
    }
    const nextFile = fileQueue.shift();
    worker.postMessage({ filePath: nextFile, extractedPath });
  };

  await new Promise((resolve, reject) => {
    let active = 0;
    for (let i = 0; i < maxWorkers; i++) {
      const worker = new Worker(path.join(__dirname, '..', 'workers', 'idmcSummaryToJsonWorker.js'));
      workers.push(worker);
      active++;

      worker.on('message', (msg) => {
        if (msg && msg.success) {
          const r = msg.result;
          results.push({ success: true, ...r });
        } else {
          results.push({ success: false, error: msg && msg.error ? msg.error : 'Unknown worker error' });
        }

        // Progress update: based on results length vs total files
        const progress = Math.round((results.length / files.length) * 90);
        progressService.updateProgress(jobId, 1, progress, `Converted ${results.length}/${files.length} files`);

        if (fileQueue.length > 0) {
          startNext(worker);
        } else {
          worker.terminate();
          active--;
          if (active === 0) resolve();
        }
      });

      worker.on('error', (err) => {
        results.push({ success: false, error: err.message });
        if (fileQueue.length > 0) {
          startNext(worker);
        } else {
          worker.terminate();
          active--;
          if (active === 0) resolve();
        }
      });

      startNext(worker);
    }
  });

  // Build outputs
  const idmcJsonFiles = [];
  const convertedFiles = [];

  // Write files to disk for zipping
  const idmcOutRoot = config.paths.idmc || './idmc_output';
  await fs.ensureDir(idmcOutRoot);

  for (const r of results) {
    if (r.success) {
      const outPath = path.join(idmcOutRoot, r.converted);
      await fs.ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, r.jsonContent, 'utf8');
      idmcJsonFiles.push({ name: r.converted, content: r.jsonContent });
      convertedFiles.push({
        original: r.original,
        converted: r.converted,
        jsonContent: r.jsonContent,
        originalContent: r.originalContent,
        success: true
      });
    } else {
      convertedFiles.push({
        original: null,
        converted: null,
        jsonContent: null,
        success: false,
        error: r.error
      });
    }
  }

  // Keep deterministic order by filename
  idmcJsonFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  convertedFiles.sort((a, b) => (a.original || '').localeCompare(b.original || '', undefined, { numeric: true, sensitivity: 'base' }));

  return { idmcJsonFiles, convertedFiles };
}

// Function to create zip file with IDMC JSON files
async function createIdmcJsonZipFile(idmcJsonFiles, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      log.info(`📦 IDMC JSON Zip file created: ${archive.pointer()} bytes`);
      resolve();
    });
    
    archive.on('error', (err) => {
      log.error('❌ Error creating IDMC JSON zip file', { error: err.message });
      reject(err);
    });
    
    archive.pipe(output);
    
    // Add IDMC JSON files
    for (const file of idmcJsonFiles) {
      if (file.content) {
        archive.append(file.content, { name: file.name });
        log.info(`📄 Added to IDMC JSON zip: ${file.name}`);
      }
    }
    
    archive.finalize();
  });
}

// Main conversion handler - supports both single file and zip
const handleConvertIdmcSummaryToJson = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath, sourceCode, fileName } = req.body;
    
    // Handle direct code input (single file conversion)
    if (sourceCode) {
      log.info(`🔄 Processing direct IDMC summary to JSON conversion`);
      
      // Use the file name provided or default to input.md
      const inputFileName = fileName || 'input.md';
      
      // Convert the IDMC summary to JSON
      const jsonContent = await idmcConversionService.convertIdmcSummaryToJson(sourceCode, inputFileName);
      
      // Persist output artifacts
      const outputsRoot = config.paths.output;
      await fs.ensureDir(outputsRoot);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = inputFileName.replace(/\.[^.]+$/g, '');
      
      // Support custom file name from request body, otherwise use standard naming
      const customFileName = req.body.customFileName;
      let outFileName;
      if (customFileName) {
        // Use custom name but ensure .bin extension
        const customBase = customFileName.replace(/\.[^.]+$/g, '');
        outFileName = `${customBase}.bin`;
      } else {
        // Standard naming with .bin extension (changed from .bat)
        outFileName = `${base}_IDMC_Mapping_${timestamp}.bin`;
      }
      
      const outPath = path.join(outputsRoot, outFileName);
      await fs.writeFile(outPath, jsonContent, 'utf8');
      
      // Also create other output formats if requested
      const outputFiles = [{
        name: outFileName,
        path: path.resolve(outPath),
        mime: 'application/octet-stream',
        kind: 'single'
      }];
      
      // Add other format outputs if requested
      const { outputFormat = 'bin' } = req.body;
      
      // Add TXT format output if requested
      if (outputFormat === 'all' || outputFormat === 'txt') {
        const txtFileName = customFileName 
          ? customFileName.replace(/\.[^.]+$/g, '.txt')
          : `${base}_IDMC_Mapping_${timestamp}.txt`;
        const txtPath = path.join(outputsRoot, txtFileName);
        await fs.writeFile(txtPath, jsonContent, 'utf8');
        outputFiles.push({
          name: txtFileName,
          path: path.resolve(txtPath),
          mime: 'text/plain',
          kind: 'single'
        });
      }
      
      // Add DOC format output if requested
      if (outputFormat === 'all' || outputFormat === 'doc') {
        const docFileName = customFileName 
          ? customFileName.replace(/\.[^.]+$/g, '.doc')
          : `${base}_IDMC_Mapping_${timestamp}.doc`;
        const docPath = path.join(outputsRoot, docFileName);
        await fs.writeFile(docPath, jsonContent, 'utf8');
        outputFiles.push({
          name: docFileName,
          path: path.resolve(docPath),
          mime: 'application/msword',
          kind: 'single'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'IDMC summary converted to JSON successfully',
        fileName: inputFileName,
        originalContent: sourceCode,
        convertedContent: jsonContent,
        outputFiles: outputFiles
      });
    }
    
    // Handle zip file conversion
    if (!zipFilePath) {
      return res.status(400).json({ 
        error: 'Either sourceCode with fileName or zipFilePath is required',
        example: { zipFilePath: '/path/to/your/idmc-summaries.zip' }
      });
    }
    
    // Check if zip file exists
    if (!await fs.pathExists(zipFilePath)) {
      return res.status(404).json({ 
        error: 'Zip file not found',
        providedPath: zipFilePath
      });
    }
    
    try {
      assertPathUnder([config.paths.uploads, config.paths.zips], zipFilePath, 'Zip path outside allowed roots');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    
    // Create job ID
    const baseZipName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `idmc_summary_json_${baseZipName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    log.info(`🚀 Starting IDMC Summary → JSON conversion job: ${jobId}`);
    log.info(`📁 Processing zip file: ${zipFilePath}`);
    
    // Extract the zip file
    log.info('📦 Extracting zip file...');
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');
    const uploadPath = config.paths.uploads;
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    
    // Use system unzip command for better reliability
    try {
      await execAsync(`unzip -q "${zipFilePath}" -d "${extractedPath}"`);
      log.info('✅ Zip file extracted using system unzip');
    } catch (error) {
      log.warn('⚠️ System unzip failed, falling back to unzipper library', { message: error.message });
      
      // Fallback to unzipper library if system unzip fails
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
    
    // Step 1: Find IDMC summary files
    log.info('🔍 Scanning for IDMC summary files...');
    progressService.updateProgress(jobId, 0, 30, 'Scanning for IDMC summary files...');
    const allFiles = await findIdmcSummaryFiles(extractedPath);
    const sortedFiles = allFiles.sort((a, b) => {
      const nameA = path.basename(a);
      const nameB = path.basename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    const totalFiles = sortedFiles.length;
    
    log.info(`Found ${totalFiles} IDMC summary files to convert`);
    
    if (totalFiles === 0) {
      log.warn('⚠️ No IDMC summary files found to convert');
      return res.status(400).json({
        error: 'No IDMC summary files found in zip',
        message: 'Please ensure the zip contains .md, .txt, or .json files with IDMC summaries'
      });
    }
    
    // Step 2: Convert IDMC summaries to JSON using workers
    log.info('🔄 Starting IDMC Summary → JSON conversion...');
    progressService.updateProgress(jobId, 1, 10, 'Starting IDMC Summary → JSON conversion...');
    
    const conversionResult = await convertIdmcSummaryFilesWithWorkers(extractedPath, sortedFiles, jobId);
    progressService.updateProgress(jobId, 1, 100, 'Conversion complete');
    log.info(`✅ Conversion complete: ${conversionResult.convertedFiles.filter(f => f.success).length}/${totalFiles} files converted`);
    
    // Step 3: Create final ZIP with converted JSON files
    log.info('📦 Creating final package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final package...');
    const zipsPath = config.paths.zips;
    await fs.ensureDir(zipsPath);
    
    // Generate unique zip filename with timestamp
    // Support custom file name from request body
    const customFileName = req.body.customFileName;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = customFileName 
      ? `${customFileName.replace(/\.[^.]+$/g, '')}_${timestamp}.zip`
      : `idmc_mapping_bin_${timestamp}.zip`; // Changed from .bat to .bin
    const zipPath = path.join(zipsPath, zipFileName);
    
    // Create zip file with converted JSON files
    await createIdmcJsonZipFile(conversionResult.idmcJsonFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Verify the zip file was created
    if (await fs.pathExists(zipPath)) {
      log.info(`✅ Zip file created successfully: ${zipPath}`);
      const stats = await fs.stat(zipPath);
      log.info(`📊 Zip file size: ${(stats.size / 1024).toFixed(2)} KB`);
    } else {
      log.error(`❌ Zip file was not created: ${zipPath}`);
      throw new Error('Failed to create zip file');
    }
    
    log.info(`🎉 IDMC Summary → JSON conversion completed successfully: ${zipFileName}`);
    
    // Clean up IDMC output folder after packaging
    try {
      const idmcPath = config.paths.idmc || './idmc_output';
      if (await fs.pathExists(idmcPath)) {
        await fs.remove(idmcPath);
        log.info('✅ Cleaned up IDMC output folder');
      }
    } catch (cleanupError) {
      log.warn('⚠️ Error cleaning up IDMC output folder', { error: cleanupError.message });
    }
    
    // Standardized response structure matching Oracle SQL to IDMC summary format
    const result = {
      zipFilename: zipFileName,
      zipFilePath: path.resolve(zipPath),
      results: conversionResult.convertedFiles.map(f => ({
        fileName: f.original || f.converted || 'unknown',
        originalContent: f.originalContent || '',
        convertedContent: f.jsonContent || '',
        success: f.success !== false
      })),
      processing: {
        totalFiles: totalFiles,
        processedFiles: conversionResult.convertedFiles.filter(f => f.success).length,
        failedFiles: conversionResult.convertedFiles.filter(f => !f.success).length,
        successRate: totalFiles > 0 ? Math.round((conversionResult.convertedFiles.filter(f => f.success).length / totalFiles) * 100) : 0
      }
    };
    
    progressService.completeJob(jobId, result);
    
    log.info(`📤 Sending response for job: ${jobId}`);
    
    // Return the result
    res.status(200).json({
      success: true,
      message: 'IDMC Summary → JSON conversion completed successfully',
      source: zipFilePath,
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    log.error('❌ IDMC Summary → JSON conversion failed', { error: error.message, stack: error.stack });
    if (jobId) {
      progressService.failJob(jobId, error.message);
    }
    
    res.status(500).json({ 
      error: 'IDMC Summary → JSON conversion failed', 
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

module.exports = {
  handleConvertIdmcSummaryToJson
};

