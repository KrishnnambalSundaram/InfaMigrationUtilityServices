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

// Helper function to get file size
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const size = oracleFileAnalysisService.formatFileSize(stats.size);
    console.log(`📊 File size: ${size} for ${filePath}`);
    return size;
  } catch (error) {
    console.error(`❌ Error getting file size for ${filePath}:`, error);
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
  
  console.log(`Found ${totalFiles} Oracle files to convert using worker threads`);
  console.log(`📋 Files in order:`);
  sortedOracleFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${path.basename(file)}`);
  });
  
  if (totalFiles === 0) {
    console.log('⚠️ No Oracle files found to convert');
    return {
      convertedFiles: [],
      snowflakeFiles: [],
      totalConverted: 0,
      totalFiles: 0
    };
  }
  
  // Use workers for all file counts - they're more efficient
  console.log(`📝 Processing ${totalFiles} files using worker threads`);
  
  // Create converted directory
  const convertedPath = process.env.CONVERTED_PATH || './converted';
  await fs.ensureDir(convertedPath);
  
  // Process files in parallel using worker threads
  const maxWorkers = Math.min(8, totalFiles); // Use up to 8 workers
  const workers = [];
  const fileQueue = [...sortedOracleFiles];
  const results = [];
  
  console.log(`Starting ${maxWorkers} worker threads for parallel processing`);
  
  // Create workers
  for (let i = 0; i < maxWorkers; i++) {
    const worker = new Worker(path.join(__dirname, '..', 'workers', 'oracleConversionWorker.js'));
    worker.workerId = i + 1; // Add worker ID for tracking
    workers.push(worker);
    
    console.log(`🔧 Created Worker ${worker.workerId}`);
    
    worker.on('message', (result) => {
      if (result.success) {
        console.log(`✅ Worker ${worker.workerId} completed: ${result.result.converted} (${results.length + 1}/${totalFiles})`);
        results.push(result.result);
        
        // Update progress
        const progress = Math.round((results.length / totalFiles) * 90);
        progressService.updateProgress(jobId, 1, progress, `Converted ${results.length}/${totalFiles} files`);
        
        // Process next file if available
        if (fileQueue.length > 0) {
          const nextFile = fileQueue.shift();
          console.log(`🔄 Worker ${worker.workerId} processing next file: ${path.basename(nextFile)}`);
          worker.postMessage({
            filePath: nextFile,
            extractedPath: extractedPath,
            convertedPath: convertedPath
          });
        } else {
          console.log(`🏁 Worker ${worker.workerId} finished all assigned files`);
          worker.terminate();
        }
      } else {
        console.error(`❌ Worker ${worker.workerId} error: ${result.error}`);
        results.push({
          original: 'unknown',
          converted: null,
          success: false,
          error: result.error
        });
        
        // Process next file if available
        if (fileQueue.length > 0) {
          const nextFile = fileQueue.shift();
          console.log(`🔄 Worker ${worker.workerId} retrying with next file: ${path.basename(nextFile)}`);
          worker.postMessage({
            filePath: nextFile,
            extractedPath: extractedPath,
            convertedPath: convertedPath
          });
        } else {
          console.log(`🏁 Worker ${worker.workerId} finished all assigned files`);
          worker.terminate();
        }
      }
    });
    
    worker.on('error', (error) => {
      console.error(`❌ Worker ${worker.workerId} error:`, error);
    });
    
    worker.on('exit', (code) => {
      console.log(`🔚 Worker ${worker.workerId} exited with code ${code}`);
    });
  }
  
  // Start processing files
  console.log(`🚀 Starting ${Math.min(maxWorkers, fileQueue.length)} workers with initial files...`);
  console.log(`📊 Queue status: ${fileQueue.length} files remaining`);
  for (let i = 0; i < Math.min(maxWorkers, fileQueue.length); i++) {
    const file = fileQueue.shift();
    console.log(`🔄 Worker ${i + 1} starting with: ${path.basename(file)}`);
    workers[i].postMessage({
      filePath: file,
      extractedPath: extractedPath,
      convertedPath: convertedPath
    });
  }
  
  // Wait for all workers to complete with timeout
  console.log(`⏳ Waiting for ${totalFiles} files to be processed by ${maxWorkers} workers...`);
  const startTime = Date.now();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn('⚠️ Worker timeout after 10 minutes');
      workers.forEach(worker => worker.terminate());
      reject(new Error('Worker timeout'));
    }, 600000); // 10 minute timeout
    
    const checkCompletion = () => {
      if (results.length === totalFiles) {
        clearTimeout(timeout);
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        console.log(`🎉 All workers completed in ${duration.toFixed(2)} seconds`);
        console.log(`📊 Performance: ${(totalFiles / duration).toFixed(2)} files/second`);
        resolve();
      } else {
        setTimeout(checkCompletion, 100);
      }
    };
    checkCompletion();
  }).catch(async (error) => {
    console.error('❌ Worker processing failed:', error.message);
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
  
  console.log(`📋 Converted files in response order:`);
  convertedFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file.original} -> ${file.converted}`);
  });
  
  console.log(`📋 Snowflake files in zip order:`);
  snowflakeFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file.name}`);
  });
  
  console.log(`Worker conversion completed: ${convertedFiles.filter(f => f.success).length}/${totalFiles} files converted successfully`);
  
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
  
  console.log(`Found ${totalFiles} Oracle files to convert`);
  console.log(`📋 Files in order:`);
  sortedOracleFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${path.basename(file)}`);
  });
  
  if (totalFiles === 0) {
    console.log('⚠️ No Oracle files found to convert');
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
      console.log(`Processing file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      // Update progress for this step
      const stepProgress = Math.round(((i + 1) / totalFiles) * 90); // 90% of step 1
      progressService.updateProgress(jobId, 1, stepProgress, `Converting file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      // Check file size to estimate conversion time
      const fileStats = await fs.stat(currentFilePath);
      const fileSizeKB = Math.round(fileStats.size / 1024);
      console.log(`  File size: ${fileSizeKB} KB`);
      
      const oracleCode = await fs.readFile(currentFilePath, 'utf8');
      const relativePath = path.relative(extractedPath, currentFilePath);
      const fileType = await oracleConversionService.analyzeFileType(currentFilePath);
      const snowflakeFileName = oracleConversionService.getSnowflakeFileName(relativePath, fileType);
      
      console.log(`Converting: ${path.basename(currentFilePath)} -> ${snowflakeFileName} (type: ${fileType})`);
      
      // Convert Oracle to Snowflake
      console.log(`🔄 Calling LLM conversion for: ${snowflakeFileName}`);
      
      // Add timeout to prevent hanging - increased to 2 minutes for complex files
      const conversionPromise = oracleConversionService.convertOracleToSnowflake(oracleCode, path.basename(currentFilePath), fileType);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('LLM conversion timeout after 2 minutes')), 120000)
      );
      
      const snowflakeCode = await Promise.race([conversionPromise, timeoutPromise]);
      console.log(`✅ LLM conversion completed for: ${snowflakeFileName}`);
      
      // Create temporary converted folder structure and save files
      const convertedPath = process.env.CONVERTED_PATH || './converted';
      const snowflakeFilePath = path.join(convertedPath, snowflakeFileName);
      
      // Ensure the target folder exists
      await fs.ensureDir(path.dirname(snowflakeFilePath));
      
      // Write the converted file to the temporary converted folder
      await fs.writeFile(snowflakeFilePath, snowflakeCode, 'utf8');
      
      console.log(`💾 Created file: ${snowflakeFilePath}`);
      console.log(`📁 File type: ${fileType}`);
      console.log(`📁 Snowflake filename: ${snowflakeFileName}`);
      
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
      
      console.log(`✅ Converted: ${path.basename(currentFilePath)} -> ${snowflakeFileName}`);
      
    } catch (error) {
      console.error(`❌ Error converting file ${currentFilePath}:`, error);
      console.error(`  Error details: ${error.message}`);
      
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
      console.log(`⚠️ Continuing with next file...`);
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
  
  console.log(`📋 Converted files in response order:`);
  convertedFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file.original} -> ${file.converted}`);
  });
  
  console.log(`📋 Snowflake files in zip order:`);
  snowflakeFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${file.name}`);
  });
  
  console.log(`Conversion completed: ${convertedFiles.filter(f => f.success).length}/${totalFiles} files converted successfully`);
  
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
    console.log(`🚀 Starting test Oracle → Snowflake migration job: ${jobId}`);
    
    // Use the sample Oracle zip file we created
    const sampleOraclePath = path.join(__dirname, '..', 'sample-oracle-files.zip');
    
    // Check if sample file exists
    if (!await fs.pathExists(sampleOraclePath)) {
      console.error('❌ Sample Oracle zip file not found at:', sampleOraclePath);
      throw new Error('Sample Oracle zip file not found. Please ensure sample-oracle-files.zip exists in the project root.');
    }
    
    console.log('📦 Using sample Oracle zip file:', sampleOraclePath);
    
    // Extract the zip file
    console.log('📦 Extracting sample Oracle zip file...');
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    
    // Use system unzip command for better reliability
    try {
      await execAsync(`unzip -q "${sampleOraclePath}" -d "${extractedPath}"`);
      console.log('✅ Zip file extracted using system unzip');
    } catch (error) {
      console.warn('⚠️ System unzip failed, falling back to unzipper library:', error.message);
      
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
    
    console.log(`✅ Sample Oracle files ready at: ${extractedPath}`);
    
    // Step 1: Analyze the Oracle project
    console.log('🔍 Analyzing Oracle project...');
    progressService.updateProgress(jobId, 0, 50, 'Analyzing Oracle project...');
    const analysis = await oracleFileAnalysisService.analyzeOracleProjectFromDirectory(extractedPath);
    progressService.updateProgress(jobId, 0, 100, 'Analysis complete');
    console.log(`✅ Analysis complete: ${analysis.totalFiles} Oracle files found`);
    
    // Step 2: Convert Oracle to Snowflake
    console.log('🔄 Starting Oracle → Snowflake conversion...');
    progressService.updateProgress(jobId, 1, 10, 'Starting Oracle → Snowflake conversion...');
    
    // Debug: List all Oracle files found
    const oracleFiles = await oracleConversionService.findOracleFiles(extractedPath);
    const sortedOracleFiles = oracleFiles.sort((a, b) => {
      const nameA = path.basename(a);
      const nameB = path.basename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    console.log(`🔍 Found ${sortedOracleFiles.length} Oracle files:`);
    sortedOracleFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${path.relative(extractedPath, file)}`);
    });
    
    const conversionResult = await convertOracleFilesWithWorkers(extractedPath, analysis, jobId);
    progressService.updateProgress(jobId, 1, 100, 'Conversion complete');
    console.log(`✅ Conversion complete: ${conversionResult.totalConverted}/${conversionResult.totalFiles} files converted`);
    
    // Step 3: Create final ZIP with converted files
    console.log('📦 Creating final package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final package...');
    const zipsPath = process.env.ZIPS_PATH || './zips';
    await fs.ensureDir(zipsPath);
    
    // Generate unique zip filename with timestamp and job ID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `converted_oracle_snowflake_${timestamp}.zip`;
    const zipPath = path.join(zipsPath, zipFileName);
    
    // Create zip file with converted Snowflake files
    await createSnowflakeZipFile(conversionResult.snowflakeFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Verify the zip file was created
    if (await fs.pathExists(zipPath)) {
      console.log(`✅ Zip file created successfully: ${zipPath}`);
      const stats = await fs.stat(zipPath);
      console.log(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(stats.size)}`);
    } else {
      console.error(`❌ Zip file was not created: ${zipPath}`);
    }
    
    console.log(`🎉 Test Oracle → Snowflake migration completed successfully: ${zipFileName}`);
    
    // Get file size for logging
    const zipStats = await fs.stat(zipPath);
    console.log(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(zipStats.size)}`);
    console.log(`📦 Zip file ready for download via /api/download endpoint`);
    
    // Clean up converted folder after zip creation
    console.log('🧹 Cleaning up converted folder...');
    const convertedPath = process.env.CONVERTED_PATH || './converted';
    if (await fs.pathExists(convertedPath)) {
      await fs.remove(convertedPath);
      console.log('✅ Converted folder cleaned up');
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
    
    console.log(`📤 Sending test response for job: ${jobId}`);
    
    // Return the result
    res.status(200).json({
      success: true,
      message: 'Test Oracle → Snowflake migration completed successfully',
      source: 'sample-oracle-files.zip (15 comprehensive Oracle procedures)',
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    console.error('❌ Test Oracle → Snowflake migration failed:', error);
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
      console.log('🧹 Cleaned up extracted directory');
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
      console.log(`🔄 Processing direct code conversion request`);
      
      // Use the file name provided or default to input.sql
      const inputFileName = fileName || 'input.sql';
      
      // Convert the code directly
      const convertedCode = await oracleConversionService.convertOracleCodeToSnowflake(sourceCode, inputFileName);
      
      return res.status(200).json({
        success: true,
        fileName: inputFileName,
        conversionType: 'oracle-to-snowflake',
        result: convertedCode
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
    
    // Create job ID based on zip base name
    const zipBaseName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `convert_${zipBaseName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    console.log(`🚀 Starting Oracle → Snowflake conversion job: ${jobId}`);
    console.log(`📁 Processing zip file: ${zipFilePath}`);
    
    // Extract the zip file
    console.log('📦 Extracting zip file...');
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    
    // Use system unzip command for better reliability
    try {
      await execAsync(`unzip -q "${zipFilePath}" -d "${extractedPath}"`);
      console.log('✅ Zip file extracted using system unzip');
    } catch (error) {
      console.warn('⚠️ System unzip failed, falling back to unzipper library:', error.message);
      
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
    
    console.log(`✅ Zip file extracted to: ${extractedPath}`);
    
    // Step 1: Analyze the Oracle project
    console.log('🔍 Analyzing Oracle project...');
    progressService.updateProgress(jobId, 0, 50, 'Analyzing Oracle project...');
    const analysis = await oracleFileAnalysisService.analyzeOracleProjectFromDirectory(extractedPath);
    progressService.updateProgress(jobId, 0, 100, 'Analysis complete');
    console.log(`✅ Analysis complete: ${analysis.totalFiles} Oracle files found`);
    
    // Step 2: Convert Oracle to Snowflake
    console.log('🔄 Starting Oracle → Snowflake conversion...');
    progressService.updateProgress(jobId, 1, 10, 'Starting Oracle → Snowflake conversion...');
    
    // Debug: List all Oracle files found
    const oracleFiles = await oracleConversionService.findOracleFiles(extractedPath);
    const sortedOracleFiles = oracleFiles.sort((a, b) => {
      const nameA = path.basename(a);
      const nameB = path.basename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    console.log(`🔍 Found ${sortedOracleFiles.length} Oracle files:`);
    sortedOracleFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${path.relative(extractedPath, file)}`);
    });
    
    const conversionResult = await convertOracleFilesWithWorkers(extractedPath, analysis, jobId);
    progressService.updateProgress(jobId, 1, 100, 'Conversion complete');
    console.log(`✅ Conversion complete: ${conversionResult.totalConverted}/${conversionResult.totalFiles} files converted`);
    
    // Step 3: Create final ZIP with converted files
    console.log('📦 Creating final package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final package...');
    const zipsPath = process.env.ZIPS_PATH || './zips';
    await fs.ensureDir(zipsPath);
    
    // Generate unique zip filename with timestamp and job ID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `converted_oracle_snowflake_${timestamp}.zip`;
    const zipPath = path.join(zipsPath, zipFileName);
    
    // Create zip file with converted Snowflake files
    await createSnowflakeZipFile(conversionResult.snowflakeFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Verify the zip file was created
    if (await fs.pathExists(zipPath)) {
      console.log(`✅ Zip file created successfully: ${zipPath}`);
      const stats = await fs.stat(zipPath);
      console.log(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(stats.size)}`);
    } else {
      console.error(`❌ Zip file was not created: ${zipPath}`);
      throw new Error('Failed to create zip file');
    }
    
    console.log(`🎉 Oracle → Snowflake conversion completed successfully: ${zipFileName}`);
    
    // Get file size for logging
    const zipStats = await fs.stat(zipPath);
    console.log(`📊 Zip file size: ${oracleFileAnalysisService.formatFileSize(zipStats.size)}`);
    console.log(`📦 Zip file ready for download via /api/download endpoint`);
    
    // Clean up converted folder after zip creation
    console.log('🧹 Cleaning up converted folder...');
    const convertedPath = process.env.CONVERTED_PATH || './converted';
    if (await fs.pathExists(convertedPath)) {
      await fs.remove(convertedPath);
      console.log('✅ Converted folder cleaned up');
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
    
    console.log(`📤 Sending response for job: ${jobId}`);
    
    // Return the result
    res.status(200).json({
      success: true,
      message: 'Oracle → Snowflake conversion completed successfully',
      source: zipFilePath,
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    console.error('❌ Oracle → Snowflake conversion failed:', error);
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
      console.log('🧹 Cleaned up extracted directory');
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
    console.error('Error getting progress:', error);
    res.status(500).json({ 
      error: 'Error getting progress', 
      details: error.message 
    });
  }
};

// Function to serve the generated zip file
const serveZipFile = async (req, res) => {
  try {
    const { filename } = req.body;
    
    // Validate filename to prevent directory traversal attacks
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ 
        error: 'Invalid filename',
        message: 'Filename is required and cannot contain invalid characters',
        example: { filename: 'converted_oracle_snowflake_2024-01-15T10-30-45-123Z.zip' }
      });
    }
    
    const zipsPath = process.env.ZIPS_PATH || './zips';
    const zipPath = path.join(zipsPath, filename);
    
    // Check if file exists
    if (!await fs.pathExists(zipPath)) {
      return res.status(404).json({ 
        error: 'Zip file not found',
        filename: filename,
        message: 'The requested file does not exist or has been removed'
      });
    }
    
    // Get file stats for additional validation
    const stats = await fs.stat(zipPath);
    if (!stats.isFile()) {
      return res.status(400).json({ 
        error: 'Invalid file type',
        message: 'Requested path is not a file'
      });
    }
    
    console.log(`📥 Serving converted zip file: ${filename} (${oracleFileAnalysisService.formatFileSize(stats.size)})`);
    
    // Set appropriate headers for file download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);
    
    // Stream the file to the client
    const fileStream = fs.createReadStream(zipPath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming zip file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });
    
  } catch (error) {
    console.error('Error serving zip file:', error);
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
    console.log(`🔄 Processing direct code conversion request for type: ${conversionType}`);
    
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
    
    // Return the converted code or mapping summary
    return res.status(200).json({
      success: true,
      fileName,
      conversionType,
      result: conversionType.includes('idmc') ? mappingSummary : convertedCode
    });
  } catch (error) {
    console.error('❌ Error in direct code conversion:', error);
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
      convertedFiles.push({ original: r.original, converted: r.converted, idmcContent: r.idmcContent, detectedType: r.detectedType, success: true });
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
    const { inputType, target, sourceType = 'auto', zipFilePath, sourceCode, fileName, outputFormat = 'json' } = req.body;

    // Single-file conversions
    if (inputType === 'single') {
      if (!sourceCode) {
        return res.status(400).json({ error: 'sourceCode is required for single inputType' });
      }

      if (target === 'snowflake') {
        const convertedCode = await oracleConversionService.convertOracleCodeToSnowflake(sourceCode, fileName || 'input.sql');
        return res.status(200).json({ success: true, conversionType: 'oracle-to-snowflake', fileName: fileName || 'input.sql', result: convertedCode });
      }

      // IDMC single: auto-detect when sourceType not provided or set to auto
      const idmcService = require('../services/idmcConversionService');
      let idmcSummary;
      const name = fileName || 'input.sql';
      let resolvedType = sourceType;
      if (!resolvedType || resolvedType === 'auto') {
        resolvedType = detectSourceTypeFromNameAndContent(name, sourceCode, 'sql');
        if (resolvedType === 'sql') {
          // fallback to existing analyzer if inconclusive
          resolvedType = idmcService.analyzeSqlContent(sourceCode) || 'sql';
        }
      }
      if (resolvedType === 'redshift') {
        idmcSummary = await idmcService.convertRedshiftToIDMC(sourceCode, name, 'sql');
      } else {
        idmcSummary = await idmcService.convertOracleToIDMC(sourceCode, name, 'sql');
      }
      return res.status(200).json({ success: true, conversionType: `${resolvedType}-to-idmc`, fileName: name, result: idmcSummary });
    }

    // ZIP conversions
    if (!zipFilePath) {
      return res.status(400).json({ error: 'zipFilePath is required for zip inputType', example: { zipFilePath: '/path/to/your/files.zip' } });
    }
    if (!await fs.pathExists(zipFilePath)) {
      return res.status(404).json({ error: 'Zip file not found', providedPath: zipFilePath });
    }

    const baseName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `unified_${target}_${baseName}`;
    const job = progressService.createJob(jobId);
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
      await execAsync(`unzip -q "${zipFilePath}" -d "${extractedPath}"`);
    } catch (err) {
      await new Promise((resolve, reject) => {
        const extract = unzipper.Extract({ path: extractedPath });
        extract.on('error', reject);
        extract.on('close', () => setTimeout(resolve, 100));
        fs.createReadStream(zipFilePath).pipe(extract);
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

      const zipsPath = process.env.ZIPS_PATH || './zips';
      await fs.ensureDir(zipsPath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outZipName = `converted_oracle_snowflake_${timestamp}.zip`;
      const outZipPath = path.join(zipsPath, outZipName);
      await createSnowflakeZipFile(conversionResult.snowflakeFiles, outZipPath);
      progressService.updateProgress(jobId, 2, 100, 'Completed');
      progressEmitter.emitJobCompleted(jobId, { conversion: conversionResult, zipFilename: outZipName });

      progressService.completeJob(jobId, { conversion: conversionResult, zipFilename: outZipName });
      return res.status(200).json({ success: true, target, jobId, zipFilename: outZipName, conversion: conversionResult });
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
    const wantJson = outputFormat === 'json' || outputFormat === 'all';
    const wantDocx = outputFormat === 'docx' || outputFormat === 'all';
    const wantPdf = outputFormat === 'pdf' || outputFormat === 'all';

    if (wantJson) {
      filesForZip.push(...idmcFiles.map(f => ({ name: f.name, content: f.content })));
    }

    if (wantDocx || wantPdf) {
      const documentService = require('../services/documentService');
      for (const f of idmcFiles) {
        if (wantDocx) {
          const docxBuf = await documentService.markdownToDocxBuffer(f.content, f.name);
          const docxName = f.name.replace(/_IDMC_Summary\.json$/i, '_IDMC_Summary.docx');
          filesForZip.push({ name: docxName, content: docxBuf });
        }
        // PDF generation not implemented to avoid heavy deps; reserved for future
      }
    }

    const zipsPath = process.env.ZIPS_PATH || './zips';
    await fs.ensureDir(zipsPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = outputFormat === 'json' ? 'json' : (outputFormat === 'docx' ? 'docx' : (outputFormat === 'pdf' ? 'pdf' : 'all'));
    const outZipName = `idmc_summaries_${suffix}_${timestamp}.zip`;
    const outZipPath = path.join(zipsPath, outZipName);
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

    const result = {
      conversion: {
        totalConverted: convertedFiles.filter(f => f.success).length,
        totalFiles: total,
        successRate: total ? Math.round((convertedFiles.filter(f => f.success).length / total) * 100) : 0,
        convertedFiles,
        errors: convertedFiles.filter(f => !f.success)
      },
      zipFilename: outZipName
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

module.exports = {
  handleTestConversion,
  handleConvert,
  getProgress,
  serveZipFile,
  handleDirectCodeConversion,
  handleUnifiedConvert
};
