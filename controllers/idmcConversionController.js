const idmcConversionService = require('../services/idmcConversionService');
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

// Helper function to get file size
async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const size = (stats.size / 1024).toFixed(2) + ' KB';
    console.log(`📊 File size: ${size} for ${filePath}`);
    return size;
  } catch (error) {
    console.error(`❌ Error getting file size for ${filePath}:`, error);
    return 'Unknown';
  }
}

// Convert Oracle files to IDMC summaries
async function convertOracleFilesToIDMC(extractedPath, jobId) {
  const convertedFiles = [];
  const idmcFiles = [];
  
  // Find all Oracle files
  const oracleFiles = await findOracleFiles(extractedPath);
  const sortedOracleFiles = oracleFiles.sort((a, b) => {
    const nameA = path.basename(a);
    const nameB = path.basename(b);
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  const totalFiles = sortedOracleFiles.length;
  
  console.log(`Found ${totalFiles} Oracle files to convert to IDMC summaries`);
  
  if (totalFiles === 0) {
    console.log('⚠️ No Oracle files found to convert');
    return {
      convertedFiles: [],
      idmcFiles: [],
      totalConverted: 0,
      totalFiles: 0
    };
  }
  
  // Process files one by one with progress updates
  for (let i = 0; i < totalFiles; i++) {
    const currentFilePath = sortedOracleFiles[i];
    try {
      console.log(`Processing file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      // Update progress
      const stepProgress = Math.round(((i + 1) / totalFiles) * 90);
      progressService.updateProgress(jobId, 1, stepProgress, `Converting file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      const oracleCode = await fs.readFile(currentFilePath, 'utf8');
      const relativePath = path.relative(extractedPath, currentFilePath);
      const fileType = await idmcConversionService.analyzeFileType(currentFilePath);
      const idmcFileName = idmcConversionService.getIDMCFileName(relativePath, fileType);
      
      console.log(`Converting: ${path.basename(currentFilePath)} -> ${idmcFileName} (type: ${fileType})`);
      
      // Convert Oracle to IDMC
      const idmcSummary = await idmcConversionService.convertOracleToIDMC(oracleCode, path.basename(currentFilePath), fileType);
      
      // Create IDMC output directory
      const idmcPath = process.env.IDMC_PATH || './idmc_output';
      const idmcFilePath = path.join(idmcPath, idmcFileName);
      await fs.ensureDir(path.dirname(idmcFilePath));
      await fs.writeFile(idmcFilePath, idmcSummary, 'utf8');
      
      console.log(`💾 Created IDMC file: ${idmcFilePath}`);
      
      convertedFiles.push({
        original: relativePath,
        converted: idmcFileName,
        idmcContent: idmcSummary,
        oracleContent: oracleCode,
        fileType: fileType,
        success: true
      });
      
      idmcFiles.push({
        name: idmcFileName,
        content: idmcSummary,
        fileType: fileType
      });
      
      console.log(`✅ Converted: ${path.basename(currentFilePath)} -> ${idmcFileName}`);
      
    } catch (error) {
      console.error(`❌ Error converting file ${currentFilePath}:`, error);
      
      convertedFiles.push({
        original: path.relative(extractedPath, currentFilePath),
        converted: null,
        idmcContent: null,
        oracleContent: null,
        fileType: null,
        success: false,
        error: error.message
      });
      
      console.log(`⚠️ Continuing with next file...`);
    }
  }
  
  console.log(`Oracle to IDMC conversion completed: ${convertedFiles.filter(f => f.success).length}/${totalFiles} files converted successfully`);
  
  return {
    convertedFiles,
    idmcFiles,
    totalConverted: convertedFiles.filter(f => f.success).length,
    totalFiles: totalFiles,
    errors: convertedFiles.filter(f => !f.success)
  };
}

// Convert Redshift files to IDMC summaries
async function convertRedshiftFilesToIDMC(extractedPath, jobId) {
  const convertedFiles = [];
  const idmcFiles = [];
  
  // Find all Redshift files
  const redshiftFiles = await findRedshiftFiles(extractedPath);
  const sortedRedshiftFiles = redshiftFiles.sort((a, b) => {
    const nameA = path.basename(a);
    const nameB = path.basename(b);
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });
  const totalFiles = sortedRedshiftFiles.length;
  
  console.log(`Found ${totalFiles} Redshift files to convert to IDMC summaries`);
  
  if (totalFiles === 0) {
    console.log('⚠️ No Redshift files found to convert');
    return {
      convertedFiles: [],
      idmcFiles: [],
      totalConverted: 0,
      totalFiles: 0
    };
  }
  
  // Process files one by one with progress updates
  for (let i = 0; i < totalFiles; i++) {
    const currentFilePath = sortedRedshiftFiles[i];
    try {
      console.log(`Processing file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      // Update progress
      const stepProgress = Math.round(((i + 1) / totalFiles) * 90);
      progressService.updateProgress(jobId, 1, stepProgress, `Converting file ${i + 1}/${totalFiles}: ${path.basename(currentFilePath)}`);
      
      const redshiftCode = await fs.readFile(currentFilePath, 'utf8');
      const relativePath = path.relative(extractedPath, currentFilePath);
      const fileType = await idmcConversionService.analyzeFileType(currentFilePath);
      const idmcFileName = idmcConversionService.getIDMCFileName(relativePath, fileType);
      
      console.log(`Converting: ${path.basename(currentFilePath)} -> ${idmcFileName} (type: ${fileType})`);
      
      // Convert Redshift to IDMC
      const idmcSummary = await idmcConversionService.convertRedshiftToIDMC(redshiftCode, path.basename(currentFilePath), fileType);
      
      // Create IDMC output directory
      const idmcPath = process.env.IDMC_PATH || './idmc_output';
      const idmcFilePath = path.join(idmcPath, idmcFileName);
      await fs.ensureDir(path.dirname(idmcFilePath));
      await fs.writeFile(idmcFilePath, idmcSummary, 'utf8');
      
      console.log(`💾 Created IDMC file: ${idmcFilePath}`);
      
      convertedFiles.push({
        original: relativePath,
        converted: idmcFileName,
        idmcContent: idmcSummary,
        redshiftContent: redshiftCode,
        fileType: fileType,
        success: true
      });
      
      idmcFiles.push({
        name: idmcFileName,
        content: idmcSummary,
        fileType: fileType
      });
      
      console.log(`✅ Converted: ${path.basename(currentFilePath)} -> ${idmcFileName}`);
      
    } catch (error) {
      console.error(`❌ Error converting file ${currentFilePath}:`, error);
      
      convertedFiles.push({
        original: path.relative(extractedPath, currentFilePath),
        converted: null,
        idmcContent: null,
        redshiftContent: null,
        fileType: null,
        success: false,
        error: error.message
      });
      
      console.log(`⚠️ Continuing with next file...`);
    }
  }
  
  console.log(`Redshift to IDMC conversion completed: ${convertedFiles.filter(f => f.success).length}/${totalFiles} files converted successfully`);
  
  return {
    convertedFiles,
    idmcFiles,
    totalConverted: convertedFiles.filter(f => f.success).length,
    totalFiles: totalFiles,
    errors: convertedFiles.filter(f => !f.success)
  };
}

// Helper function to find Oracle files
async function findOracleFiles(directory) {
  const files = [];
  
  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.sql' || ext === '.pls' || ext === '.pkg' || ext === '.prc' || ext === '.fnc') {
          files.push(fullPath);
        }
      }
    }
  }
  
  await scanDir(directory);
  return files;
}

// Helper function to find Redshift files
async function findRedshiftFiles(directory) {
  const files = [];
  
  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.sql' || ext === '.rs' || ext === '.redshift') {
          files.push(fullPath);
        }
      }
    }
  }
  
  await scanDir(directory);
  return files;
}

// Convert single Oracle script to IDMC
const handleConvertOracleToIDMC = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath, sourceCode, fileName } = req.body;
    
    // Handle direct code input if provided
    if (sourceCode) {
      console.log(`🔄 Processing direct Oracle code to IDMC conversion`);
      
      // Use the file name provided or default to input.sql
      const inputFileName = fileName || 'input.sql';
      
      // Convert the code directly
      const idmcSummary = await idmcConversionService.convertOracleCodeToIdmc(sourceCode, inputFileName);
      
      // Persist artifacts based on requested outputFormat (supports 'sql' to save original)
      const outputsRoot = process.env.OUTPUT_PATH || './output';
      await fs.ensureDir(outputsRoot);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = inputFileName.replace(/\.[^.]+$/g, '');
      const { outputFormat = 'json' } = req.body || {};
      const outputFiles = [];
      if (outputFormat === 'sql' || outputFormat === 'all') {
        const sqlName = `${base}_original_${timestamp}.sql`;
        const sqlPath = require('path').join(outputsRoot, sqlName);
        await fs.writeFile(sqlPath, sourceCode, 'utf8');
        outputFiles.push({ name: sqlName, path: require('path').resolve(sqlPath), mime: 'text/sql', kind: 'single' });
      }

      return res.status(200).json({
        success: true,
        message: 'Oracle code converted to IDMC successfully',
        fileName: inputFileName,
        originalContent: sourceCode,
        idmcSummary: idmcSummary,
        convertedContent: idmcSummary,
        outputFiles
      });
    }
    
    if (!zipFilePath) {
      return res.status(400).json({ 
        error: 'Either sourceCode with fileName or zipFilePath is required',
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
    
    // Create job ID
    const baseZipName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `oracle_idmc_${baseZipName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    console.log(`🚀 Starting Oracle → IDMC conversion job: ${jobId}`);
    
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
    
    // Convert Oracle to IDMC
    console.log('🔄 Starting Oracle → IDMC conversion...');
    progressService.updateProgress(jobId, 1, 10, 'Starting Oracle → IDMC conversion...');
    
    const conversionResult = await convertOracleFilesToIDMC(extractedPath, jobId);
    progressService.updateProgress(jobId, 1, 100, 'Conversion complete');
    console.log(`✅ Conversion complete: ${conversionResult.totalConverted}/${conversionResult.totalFiles} files converted`);
    
    // Create final ZIP with IDMC files
    console.log('📦 Creating final IDMC package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final IDMC package...');
    const zipsPath = process.env.ZIPS_PATH || './zips';
    await fs.ensureDir(zipsPath);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `oracle_idmc_summaries_${timestamp}.zip`;
    const zipPath = path.join(zipsPath, zipFileName);
    
    // Create zip file with IDMC summaries
    await createIDMCZipFile(conversionResult.idmcFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Complete the job
    const result = {
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
    
    res.status(200).json({
      success: true,
      message: 'Oracle → IDMC conversion completed successfully',
      source: zipFilePath,
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    console.error('❌ Oracle → IDMC conversion failed:', error);
    progressService.failJob(jobId, error.message);
    
    res.status(500).json({ 
      error: 'Oracle → IDMC conversion failed', 
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

// Convert single Redshift script to IDMC
const handleConvertRedshiftToIDMC = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath, sourceCode, fileName } = req.body;
    
    // Handle direct code input if provided
    if (sourceCode) {
      console.log(`🔄 Processing direct Redshift code to IDMC conversion`);
      
      // Use the file name provided or default to input.sql
      const inputFileName = fileName || 'input.sql';
      
      // Convert the code directly
      const idmcSummary = await idmcConversionService.convertRedshiftCodeToIdmc(sourceCode, inputFileName);
      
      const outputsRoot = process.env.OUTPUT_PATH || './output';
      await fs.ensureDir(outputsRoot);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = inputFileName.replace(/\.[^.]+$/g, '');
      const { outputFormat = 'json' } = req.body || {};
      const outputFiles = [];
      if (outputFormat === 'sql' || outputFormat === 'all') {
        const sqlName = `${base}_original_${timestamp}.sql`;
        const sqlPath = require('path').join(outputsRoot, sqlName);
        await fs.writeFile(sqlPath, sourceCode, 'utf8');
        outputFiles.push({ name: sqlName, path: require('path').resolve(sqlPath), mime: 'text/sql', kind: 'single' });
      }

      return res.status(200).json({
        success: true,
        message: 'Redshift code converted to IDMC successfully',
        fileName: inputFileName,
        originalContent: sourceCode,
        idmcSummary: idmcSummary,
        convertedContent: idmcSummary,
        outputFiles
      });
    }
    
    if (!zipFilePath) {
      return res.status(400).json({ 
        error: 'Either sourceCode with fileName or zipFilePath is required',
        example: { zipFilePath: '/path/to/your/redshift-files.zip' }
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
    const baseZipName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `redshift_idmc_${baseZipName}`;
    
    // Create progress tracking job
    const job = progressService.createJob(jobId);
    console.log(`🚀 Starting Redshift → IDMC conversion job: ${jobId}`);
    
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
    
    // Convert Redshift to IDMC
    console.log('🔄 Starting Redshift → IDMC conversion...');
    progressService.updateProgress(jobId, 1, 10, 'Starting Redshift → IDMC conversion...');
    
    const conversionResult = await convertRedshiftFilesToIDMC(extractedPath, jobId);
    progressService.updateProgress(jobId, 1, 100, 'Conversion complete');
    console.log(`✅ Conversion complete: ${conversionResult.totalConverted}/${conversionResult.totalFiles} files converted`);
    
    // Create final ZIP with IDMC files
    console.log('📦 Creating final IDMC package...');
    progressService.updateProgress(jobId, 2, 10, 'Creating final IDMC package...');
    const zipsPath = process.env.ZIPS_PATH || './zips';
    await fs.ensureDir(zipsPath);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `redshift_idmc_summaries_${timestamp}.zip`;
    const zipPath = path.join(zipsPath, zipFileName);
    
    // Create zip file with IDMC summaries
    await createIDMCZipFile(conversionResult.idmcFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');
    
    // Complete the job
    const result = {
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
    
    res.status(200).json({
      success: true,
      message: 'Redshift → IDMC conversion completed successfully',
      source: zipFilePath,
      jobId: jobId,
      ...result
    });
    
  } catch (error) {
    console.error('❌ Redshift → IDMC conversion failed:', error);
    progressService.failJob(jobId, error.message);
    
    res.status(500).json({ 
      error: 'Redshift → IDMC conversion failed', 
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

// Convert single script to IDMC (for UI)
const handleConvertSingleScriptToIDMC = async (req, res) => {
  try {
    const { script, fileName, scriptType } = req.body;
    
    if (!script || !fileName) {
      return res.status(400).json({ 
        error: 'script and fileName are required',
        example: { 
          script: 'SELECT * FROM users WHERE id = 1;',
          fileName: 'query.sql',
          scriptType: 'oracle' // or 'redshift'
        }
      });
    }
    
    const jobId = `single_script_${Date.now()}`;
    const job = progressService.createJob(jobId);
    
    console.log(`🚀 Starting single script → IDMC conversion: ${fileName}`);
    progressService.updateProgress(jobId, 0, 50, 'Converting script to IDMC...');
    
    let idmcSummary;
    let detected = scriptType;
    if (!detected || detected === 'auto') {
      detected = idmcConversionService.analyzeSqlContent(script);
    }
    const fileType = detected || 'sql';
    if (detected === 'redshift') {
      idmcSummary = await idmcConversionService.convertRedshiftToIDMC(script, fileName, fileType);
    } else {
      idmcSummary = await idmcConversionService.convertOracleToIDMC(script, fileName, fileType);
    }
    
    progressService.updateProgress(jobId, 0, 100, 'Conversion complete');
    
    const result = {
      success: true,
      message: 'Script converted to IDMC summary successfully',
      fileName: fileName,
      scriptType: detected || 'sql',
      originalContent: script,
      idmcSummary: idmcSummary, // Return markdown directly
      convertedContent: idmcSummary,
      jobId: jobId
    };
    
    progressService.completeJob(jobId, result);
    
    res.status(200).json(result);
    
  } catch (error) {
    console.error('❌ Single script → IDMC conversion failed:', error);
    res.status(500).json({ 
      error: 'Single script → IDMC conversion failed', 
      details: error.message
    });
  }
};

// Function to create zip file with IDMC summaries
async function createIDMCZipFile(idmcFiles, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => {
      console.log(`📦 IDMC Zip file created: ${archive.pointer()} bytes`);
      resolve();
    });
    
    archive.on('error', (err) => {
      console.error('❌ Error creating IDMC zip file:', err);
      reject(err);
    });
    
    archive.pipe(output);
    
    // Add IDMC summary files
    for (const file of idmcFiles) {
      if (file.content) {
        archive.append(file.content, { name: file.name });
        console.log(`📄 Added to IDMC zip: ${file.name}`);
      }
    }
    
    archive.finalize();
  });
}

// Helper: find SQL-like files for auto-detect flow
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

// Auto-detect ZIP conversion to IDMC
const handleConvertAutoToIDMC = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  try {
    const { zipFilePath, sourceCode, fileName } = req.body;

    // If direct code provided, reuse single-script handler path
    if (sourceCode) {
      const detected = idmcConversionService.analyzeSqlContent(sourceCode);
      const idmcSummary = detected === 'redshift'
        ? await idmcConversionService.convertRedshiftToIDMC(sourceCode, fileName || 'input.sql', 'sql')
        : await idmcConversionService.convertOracleToIDMC(sourceCode, fileName || 'input.sql', 'sql');
      return res.status(200).json({ success: true, scriptType: detected, fileName: fileName || 'input.sql', idmcSummary });
    }

    if (!zipFilePath) {
      return res.status(400).json({ error: 'Either sourceCode with fileName or zipFilePath is required', example: { zipFilePath: '/path/to/your/sql-files.zip' } });
    }

    if (!await fs.pathExists(zipFilePath)) {
      return res.status(404).json({ error: 'Zip file not found', providedPath: zipFilePath });
    }

    const base = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `auto_idmc_${base}`;
    progressService.createJob(jobId);
    progressService.updateProgress(jobId, 0, 10, 'Extracting zip file...');

    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    extractedPath = path.join(uploadPath, 'temp', Date.now().toString());
    await fs.ensureDir(extractedPath);
    try {
      await execAsync(`unzip -q "${zipFilePath}" -d "${extractedPath}"`);
    } catch {
      await new Promise((resolve, reject) => {
        const extract = unzipper.Extract({ path: extractedPath });
        extract.on('error', reject);
        extract.on('close', () => setTimeout(resolve, 100));
        fs.createReadStream(zipFilePath).pipe(extract);
      });
    }

    progressService.updateProgress(jobId, 1, 10, 'Scanning files...');
    const allFiles = await findSqlLikeFiles(extractedPath);
    const sortedFiles = allFiles.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
    const total = sortedFiles.length;
    const idmcFiles = [];
    const convertedFiles = [];

    for (let i = 0; i < total; i++) {
      const f = sortedFiles[i];
      try {
        progressService.updateProgress(jobId, 1, Math.round(((i + 1) / total) * 90), `Converting ${path.basename(f)}`);
        const code = await fs.readFile(f, 'utf8');
        const detected = idmcConversionService.analyzeSqlContent(code);
        const idmcSummary = detected === 'redshift'
          ? await idmcConversionService.convertRedshiftToIDMC(code, path.basename(f), 'sql')
          : await idmcConversionService.convertOracleToIDMC(code, path.basename(f), 'sql');
        const outName = idmcConversionService.getIDMCFileName(path.relative(extractedPath, f), 'sql');
        const idmcPath = process.env.IDMC_PATH || './idmc_output';
        const outPath = path.join(idmcPath, outName);
        await fs.ensureDir(path.dirname(outPath));
        await fs.writeFile(outPath, idmcSummary, 'utf8');

        idmcFiles.push({ name: outName, content: idmcSummary, fileType: detected });
        convertedFiles.push({ original: path.relative(extractedPath, f), converted: outName, idmcContent: idmcSummary, detectedType: detected, success: true });
      } catch (error) {
        convertedFiles.push({ original: path.relative(extractedPath, f), converted: null, idmcContent: null, detectedType: null, success: false, error: error.message });
      }
    }

    progressService.updateProgress(jobId, 2, 10, 'Creating final IDMC package...');
    const zipsPath = process.env.ZIPS_PATH || './zips';
    await fs.ensureDir(zipsPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `auto_idmc_summaries_${timestamp}.zip`;
    const zipPath = path.join(zipsPath, zipFileName);
    await createIDMCZipFile(idmcFiles, zipPath);
    progressService.updateProgress(jobId, 2, 100, 'Final package created');

    const result = {
      conversion: {
        totalConverted: convertedFiles.filter(f => f.success).length,
        totalFiles: total,
        successRate: total ? Math.round((convertedFiles.filter(f => f.success).length / total) * 100) : 0,
        convertedFiles,
        errors: convertedFiles.filter(f => !f.success)
      },
      zipFilename: zipFileName
    };

    progressService.completeJob(jobId, result);
    return res.status(200).json({ success: true, message: 'Auto-detect IDMC conversion completed', jobId, ...result });
  } catch (error) {
    progressService.failJob(jobId, error.message);
    return res.status(500).json({ error: 'Auto-detect IDMC conversion failed', details: error.message, jobId });
  } finally {
    if (extractedPath && await fs.pathExists(extractedPath)) {
      await fs.remove(extractedPath);
    }
  }
};

module.exports = { 
  handleConvertOracleToIDMC,
  handleConvertRedshiftToIDMC,
  handleConvertSingleScriptToIDMC,
  handleConvertAutoToIDMC
};
