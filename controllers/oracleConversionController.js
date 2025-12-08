const oracleFileAnalysisService = require('../services/oracleFileAnalysisService');
const oracleConversionService = require('../services/oracleConversionService');
const progressService = require('../services/progressService');
const jwtUtils = require('../utils/jwtUtils');
const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const archiver = require('archiver');
const { Worker } = require('worker_threads');
const progressEmitter = require('../websocket/progressEmitter');
const config = require('../config');
const { assertPathUnder } = require('../utils/pathUtils');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('controllers/oracleConversionController');

// Helper function to get file size
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const size = oracleFileAnalysisService.formatFileSize(stats.size);
    log.info(`📊 File size: ${size} for ${filePath}`);
    return size;
  } catch (error) {
    log.error(`❌ Error getting file size for ${filePath}`, { error: error.message });
    return 'Unknown';
  }
}

// Oracle to Snowflake conversion function using worker threads
async function convertOracleFilesWithWorkers(extractedPath, analysis, jobId) {
  const convertedFiles = [];
  const snowflakeFiles = [];
  
  // Find all Oracle files and sort them by name for consistent ordering
  const oracleFiles = await oracleConversionService.findOracleFiles(extractedPath);
  const sortedOracleFiles = oracleFiles.sort((a, b) => {
    const nameA = path.basename(a);
    const nameB = path.basename(b);
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  const totalFiles = sortedOracleFiles.length;
  
  log.info(`Found ${totalFiles} Oracle files to convert using worker threads`);
  log.info(`📋 Files in order:`);
  sortedOracleFiles.forEach((file, index) => {
    log.info(`  ${index + 1}. ${path.basename(file)}`);
  });
  
  if (totalFiles === 0) {
    log.warn('⚠️ No Oracle files found to convert');
    return {
      convertedFiles: [],
      snowflakeFiles: [],
      totalConverted: 0,
      totalFiles: 0
    };
  }
  
  // Use workers for all file counts - they're more efficient
  log.info(`📝 Processing ${totalFiles} files using worker threads`);
  
  // Create converted directory
  const convertedPath = config.paths.output || './converted';
  await fs.ensureDir(convertedPath);
  
  // Process files in parallel using worker threads
  const maxWorkers = Math.min(8, totalFiles); // Use up to 8 workers
  const workers = [];
  const fileQueue = [...sortedOracleFiles];
  const results = [];
  
  log.info(`Starting ${maxWorkers} worker threads for parallel processing`);
  
  // Create workers
  for (let i = 0; i < maxWorkers; i++) {
    const worker = new Worker(path.join(__dirname, '..', 'workers', 'oracleConversionWorker.js'));
    worker.workerId = i + 1; // Add worker ID for tracking
    workers.push(worker);
    
    log.info(`🔧 Created Worker ${worker.workerId}`);
    
    worker.on('message', (result) => {
      if (result.success) {
        log.info(`✅ Worker ${worker.workerId} completed: ${result.result.converted} (${results.length + 1}/${totalFiles})`);
        results.push(result.result);
        
        // Update progress
        const progress = Math.round((results.length / totalFiles) * 90);
        progressService.updateProgress(jobId, 1, progress, `Converted ${results.length}/${totalFiles} files`);
        
        // Process next file if available
        if (fileQueue.length > 0) {
          const nextFile = fileQueue.shift();
          log.info(`🔄 Worker ${worker.workerId} processing next file: ${path.basename(nextFile)}`);
          worker.postMessage({
            filePath: nextFile,
            extractedPath: extractedPath,
            convertedPath: convertedPath
          });
        } else {
          log.info(`🏁 Worker ${worker.workerId} finished all assigned files`);
          worker.terminate();
        }
      } else {
        log.error(`❌ Worker ${worker.workerId} error: ${result.error}`);
        results.push({
          original: 'unknown',
          converted: null,
          success: false,
          error: result.error
        });
        
        // Process next file if available
        if (fileQueue.length > 0) {
          const nextFile = fileQueue.shift();
          log.info(`🔄 Worker ${worker.workerId} retrying with next file: ${path.basename(nextFile)}`);
          worker.postMessage({
            filePath: nextFile,
            extractedPath: extractedPath,
            convertedPath: convertedPath
          });
        } else {
          log.info(`🏁 Worker ${worker.workerId} finished all assigned files`);
          worker.terminate();
        }
      }
    });
    
    worker.on('error', (error) => {
      log.error(`❌ Worker ${worker.workerId} error`, { error: error.message, stack: error.stack });
    });
    
    worker.on('exit', (code) => {
      log.info(`🔚 Worker ${worker.workerId} exited with code ${code}`);
    });
  }
  
  // Start processing files
  log.info(`🚀 Starting ${Math.min(maxWorkers, fileQueue.length)} workers with initial files...`);
  log.info(`📊 Queue status: ${fileQueue.length} files remaining`);
  for (let i = 0; i < Math.min(maxWorkers, fileQueue.length); i++) {
    const file = fileQueue.shift();
    log.info(`🔄 Worker ${i + 1} starting with: ${path.basename(file)}`);
    workers[i].postMessage({
      filePath: file,
      extractedPath: extractedPath,
      convertedPath: convertedPath
    });
  }
  
  // Wait for all workers to complete with timeout
  log.info(`⏳ Waiting for ${totalFiles} files to be processed by ${maxWorkers} workers...`);
  const startTime = Date.now();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      log.warn('⚠️ Worker timeout after 10 minutes');
      workers.forEach(worker => worker.terminate());
      reject(new Error('Worker timeout'));
    }, 600000); // 10 minute timeout
    
    const checkCompletion = () => {
      if (results.length === totalFiles) {
        clearTimeout(timeout);
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        log.info(`🎉 All workers completed in ${duration.toFixed(2)} seconds`);
        log.info(`📊 Performance: ${(totalFiles / duration).toFixed(2)} files/second`);
        resolve();
      } else {
        setTimeout(checkCompletion, 100);
      }
    };
    checkCompletion();
  }).catch(async (error) => {
    log.error('❌ Worker processing failed', { error: error.message });
    workers.forEach(worker => worker.terminate());
    throw error; // Re-throw the error instead of falling back
  });
  
  // Process results
  for (const result of results) {
    convertedFiles.push(result);
    
    if (result.success) {
      snowflakeFiles.push({
        name: result.converted,
        content: result.snowflakeContent,
        fileType: result.fileType
      });
    }
  }
  
  // Sort convertedFiles by original filename to maintain consistent order in response
  convertedFiles.sort((a, b) => {
    const nameA = a.original || '';
    const nameB = b.original || '';
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Sort snowflakeFiles by name to maintain consistent order in zip
  snowflakeFiles.sort((a, b) => {
    const nameA = a.name;
    const nameB = b.name;
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  log.info(`📋 Converted files in response order:`);
  convertedFiles.forEach((file, index) => {
    log.info(`  ${index + 1}. ${file.original} -> ${file.converted}`);
  });
  
  log.info(`📋 Snowflake files in zip order:`);
  snowflakeFiles.forEach((file, index) => {
    log.info(`  ${index + 1}. ${file.name}`);
  });
  
  log.info(`Worker conversion completed: ${convertedFiles.filter(f => f.success).length}/${totalFiles} files converted successfully`);
  
  return {
    convertedFiles,
    snowflakeFiles,
    totalConverted: convertedFiles.filter(f => f.success).length,
    totalFiles: totalFiles,
    errors: convertedFiles.filter(f => !f.success)
  };
}

// Oracle to Snowflake conversion function with progress tracking (sequential fallback)
async function convertOracleFilesWithProgress(extractedPath, analysis, jobId) {
  const convertedFiles = [];
  const snowflakeFiles = [];
  
  // Find all Oracle files and sort them by name for consistent ordering
  const oracleFiles = await oracleConversionService.findOracleFiles(extractedPath);
  const sortedOracleFiles = oracleFiles.sort((a, b) => {
    const nameA = path.basename(a);
    const nameB = path.basename(b);
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  const totalFiles = sortedOracleFiles.length;
  
  log.info(`Found ${totalFiles} Oracle files to convert`);
  log.info(`📋 Files in order:`);
  sortedOracleFiles.forEach((file, index) => {
    log.info(`  ${index + 1}. ${path.basename(file)}`);
  });
  
  if (totalFiles === 0) {
    log.warn('⚠️ No Oracle files found to convert');
    return {
      convertedFiles: [],
      snowflakeFiles: [],
      totalConverted: 0,
      totalFiles: 0
    };
  }
  
  // Process files one by one with progress updates
  for (let i = 0; i < totalFiles; i++) {
    const currentFilePath = sortedOracleFiles[i];
    try {
      log.info(`Processing file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      // Update progress for this step
      const stepProgress = Math.round(((i + 1) / totalFiles) * 90); // 90% of step 1
      progressService.updateProgress(jobId, 1, stepProgress, `Converting file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      // Check file size to estimate conversion time
      const fileStats = await fs.stat(currentFilePath);
      const fileSizeKB = Math.round(fileStats.size / 1024);
      log.info(`  File size: ${fileSizeKB} KB`);
      
      const oracleCode = await fs.readFile(currentFilePath, 'utf8');
      const relativePath = path.relative(extractedPath, currentFilePath);
      const fileType = await oracleConversionService.analyzeFileType(currentFilePath);
      const snowflakeFileName = oracleConversionService.getSnowflakeFileName(relativePath, fileType);
      
      log.info(`Converting: ${path.basename(currentFilePath)} -> ${snowflakeFileName} (type: ${fileType})`);
      
      // Convert Oracle to Snowflake
      log.info(`🔄 Calling LLM conversion for: ${snowflakeFileName}`);
      
      // Add timeout to prevent hanging - increased to 2 minutes for complex files
      const conversionPromise = oracleConversionService.convertOracleToSnowflake(oracleCode, path.basename(currentFilePath), fileType);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('LLM conversion timeout after 2 minutes')), 120000)
      );
      
      const snowflakeCode = await Promise.race([conversionPromise, timeoutPromise]);
      log.info(`✅ LLM conversion completed for: ${snowflakeFileName}`);
      
      // Create temporary converted folder structure and save files
      const convertedPath = config.paths.output || './converted';
      const snowflakeFilePath = path.join(convertedPath, snowflakeFileName);
      
      // Ensure the target folder exists
      await fs.ensureDir(path.dirname(snowflakeFilePath));
      
      // Write the converted file to the temporary converted folder
      await fs.writeFile(snowflakeFilePath, snowflakeCode, 'utf8');
      
      log.info(`💾 Created file: ${snowflakeFilePath}`);
      log.info(`📁 File type: ${fileType}`);
      log.info(`📁 Snowflake filename: ${snowflakeFileName}`);
      
      convertedFiles.push({
        original: relativePath,
        converted: snowflakeFileName,
        snowflakeContent: snowflakeCode,
        oracleContent: oracleCode,
        fileType: fileType,
        success: true
      });
      
      snowflakeFiles.push({
        name: snowflakeFileName,
        content: snowflakeCode,
        fileType: fileType
      });
      
      log.info(`✅ Converted: ${path.basename(currentFilePath)} -> ${snowflakeFileName}`);
      
    } catch (error) {
      log.error(`❌ Error converting file ${currentFilePath}`, { error: error.message, stack: error.stack });
      
      // Add failed file to results for tracking
      convertedFiles.push({
        original: path.relative(extractedPath, currentFilePath),
        converted: null,
        snowflakeContent: null,
        oracleContent: null,
        fileType: null,
        success: false,
        error: error.message
      });
      
      // Continue with next file instead of failing completely
      log.warn(`⚠️ Continuing with next file...`);
    }
  }
  
  // Sort convertedFiles by original filename to maintain consistent order in response
  convertedFiles.sort((a, b) => {
    const nameA = a.original || '';
    const nameB = b.original || '';
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  // Sort snowflakeFiles by name to maintain consistent order in zip
  snowflakeFiles.sort((a, b) => {
    const nameA = a.name;
    const nameB = b.name;
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  
  log.info(`📋 Converted files in response order:`);
  convertedFiles.forEach((file, index) => {
    log.info(`  ${index + 1}. ${file.original} -> ${file.converted}`);
  });
  
  log.info(`📋 Snowflake files in zip order:`);
  snowflakeFiles.forEach((file, index) => {
    log.info(`  ${index + 1}. ${file.name}`);
  });
  
  log.info(`Conversion completed: ${convertedFiles.filter(f => f.success).length}/${totalFiles} files converted successfully`);
  
  return {
    convertedFiles,
    snowflakeFiles,
    totalConverted: convertedFiles.filter(f => f.success).length,
    totalFiles: totalFiles,
    errors: convertedFiles.filter(f => !f.success)
  };
}

// Test function that uses a sample Oracle zip file
const handleTestConversion = async (req, res) => {
  let extractedPath = null;
  const jobId = `test_oracle_migration`;
  
  try {
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    log.info(`🚀 Starting test Oracle → Snowflake migration job: ${jobId}`);
    
    // Use the sample Oracle zip file we created
    const sampleOraclePath = path.join(__dirname, '..', 'sample-oracle-files.zip');
    
    // Check if sample file exists
    if (!await fs.pathExists(sampleOraclePath)) {
      log.error('❌ Sample Oracle zip file not found', { path: sampleOraclePath });
      throw new Error('Sample Oracle zip file not found. Please ensure sample-oracle-files.zip exists in the project root.');
    }
    
    log.info('📦 Using sample Oracle zip file: ' + sampleOraclePath);
    
    // Extract the zip file
    log.info('📦 Extracting sample Oracle zip file...');
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');
    const uploadPath = config.paths.uploads;
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    
    // Use system unzip command for better reliability
    try {
      await execAsync(`unzip -q "${sampleOraclePath}" -d "${extractedPath}"`);
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
        
        fs.createReadStream(sampleOraclePath)
          .pipe(extract);
      });
    }
    
    log.info(`✅ Sample Oracle files ready at: ${extractedPath}`);
    
    // Step 1: Analyze the Oracle project
    log.info('🔍 Analyzing Oracle project...');
    progressService.updateProgress(jobId, 0, 50, 'Analyzing Oracle project...');
    const analysis = await oracleFileAnalysisService.analyzeOracleProjectFromDirectory(extractedPath);
    progressService.updateProgress(jobId, 0, 100, 'Analysis complete');
    log.info(`✅ Analysis complete: ${analysis.totalFiles} Oracle files found`);
    
    // Step 2: Convert Oracle to Snowflake
    log.info('🔄 Starting Oracle → Snowflake conversion...');
    progressService.updateProgress(jobId, 1, 10, 'Starting Oracle → Snowflake conversion...');
    
    // Debug: List all Oracle files found
    const oracleFiles = await oracleConversionService.findOracleFiles(extractedPath);
    const sortedOracleFiles = oracleFiles.sort((a, b) => {
      const nameA = path.basename(a);
      const nameB = path.basename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    log.info(`🔍 Found ${sortedOracleFiles.length} Oracle files:`);
    sortedOracleFiles.forEach((file, index) => {
      log.info(`  ${index + 1}. ${path.relative(extractedPath, file)}`);
    });
    
    const conversionResult = await convertOracleFilesWithWorkers(extractedPath, analysis, jobId);
    progressService.updateProgress(jobId, 1, 100, 'Conversion complete');
    log.info(`✅ Conversion complete: ${conversionResult.totalConverted}/${conversionResult.totalFiles} files converted`);
    
    // Step 3: Create final ZIP with converted files
    log.info('📦 Creating final package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final package...');
    const outputPath = config.paths.output;
    await fs.ensureDir(outputPath);
    
    // Generate unique zip filename with timestamp and job ID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `converted_oracle_snowflake_${timestamp}.zip`;
    const zipPath = path.join(outputPath, zipFileName);
    
    // Create zip file with converted Snowflake files
    await createSnowflakeZipFile(conversionResult.snowflakeFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Verify the zip file was created
    if (await fs.pathExists(zipPath)) {
      log.info(`✅ Zip file created successfully: ${zipPath}`);
      const stats = await fs.stat(zipPath);
      log.info(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(stats.size)}`);
    } else {
      log.error(`❌ Zip file was not created: ${zipPath}`);
    }
    
    log.info(`🎉 Test Oracle → Snowflake migration completed successfully: ${zipFileName}`);
    
    // Get file size for logging
    const zipStats = await fs.stat(zipPath);
    log.info(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(zipStats.size)}`);
    log.info(`📦 Zip file ready for download via /api/download endpoint`);
    
    // Clean up converted folder after zip creation
    log.info('🧹 Cleaning up converted folder...');
    const convertedPath = config.paths.output || './converted';
    if (await fs.pathExists(convertedPath)) {
      await fs.remove(convertedPath);
      log.info('✅ Converted folder cleaned up');
    }
    
    // Complete the job
    const result = {
      analysis: {
        totalFiles: analysis.totalFiles,
        sqlFiles: analysis.sqlFiles,
        plsqlFiles: analysis.plsqlFiles,
        linesOfCode: analysis.totalLinesOfCode,
        fileSize: oracleFileAnalysisService.formatFileSize(analysis.fileSize),
        procedures: analysis.procedures.length,
        functions: analysis.functions.length,
        packages: analysis.packages.length,
        tables: analysis.tables.length,
        views: analysis.views.length,
        triggers: analysis.triggers.length,
        sequences: analysis.sequences.length,
        dependencies: analysis.dependencies.length,
        plsqlFilesList: analysis.plsqlFilesList
      },
      conversion: {
        totalConverted: conversionResult.totalConverted,
        totalFiles: conversionResult.totalFiles,
        successRate: Math.round((conversionResult.totalConverted / conversionResult.totalFiles) * 100),
        convertedFiles: conversionResult.convertedFiles,
        errors: conversionResult.errors
      },
      zipFilename: zipFileName
    };
    
    progressService.completeJob(jobId, result);
    
    log.info(`📤 Sending test response for job: ${jobId}`);
    
    // Return the result
    res.status(200).json({
      success: true,
      message: 'Test Oracle → Snowflake migration completed successfully',
      source: 'sample-oracle-files.zip (15 comprehensive Oracle procedures)',
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    log.error('❌ Test Oracle → Snowflake migration failed', { error: error.message, stack: error.stack });
    progressService.failJob(jobId, error.message);
    res.status(500).json({ 
      error: 'Test Oracle → Snowflake migration failed', 
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

// Convert API that takes a zip file path or direct code
const handleConvert = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath, sourceCode, fileName } = req.body;
    
    // Handle direct code input if provided
    if (sourceCode) {
      log.info(`🔄 Processing direct code conversion request`);
      
      // Use the file name provided or default to input.sql
      const inputFileName = fileName || 'input.sql';
      
      // Convert the code directly
      const convertedCode = await oracleConversionService.convertOracleCodeToSnowflake(sourceCode, inputFileName);

      // Persist output artifacts per requested format (sql|json|docx|all)
      const outputsRoot = config.paths.output;
      await fs.ensureDir(outputsRoot);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = inputFileName.endsWith('.sql') ? inputFileName.replace(/\.sql$/i, '') : inputFileName;
      const { outputFormat = 'sql' } = req.body || {};
      const wantSql = outputFormat === 'sql' || outputFormat === 'all';
      const wantJson = outputFormat === 'json' || outputFormat === 'all';
      const wantDocx = outputFormat === 'docx' || outputFormat === 'all';
      const outputFiles = [];

      if (wantSql) {
        const outFileName = `${base}_snowflake_${timestamp}.sql`;
        const outPath = path.join(outputsRoot, outFileName);
        await fs.writeFile(outPath, convertedCode, 'utf8');
        outputFiles.push({ name: outFileName, path: path.resolve(outPath), mime: 'text/sql', kind: 'single' });
      }
      if (wantJson) {
        const jsonName = `${base}_snowflake_${timestamp}.json`;
        const jsonPath = path.join(outputsRoot, jsonName);
        await fs.writeFile(jsonPath, JSON.stringify({ fileName: inputFileName, snowflake: convertedCode }, null, 2), 'utf8');
        outputFiles.push({ name: jsonName, path: path.resolve(jsonPath), mime: 'application/json', kind: 'single' });
      }
      if (wantDocx) {
        const documentService = require('../services/documentService');
        const docxBuf = await documentService.markdownToDocxBuffer('``\`sql\n' + convertedCode + '\n``\`', inputFileName);
        const docxName = `${base}_snowflake_${timestamp}.docx`;
        const docxPath = path.join(outputsRoot, docxName);
        await fs.writeFile(docxPath, docxBuf);
        outputFiles.push({ name: docxName, path: path.resolve(docxPath), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'single' });
      }

      return res.status(200).json({
        success: true,
        fileName: inputFileName,
        conversionType: 'oracle-to-snowflake',
        originalContent: sourceCode,
        convertedContent: convertedCode,
        outputFiles
      });
    }
    
    if (!zipFilePath) {
      return res.status(400).json({ 
        error: 'Either source code or zipFilePath is required',
        example: { zipFilePath: '/path/to/your/oracle-files.zip' }
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
      assertPathUnder([config.paths.uploads, config.paths.output], zipFilePath, 'File path outside allowed roots');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    
    // Create job ID based on zip base name
    const zipBaseName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `convert_${zipBaseName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    log.info(`🚀 Starting Oracle → Snowflake conversion job: ${jobId}`);
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
    
    // Step 1: Analyze the Oracle project
    log.info('🔍 Analyzing Oracle project...');
    progressService.updateProgress(jobId, 0, 50, 'Analyzing Oracle project...');
    const analysis = await oracleFileAnalysisService.analyzeOracleProjectFromDirectory(extractedPath);
    progressService.updateProgress(jobId, 0, 100, 'Analysis complete');
    log.info(`✅ Analysis complete: ${analysis.totalFiles} Oracle files found`);
    
    // Step 2: Convert Oracle to Snowflake
    log.info('🔄 Starting Oracle → Snowflake conversion...');
    progressService.updateProgress(jobId, 1, 10, 'Starting Oracle → Snowflake conversion...');
    
    // Debug: List all Oracle files found
    const oracleFiles = await oracleConversionService.findOracleFiles(extractedPath);
    const sortedOracleFiles = oracleFiles.sort((a, b) => {
      const nameA = path.basename(a);
      const nameB = path.basename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    log.info(`🔍 Found ${sortedOracleFiles.length} Oracle files:`);
    sortedOracleFiles.forEach((file, index) => {
      log.info(`  ${index + 1}. ${path.relative(extractedPath, file)}`);
    });
    
    const conversionResult = await convertOracleFilesWithWorkers(extractedPath, analysis, jobId);
    progressService.updateProgress(jobId, 1, 100, 'Conversion complete');
    log.info(`✅ Conversion complete: ${conversionResult.totalConverted}/${conversionResult.totalFiles} files converted`);
    
    // Step 3: Create final ZIP with converted files
    log.info('📦 Creating final package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final package...');
    const outputPath = config.paths.output;
    await fs.ensureDir(outputPath);
    
    // Generate unique zip filename with timestamp and job ID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `converted_oracle_snowflake_${timestamp}.zip`;
    const zipPath = path.join(outputPath, zipFileName);
    
    // Create zip file with converted Snowflake files
    await createSnowflakeZipFile(conversionResult.snowflakeFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Verify the zip file was created
    if (await fs.pathExists(zipPath)) {
      log.info(`✅ Zip file created successfully: ${zipPath}`);
      const stats = await fs.stat(zipPath);
      log.info(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(stats.size)}`);
    } else {
      log.error(`❌ Zip file was not created: ${zipPath}`);
      throw new Error('Failed to create zip file');
    }
    
    log.info(`🎉 Oracle → Snowflake conversion completed successfully: ${zipFileName}`);
    
    // Get file size for logging
    const zipStats = await fs.stat(zipPath);
    log.info(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(zipStats.size)}`);
    log.info(`📦 Zip file ready for download via /api/download endpoint`);
    
    // Clean up converted folder after zip creation
    log.info('🧹 Cleaning up converted folder...');
    const convertedPath = config.paths.output || './converted';
    if (await fs.pathExists(convertedPath)) {
      await fs.remove(convertedPath);
      log.info('✅ Converted folder cleaned up');
    }
    
    // Standardized response structure for all ZIP conversions
    const result = {
      zipFilename: zipFileName,
      zipFilePath: path.resolve(zipPath),
      results: conversionResult.convertedFiles.map(f => ({
        fileName: f.original || f.converted || 'unknown',
        originalContent: f.oracleContent || '',
        convertedContent: f.snowflakeContent || '',
        success: f.success !== false
      })),
      processing: {
        totalFiles: conversionResult.totalFiles,
        processedFiles: conversionResult.totalConverted,
        failedFiles: conversionResult.errors ? conversionResult.errors.length : 0,
        successRate: conversionResult.totalFiles > 0 ? Math.round((conversionResult.totalConverted / conversionResult.totalFiles) * 100) : 0
      },
      analysis: {
        totalFiles: analysis.totalFiles,
        sqlFiles: analysis.sqlFiles,
        plsqlFiles: analysis.plsqlFiles,
        linesOfCode: analysis.totalLinesOfCode,
        fileSize: oracleFileAnalysisService.formatFileSize(analysis.fileSize),
        procedures: analysis.procedures.length,
        functions: analysis.functions.length,
        packages: analysis.packages.length,
        tables: analysis.tables.length,
        views: analysis.views.length,
        triggers: analysis.triggers.length,
        sequences: analysis.sequences.length,
        dependencies: analysis.dependencies.length,
        plsqlFilesList: analysis.plsqlFilesList
      }
    };
    
    progressService.completeJob(jobId, result);
    
    log.info(`📤 Sending response for job: ${jobId}`);
    
    // Return the result
    res.status(200).json({
      success: true,
      message: 'Oracle → Snowflake conversion completed successfully',
      source: zipFilePath,
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    log.error('❌ Oracle → Snowflake conversion failed', { error: error.message, stack: error.stack });
    progressService.failJob(jobId, error.message);
    
    res.status(500).json({ 
      error: 'Oracle → Snowflake conversion failed', 
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

// Function to create zip file with Snowflake converted files
async function createSnowflakeZipFile(snowflakeFiles, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`📦 Zip file created: ${archive.pointer()} bytes`);
      resolve();
    });
    
    archive.on('error', (err) => {
      console.error('❌ Error creating zip file:', err);
      reject(err);
    });
    
    archive.pipe(output);
    
    // Add converted Snowflake files
    for (const file of snowflakeFiles) {
      if (file.content) {
        archive.append(file.content, { name: file.name });
        console.log(`📄 Added to zip: ${file.name}`);
      }
    }
    
    archive.finalize();
  });
}

// Function to get progress status
const getProgress = async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const job = progressService.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        error: 'Job not found',
        jobId: jobId
      });
    }
    
    res.status(200).json({
      success: true,
      job: job
    });
    
  } catch (error) {
    log.error('Error getting progress', { error: error.message });
    res.status(500).json({ 
      error: 'Error getting progress', 
      details: error.message 
    });
  }
};

// Function to serve the generated zip file
const serveZipFile = async (req, res) => {
  try {
    const { filename, filePath } = req.body;
    
    // If filePath is provided, allow downloading files generated under known output roots
    if (filePath) {
      const allowedRoots = [
        path.resolve(config.paths.output),
        path.resolve(config.paths.idmc || './idmc_output')
      ];
      const resolved = path.resolve(filePath);
      const isAllowed = allowedRoots.some(root => resolved.startsWith(root + path.sep) || resolved === root);
      if (!isAllowed) {
        return res.status(400).json({ error: 'Invalid filePath', message: 'Requested path is not in an allowed output directory' });
      }
      const stats = await fs.stat(resolved);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Invalid file type', message: 'Requested path is not a file' });
      }
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(resolved)}"`);
      return fs.createReadStream(resolved).pipe(res);
    }

    // Lookup filename in output folder only
    if (!filename) {
      return res.status(400).json({ 
        error: 'Invalid filename',
        message: 'Filename is required',
        example: { filename: 'converted_oracle_snowflake_2024-01-15T10-30-45-123Z.zip' }
      });
    }

    // Security check (already validated in middleware, but double-check)
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ 
        error: 'Invalid filename',
        message: 'Filename cannot contain invalid characters',
        example: { filename: 'converted_oracle_snowflake_2024-01-15T10-30-45-123Z.zip' }
      });
    }

    // Look for file in output folder only
    const outputPath = config.paths.output;
    const resolvedFilePath = path.join(outputPath, filename);
    
    // Check if file exists
    if (!await fs.pathExists(resolvedFilePath)) {
      return res.status(404).json({ 
        error: 'File not found',
        filename: filename,
        message: 'The requested file does not exist or has been removed',
        searchedPath: outputPath
      });
    }
    
    // Get file stats
    const fileStats = await fs.stat(resolvedFilePath);
    if (!fileStats.isFile()) {
      return res.status(400).json({ 
        error: 'Invalid file type',
        message: 'Requested path is not a file'
      });
    }
    
    const fileToServe = resolvedFilePath;
    
    // Determine content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.zip': 'application/zip',
      '.json': 'application/json',
      '.sql': 'text/sql',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.txt': 'text/plain',
      '.pdf': 'application/pdf',
      '.bin': 'application/octet-stream'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    log.info(`📥 Serving file: ${filename} from output folder (${oracleFileAnalysisService.formatFileSize(fileStats.size)})`);
    
    // Set appropriate headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', fileStats.size);
    
    // Stream the file to the client
    const fileStream = fs.createReadStream(fileToServe);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      log.error('Error streaming zip file', { error: error.message });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });
    
  } catch (error) {
    log.error('Error serving zip file', { error: error.message });
    res.status(500).json({ 
      error: 'Error serving zip file', 
      details: error.message 
    });
  }
};

// Direct code conversion handler
const handleDirectCodeConversion = async (req, res) => {
  try {
    const { sourceCode, fileName = 'input.sql', conversionType = 'oracle-to-snowflake' } = req.body;
    log.info(`🔄 Processing direct code conversion request for type: ${conversionType}`);
    
    let convertedCode = '';
    let mappingSummary = null;
    
    // Process based on conversion type
    if (conversionType === 'oracle-to-snowflake') {
      // Convert Oracle code to Snowflake
      convertedCode = await oracleConversionService.convertOracleCodeToSnowflake(sourceCode, fileName);
    } else if (conversionType === 'oracle-to-idmc') {
      // Convert Oracle code to IDMC mapping
      const idmcService = require('../services/idmcConversionService');
      mappingSummary = await idmcService.convertOracleCodeToIdmc(sourceCode, fileName);
    } else if (conversionType === 'redshift-to-idmc') {
      // Convert Redshift code to IDMC mapping
      const idmcService = require('../services/idmcConversionService');
      mappingSummary = await idmcService.convertRedshiftCodeToIdmc(sourceCode, fileName);
    }
    
    // For Snowflake single-file conversions, also persist a .sql output
    if (conversionType === 'oracle-to-snowflake') {
      const outputsRoot = config.paths.output;
      await fs.ensureDir(outputsRoot);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = fileName.endsWith('.sql') ? fileName.replace(/\.sql$/i, '') : fileName;
      const outFileName = `${base}_snowflake_${timestamp}.sql`;
      const outPath = path.join(outputsRoot, outFileName);
      await fs.writeFile(outPath, convertedCode, 'utf8');

    return res.status(200).json({
      success: true,
      fileName,
      conversionType,
        originalContent: req.body.sourceCode,
        convertedContent: convertedCode,
        outputFiles: [ { name: outFileName, path: path.resolve(outPath), mime: 'text/sql', kind: 'single' } ]
      });
    }

    // Return IDMC mapping summary including original content for UI display
    return res.status(200).json({
      success: true,
      fileName,
      conversionType,
      originalContent: req.body.sourceCode,
      convertedContent: mappingSummary
    });
  } catch (error) {
    log.error('❌ Error in direct code conversion', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: error.message || 'An error occurred during code conversion'
    });
  }
};

// Helper: find SQL-like files for IDMC auto/redshift/oracle flows
async function findSqlLikeFiles(directory) {
  const files = [];
  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ([".sql", ".pls", ".pkg", ".prc", ".fnc", ".rs", ".redshift"].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  await scanDir(directory);
  return files;
}

// IDMC conversion using worker threads (for ZIP unified flow)
async function convertIDMCFilesWithWorkers(extractedPath, files, jobId) {
  const maxWorkers = Math.min(8, files.length || 0);
  if (maxWorkers === 0) {
    return { idmcFiles: [], convertedFiles: [] };
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
      const worker = new Worker(path.join(__dirname, '..', 'workers', 'idmcConversionWorker.js'));
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
  const idmcFiles = [];
  const convertedFiles = [];

  // Write files to disk for zipping
  const idmcOutRoot = process.env.IDMC_PATH || './idmc_output';
  await fs.ensureDir(idmcOutRoot);

  for (const r of results) {
    if (r.success) {
      const outPath = path.join(idmcOutRoot, r.converted);
      await fs.ensureDir(path.dirname(outPath));
      await fs.writeFile(outPath, r.idmcContent, 'utf8');
      idmcFiles.push({ name: r.converted, content: r.idmcContent, fileType: r.detectedType });
      convertedFiles.push({ original: r.original, converted: r.converted, idmcContent: r.idmcContent, detectedType: r.detectedType, originalContent: r.originalContent, success: true });
    } else {
      convertedFiles.push({ original: null, converted: null, idmcContent: null, detectedType: null, success: false, error: r.error });
    }
  }

  // Keep deterministic order by filename
  idmcFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  convertedFiles.sort((a, b) => (a.original || '').localeCompare(b.original || '', undefined, { numeric: true, sensitivity: 'base' }));

  return { idmcFiles, convertedFiles };
}

// Heuristic: detect Oracle vs Redshift using both file name and content
function detectSourceTypeFromNameAndContent(fileName, content, fallback = 'sql') {
  try {
    const name = (fileName || '').toLowerCase();
    const upper = (content || '').toUpperCase();

    // Strong filename hints
    if (/(redshift|rs_\b|\brs_|_rs\b|\bredshift\b)/i.test(fileName || '')) return 'redshift';
    if (/(oracle|plsql|pkg|pks|pkb)/i.test(fileName || '')) return 'oracle';

    // Content-based indicators (combine Oracle + Redshift cues)
    const oracleCues = (
      upper.includes('VARCHAR2') ||
      upper.includes('NUMBER') ||
      upper.includes('SYSDATE') ||
      upper.includes('DUAL') ||
      upper.includes('NVL(') ||
      upper.includes('DECODE(') ||
      /\bROWNUM\b/.test(upper) ||
      upper.includes('CREATE OR REPLACE')
    );

    const redshiftCues = (
      (upper.includes('CREATE TABLE') && (upper.includes('DISTKEY') || upper.includes('SORTKEY'))) ||
      upper.includes('COPY ') ||
      upper.includes('UNLOAD ') ||
      /\bSTL_\w+\b/.test(upper) ||
      /\bSVL_\w+\b/.test(upper) ||
      upper.includes('CHARACTER VARYING')
    );

    if (oracleCues && !redshiftCues) return 'oracle';
    if (redshiftCues && !oracleCues) return 'redshift';
    if (redshiftCues) return 'redshift';
    if (oracleCues) return 'oracle';
    return fallback;
  } catch (_) {
    return fallback;
  }
}

// Unified convert handler: supports { inputType: 'zip'|'single', target: 'snowflake'|'idmc', sourceType?: 'oracle'|'redshift'|'auto' }
const handleUnifiedConvert = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  try {
    const { inputType, target, sourceType = 'auto', zipFilePath, filePath, sourceCode, fileName, outputFormat = 'json', customFileName } = req.body;

    // Single-file conversions
    if (inputType === 'single') {
      let actualSourceCode = sourceCode;
      let actualFileName = fileName;

      // Handle filePath if provided instead of sourceCode
      if (filePath && !actualSourceCode) {
        if (!await fs.pathExists(filePath)) {
          return res.status(404).json({ error: `File not found: ${filePath}` });
        }
        try {
          assertPathUnder([config.paths.uploads, config.paths.output], filePath, 'File path outside allowed roots');
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
        actualSourceCode = await fs.readFile(filePath, 'utf8');
        actualFileName = actualFileName || path.basename(filePath);
      }

      if (!actualSourceCode) {
        return res.status(400).json({ error: 'sourceCode or filePath is required for single inputType' });
      }

      const outputsRoot = process.env.OUTPUT_PATH || './output';
      await fs.ensureDir(outputsRoot);
      // Support custom file name, otherwise use fileName or default
      const baseName = customFileName 
        ? customFileName.replace(/\s+/g, '_').replace(/\.[^.]+$/g, '')
        : (actualFileName || 'input.sql').replace(/\s+/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      // Emit basic websocket lifecycle for single-file jobs
      const jobIdSingle = `unified_${target}_single_${timestamp}`;
      try {
        const apiCtx = { method: req.method, path: req.originalUrl || req.url, endpoint: 'single-convert' };
        require('../websocket').setJobContext(jobIdSingle, apiCtx);
        progressEmitter.emitJobCreated(jobIdSingle, { steps: [], createdAt: new Date() });
      } catch (_) {}

      if (target === 'snowflake') {
        const convertedCode = await oracleConversionService.convertOracleCodeToSnowflake(actualSourceCode, baseName);
        // Save .sql output - use customFileName if provided, otherwise use standard naming
        const outFileName = customFileName 
          ? (customFileName.endsWith('.sql') ? customFileName : `${customFileName}.sql`)
          : (baseName.endsWith('.sql') ? baseName.replace(/\.sql$/i, `_snowflake_${timestamp}.sql`) : `${baseName}_snowflake_${timestamp}.sql`);
        const outPath = path.join(outputsRoot, outFileName);
        await fs.writeFile(outPath, convertedCode, 'utf8');
        try { progressEmitter.emitStepUpdate(jobIdSingle, 1, 90, 'Saving converted output'); } catch (_) {}
        try { progressEmitter.emitJobCompleted(jobIdSingle, { outputFiles: [{ name: outFileName, path: path.resolve(outPath) }] }); } catch (_) {}
        return res.status(200).json({
          success: true,
          conversionType: 'oracle-to-snowflake',
          fileName: customFileName || baseName,
          jsonContent: convertedCode,
          jobId: jobIdSingle,
          outputFiles: [
            { name: outFileName, path: path.resolve(outPath), mime: 'text/sql', kind: 'single' }
          ]
        });
      }

      // IDMC single: auto-detect when sourceType not provided or set to auto
      const idmcService = require('../services/idmcConversionService');
      const name = baseName;
      let resolvedType = sourceType;
      if (!resolvedType || resolvedType === 'auto') {
        resolvedType = detectSourceTypeFromNameAndContent(name, actualSourceCode, 'sql');
        if (resolvedType === 'sql') {
          // fallback to existing analyzer if inconclusive
          resolvedType = idmcService.analyzeSqlContent(actualSourceCode) || 'sql';
        }
      }

      const idmcSummary = resolvedType === 'redshift'
        ? await idmcService.convertRedshiftToIDMC(actualSourceCode, name, 'sql')
        : await idmcService.convertOracleToIDMC(actualSourceCode, name, 'sql');

      // Persist outputs per requested format
      const wantJson = outputFormat === 'json' || outputFormat === 'all';
      const wantDocx = outputFormat === 'docx' || outputFormat === 'all';
      const wantSql = outputFormat === 'sql' || outputFormat === 'all';
      const outputFiles = [];

      if (wantJson) {
        const jsonName = customFileName 
          ? (customFileName.endsWith('.json') ? customFileName : `${customFileName}.json`)
          : name.replace(/\.[^.]+$/g, `_IDMC_Summary_${timestamp}.json`);
        const jsonPath = path.join(outputsRoot, jsonName);
        await fs.writeFile(jsonPath, idmcSummary, 'utf8');
        outputFiles.push({ name: jsonName, path: path.resolve(jsonPath), mime: 'application/json', kind: 'single' });
      }

      if (wantDocx) {
        const documentService = require('../services/documentService');
        const docxBuf = await documentService.markdownToDocxBuffer(idmcSummary, name);
        const docxName = customFileName 
          ? (customFileName.endsWith('.docx') ? customFileName : `${customFileName}.docx`)
          : name.replace(/\.[^.]+$/g, `_IDMC_Summary_${timestamp}.docx`);
        const docxPath = path.join(outputsRoot, docxName);
        await fs.writeFile(docxPath, docxBuf);
        outputFiles.push({ name: docxName, path: path.resolve(docxPath), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'single' });
      }

      if (wantSql) {
        // Save the original SQL input for convenience
        const sqlName = customFileName 
          ? (customFileName.endsWith('.sql') ? customFileName : `${customFileName}_original.sql`)
          : (name.endsWith('.sql') ? name.replace(/\.sql$/i, `_original_${timestamp}.sql`) : `${name}_original_${timestamp}.sql`);
        const sqlPath = path.join(outputsRoot, sqlName);
        await fs.writeFile(sqlPath, actualSourceCode, 'utf8');
        outputFiles.push({ name: sqlName, path: path.resolve(sqlPath), mime: 'text/sql', kind: 'single' });
      }

      try { progressEmitter.emitStepUpdate(jobIdSingle, 1, 90, 'Saving converted output'); } catch (_) {}
      try { progressEmitter.emitJobCompleted(jobIdSingle, { outputFiles }); } catch (_) {}
      return res.status(200).json({
        success: true,
        conversionType: `${resolvedType}-to-idmc`,
        fileName: customFileName || name,
        jsonContent: idmcSummary,
        originalContent: actualSourceCode,
        jobId: jobIdSingle,
        outputFiles
      });
    }

    // ZIP conversions - handle both zipFilePath (ZIP file) and filePath (single file)
    const actualZipFilePath = zipFilePath || filePath;
    if (!actualZipFilePath) {
      return res.status(400).json({ error: 'zipFilePath or filePath is required for zip inputType', example: { zipFilePath: '/path/to/your/files.zip' } });
    }
    if (!await fs.pathExists(actualZipFilePath)) {
      return res.status(404).json({ error: 'File not found', providedPath: actualZipFilePath });
    }

    // Check if it's a single file (not a ZIP) - if so, treat it as a single file conversion
    const stats = await fs.stat(actualZipFilePath);
    const isZipFile = actualZipFilePath.toLowerCase().endsWith('.zip');
    if (!isZipFile || !stats.isFile()) {
      // It's a single file, not a ZIP - treat it as single file conversion
      try {
        assertPathUnder([config.paths.uploads, config.paths.output], actualZipFilePath, 'File path outside allowed roots');
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const singleFileContent = await fs.readFile(actualZipFilePath, 'utf8');
      const singleFileName = fileName || path.basename(actualZipFilePath);
      // Recursively call with single inputType
      req.body = {
        inputType: 'single',
        target,
        sourceType,
        sourceCode: singleFileContent,
        fileName: singleFileName,
        outputFormat,
        customFileName
      };
      return handleUnifiedConvert(req, res);
    }

    // Validate ZIP file path is under allowed roots
    try {
      assertPathUnder([config.paths.uploads, config.paths.output], actualZipFilePath, 'File path outside allowed roots');
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const baseName = path.basename(actualZipFilePath, path.extname(actualZipFilePath));
    jobId = `unified_${target}_${baseName}`;
    const job = progressService.createJob(jobId);
    try {
      const apiCtx = { method: req.method, path: req.originalUrl || req.url, endpoint: 'unified-convert' };
      require('../websocket').setJobContext(jobId, apiCtx);
    } catch (_) {}
    progressEmitter.emitJobCreated(jobId, job);
    progressService.updateProgress(jobId, 0, 5, 'Initializing conversion...');
    progressEmitter.emitStepUpdate(jobId, 0, 5, 'Initializing conversion...');

    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);

    // Extract
    progressService.updateProgress(jobId, 0, 15, 'Extracting zip file...');
    progressEmitter.emitStepUpdate(jobId, 0, 15, 'Extracting zip file...');
    try {
      await execAsync(`unzip -q "${actualZipFilePath}" -d "${extractedPath}"`);
    } catch (err) {
      await new Promise((resolve, reject) => {
        const extract = unzipper.Extract({ path: extractedPath });
        extract.on('error', reject);
        extract.on('close', () => setTimeout(resolve, 100));
        fs.createReadStream(actualZipFilePath).pipe(extract);
      });
    }

    if (target === 'snowflake') {
      // Reuse existing Oracle->Snowflake flow
      progressService.updateProgress(jobId, 0, 30, 'Analyzing project...');
      progressEmitter.emitStepUpdate(jobId, 0, 30, 'Analyzing project...');
      const analysis = await oracleFileAnalysisService.analyzeOracleProjectFromDirectory(extractedPath);
      progressService.updateProgress(jobId, 1, 10, 'Converting to Snowflake...');
      progressEmitter.emitStepUpdate(jobId, 1, 10, 'Converting to Snowflake...');
      const conversionResult = await convertOracleFilesWithWorkers(extractedPath, analysis, jobId);
      progressService.updateProgress(jobId, 2, 10, 'Packaging results...');
      progressEmitter.emitStepUpdate(jobId, 2, 10, 'Packaging results...');

      const outputPath = config.paths.output;
      await fs.ensureDir(outputPath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outFmt = (req.body && req.body.outputFormat) || 'sql';
      const wantSql = outFmt === 'sql' || outFmt === 'all';
      const wantJson = outFmt === 'json' || outFmt === 'all';
      const wantDocx = outFmt === 'docx' || outFmt === 'all';
      const outZipName = `converted_oracle_snowflake_${(wantDocx&&wantJson&&wantSql)?'all':(wantDocx?'docx':(wantJson?'json':'sql'))}_${timestamp}.zip`;
      const outZipPath = path.join(outputPath, outZipName);

      // Build files for zip per requested formats
      const filesForZip = [];
      for (const f of conversionResult.snowflakeFiles) {
        const baseNoExt = f.name.replace(/\.sql$/i, '');
        if (wantSql) {
          filesForZip.push({ name: `${baseNoExt}.sql`, content: f.content });
        }
        if (wantJson) {
          filesForZip.push({ name: `${baseNoExt}.json`, content: JSON.stringify({ fileName: f.name, snowflake: f.content }, null, 2) });
        }
        if (wantDocx) {
          const documentService = require('../services/documentService');
          const docxBuf = await documentService.markdownToDocxBuffer('``\`sql\n' + f.content + '\n``\`', f.name);
          filesForZip.push({ name: `${baseNoExt}.docx`, content: docxBuf });
        }
      }

      await createSnowflakeZipFile(filesForZip, outZipPath);
      progressService.updateProgress(jobId, 2, 100, 'Completed');
      progressEmitter.emitJobCompleted(jobId, { conversion: conversionResult, zipFilename: outZipName });

      // Standardized response structure for all ZIP conversions
      const result = {
        zipFilename: outZipName,
        zipFilePath: path.resolve(outZipPath),
        results: conversionResult.convertedFiles.map(f => ({
          fileName: f.original || f.converted || 'unknown',
          originalContent: f.oracleContent || '',
          convertedContent: f.snowflakeContent || '',
          success: f.success !== false
        })),
        processing: {
          totalFiles: conversionResult.totalFiles,
          processedFiles: conversionResult.totalConverted,
          failedFiles: conversionResult.errors ? conversionResult.errors.length : 0,
          successRate: conversionResult.totalFiles > 0 ? Math.round((conversionResult.totalConverted / conversionResult.totalFiles) * 100) : 0
        }
      };
      progressService.completeJob(jobId, result);
      return res.status(200).json({ success: true, target, jobId, ...result });
    }

    // IDMC (zip): use worker pool for per-file conversion
    progressService.updateProgress(jobId, 1, 10, 'Scanning files...');
    progressEmitter.emitStepUpdate(jobId, 1, 10, 'Scanning files...');
    const allFiles = await findSqlLikeFiles(extractedPath);
    const sorted = allFiles.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
    const total = sorted.length;
    const { idmcFiles, convertedFiles } = await convertIDMCFilesWithWorkers(extractedPath, sorted, jobId);

    // Optionally render DOCX/PDF variants of the IDMC summaries
    const filesForZip = [];
    // Normalize outputFormat to lowercase and trim whitespace
    const normalizedOutputFormat = (outputFormat || 'json').toString().toLowerCase().trim();
    const wantDocx = normalizedOutputFormat === 'docx' || normalizedOutputFormat === 'all';
    const wantJson = normalizedOutputFormat === 'json' || normalizedOutputFormat === 'all';
    const wantPdf = normalizedOutputFormat === 'pdf' || normalizedOutputFormat === 'all';

    log.info(`📋 Output format: "${outputFormat}" (normalized: "${normalizedOutputFormat}"), wantJson: ${wantJson}, wantDocx: ${wantDocx}, wantPdf: ${wantPdf}`);
    log.info(`📋 Processing ${idmcFiles.length} IDMC files`);

    // CRITICAL: Never add .md files to zip - only add files in the requested format
    // Convert to requested format (docx, json, etc.) - NEVER use .md extension
    const documentService = require('../services/documentService');
    for (const f of idmcFiles) {
      if (wantDocx) {
        log.info(`📄 Converting ${f.name} to DOCX format`);
        const docxBuf = await documentService.markdownToDocxBuffer(f.content, f.name);
        // Replace .md extension with .docx - use path module for reliable extension handling
        const ext = path.extname(f.name);
        const baseName = f.name.substring(0, f.name.length - ext.length);
        const docxName = baseName + '.docx';
        log.info(`📄 Adding ${docxName} to zip (original: ${f.name}, ext: ${ext})`);
        filesForZip.push({ name: docxName, content: docxBuf });
      }
      if (wantJson) {
        // For JSON format, save as .json file (not .md)
        const ext = path.extname(f.name);
        const baseName = f.name.substring(0, f.name.length - ext.length);
        const jsonName = baseName + '.json';
        const jsonContent = JSON.stringify({ content: f.content }, null, 2);
        log.info(`📄 Adding ${jsonName} to zip`);
        filesForZip.push({ name: jsonName, content: jsonContent });
      }
      // PDF generation not implemented to avoid heavy deps; reserved for future
    }

    log.info(`📦 Total files to add to zip: ${filesForZip.length}`);
    filesForZip.forEach((f, i) => log.info(`  ${i + 1}. ${f.name}`));
    
    // Final validation: ensure NO .md files are ever in the zip
    const mdFiles = filesForZip.filter(f => f.name.endsWith('.md'));
    if (mdFiles.length > 0) {
      log.error(`❌ ERROR: Found ${mdFiles.length} .md files in zip! Removing them...`);
      mdFiles.forEach(f => log.error(`  - ${f.name}`));
      // Remove .md files
      const filesForZipFiltered = filesForZip.filter(f => !f.name.endsWith('.md'));
      log.info(`📦 Filtered ${filesForZip.length - filesForZipFiltered.length} .md files, keeping ${filesForZipFiltered.length} files`);
      filesForZip.length = 0;
      filesForZip.push(...filesForZipFiltered);
    }

    const outputPath = config.paths.output;
    await fs.ensureDir(outputPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = normalizedOutputFormat === 'json' ? 'json' : (normalizedOutputFormat === 'docx' ? 'docx' : (normalizedOutputFormat === 'pdf' ? 'pdf' : 'all'));
    const outZipName = `idmc_summaries_${suffix}_${timestamp}.zip`;
    const outZipPath = path.join(outputPath, outZipName);
    await createSnowflakeZipFile(filesForZip, outZipPath); // same zip helper works with {name,content}
    progressService.updateProgress(jobId, 2, 100, 'Completed');

    // Cleanup IDMC output folder after packaging
    try {
      const idmcPath = process.env.IDMC_PATH || './idmc_output';
      if (await fs.pathExists(idmcPath)) {
        await fs.remove(idmcPath);
      }
    } catch (_) {
      // ignore cleanup errors
    }
    progressEmitter.emitJobCompleted(jobId, { conversion: { totalConverted: convertedFiles.filter(f => f.success).length, totalFiles: total }, zipFilename: outZipName });

    // Standardized response structure for all ZIP conversions
    const result = {
      zipFilename: outZipName,
      zipFilePath: path.resolve(outZipPath),
      results: convertedFiles.map(f => ({
        fileName: f.original || f.converted || 'unknown',
        originalContent: f.originalContent || '',
        convertedContent: f.idmcContent || f.convertedContent || '',
        success: f.success !== false
      })),
      processing: {
        totalFiles: total,
        processedFiles: convertedFiles.filter(f => f.success).length,
        failedFiles: convertedFiles.filter(f => !f.success).length,
        successRate: total ? Math.round((convertedFiles.filter(f => f.success).length / total) * 100) : 0
      }
    };
    progressService.completeJob(jobId, result);
    return res.status(200).json({ success: true, target, jobId, ...result });
  } catch (error) {
    if (jobId) {
      progressService.failJob(jobId, error.message);
      progressEmitter.emitJobFailed(jobId, error.message);
    }
    return res.status(500).json({ error: 'Unified conversion failed', details: error.message, jobId });
  } finally {
    if (extractedPath && await fs.pathExists(extractedPath)) {
      await fs.remove(extractedPath);
    }
  }
};

// Test helper: run unified IDMC conversion using bundled sample-oracle-files.zip (no auth required)
const handleTestUnifiedIDMC = async (req, res) => {
  try {
    const sampleZip = path.join(__dirname, '..', 'sample-oracle-files.zip');
    req.body = {
      inputType: 'zip',
      target: 'idmc',
      sourceType: 'auto',
      zipFilePath: sampleZip,
      outputFormat: 'json'
    };
    return handleUnifiedConvert(req, res);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  handleTestConversion,
  handleTestUnifiedIDMC,
  handleConvert,
  getProgress,
  serveZipFile,
  handleDirectCodeConversion,
  handleUnifiedConvert
};
