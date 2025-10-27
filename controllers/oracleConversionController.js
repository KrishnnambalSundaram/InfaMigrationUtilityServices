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

// Oracle to Snowflake conversion function with progress tracking
async function convertOracleFilesWithProgress(extractedPath, analysis, jobId) {
  const convertedFiles = [];
  const snowflakeFiles = [];
  
  // Find all Oracle files
  const oracleFiles = await oracleConversionService.findOracleFiles(extractedPath);
  const totalFiles = oracleFiles.length;
  
  console.log(`Found ${totalFiles} Oracle files to convert`);
  
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
    const currentFilePath = oracleFiles[i];
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
    
    // For now, we'll create a sample Oracle file structure for testing
    // In a real scenario, you would have a sample Oracle zip file
    const sampleOraclePath = path.join(__dirname, '..', 'dotnet_zip', 'sample-oracle-files.zip');
    
    // Check if sample file exists, if not create a temporary sample
    if (!await fs.pathExists(sampleOraclePath)) {
      console.log('📝 Creating sample Oracle files for testing...');
      const tempSamplePath = path.join(__dirname, '..', 'uploads', 'temp', 'sample-oracle');
      await fs.ensureDir(tempSamplePath);
      
      // Create sample Oracle files
      const sampleFiles = [
        {
          name: 'customer_proc.sql',
          content: `CREATE OR REPLACE PROCEDURE get_customer_info(
    p_customer_id IN NUMBER,
    p_customer_name OUT VARCHAR2,
    p_customer_email OUT VARCHAR2
) AS
BEGIN
    SELECT customer_name, email
    INTO p_customer_name, p_customer_email
    FROM customers
    WHERE customer_id = p_customer_id;
    
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_customer_name := NULL;
            p_customer_email := NULL;
END get_customer_info;`
        },
        {
          name: 'invoice_function.sql',
          content: `CREATE OR REPLACE FUNCTION calculate_total_amount(
    p_invoice_id IN NUMBER
) RETURN NUMBER AS
    v_total_amount NUMBER := 0;
BEGIN
    SELECT SUM(amount)
    INTO v_total_amount
    FROM invoice_items
    WHERE invoice_id = p_invoice_id;
    
    RETURN NVL(v_total_amount, 0);
END calculate_total_amount;`
        },
        {
          name: 'customer_package.sql',
          content: `CREATE OR REPLACE PACKAGE customer_pkg AS
    PROCEDURE create_customer(
        p_name IN VARCHAR2,
        p_email IN VARCHAR2,
        p_customer_id OUT NUMBER
    );
    
    FUNCTION get_customer_count RETURN NUMBER;
END customer_pkg;

CREATE OR REPLACE PACKAGE BODY customer_pkg AS
    PROCEDURE create_customer(
        p_name IN VARCHAR2,
        p_email IN VARCHAR2,
        p_customer_id OUT NUMBER
    ) AS
    BEGIN
        SELECT customer_seq.NEXTVAL INTO p_customer_id FROM DUAL;
        
        INSERT INTO customers (customer_id, customer_name, email)
        VALUES (p_customer_id, p_name, p_email);
    END create_customer;
    
    FUNCTION get_customer_count RETURN NUMBER AS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_count FROM customers;
        RETURN v_count;
    END get_customer_count;
END customer_pkg;`
        }
      ];
      
      for (const file of sampleFiles) {
        await fs.writeFile(path.join(tempSamplePath, file.name), file.content, 'utf8');
      }
      
      extractedPath = tempSamplePath;
    } else {
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
    console.log(`🔍 Found ${oracleFiles.length} Oracle files:`);
    oracleFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${path.relative(extractedPath, file)}`);
    });
    
    const conversionResult = await convertOracleFilesWithProgress(extractedPath, analysis, jobId);
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
      source: 'Sample Oracle files',
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

// Convert API that takes a zip file path
const handleConvert = async (req, res) => {
  let extractedPath = null;
  let jobId = null;
  
  try {
    const { zipFilePath } = req.body;
    
    if (!zipFilePath) {
      return res.status(400).json({ 
        error: 'zipFilePath is required',
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
    
    // Create job ID based on filename
    const fileName = path.basename(zipFilePath, path.extname(zipFilePath));
    jobId = `convert_${fileName}`;
    
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
    console.log(`🔍 Found ${oracleFiles.length} Oracle files:`);
    oracleFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${path.relative(extractedPath, file)}`);
    });
    
    const conversionResult = await convertOracleFilesWithProgress(extractedPath, analysis, jobId);
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
    
    // Add conversion summary
    const summary = {
      conversionDate: new Date().toISOString(),
      totalFiles: snowflakeFiles.length,
      files: snowflakeFiles.map(f => ({
        name: f.name,
        type: f.fileType
      }))
    };
    
    archive.append(JSON.stringify(summary, null, 2), { name: 'conversion_summary.json' });
    
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

module.exports = { 
  handleTestConversion,
  handleConvert,
  getProgress,
  serveZipFile
};
