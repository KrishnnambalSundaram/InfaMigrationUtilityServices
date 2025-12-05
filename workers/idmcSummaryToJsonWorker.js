const { parentPort } = require('worker_threads');
const fs = require('fs-extra');
const path = require('path');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('workers/idmcSummaryToJsonWorker');

// Lazy load to avoid heavy init before first task
let idmcService = null;

async function handleWork(message) {
  try {
    const { filePath, extractedPath } = message;
    if (!idmcService) {
      idmcService = require('../services/idmcConversionService');
    }

    log.info(`Worker processing IDMC summary file: ${path.basename(filePath)}`);
    
    // Read the IDMC summary content
    const summaryContent = await fs.readFile(filePath, 'utf8');
    const rel = path.relative(extractedPath, filePath);
    const base = path.basename(filePath);
    
    // Convert IDMC summary to JSON
    log.info(`Worker converting IDMC summary to JSON: ${base}`);
    const jsonContent = await idmcService.convertIdmcSummaryToJson(summaryContent, base);
    
    // Generate output filename (replace extension with .bin - changed from .bat)
    const ext = path.extname(rel);
    const baseName = rel.substring(0, rel.length - ext.length);
    const outName = `${baseName}_IDMC_Mapping.bin`;
    
    log.info(`Worker completed conversion: ${base} -> ${outName}`);
    
    parentPort.postMessage({
      success: true,
      result: {
        original: rel,
        converted: outName,
        jsonContent: jsonContent,
        originalContent: summaryContent
      }
    });
  } catch (error) {
    log.error('Worker error in IDMC summary to JSON conversion', { 
      error: error.message, 
      stack: error.stack,
      filePath: message?.filePath 
    });
    parentPort.postMessage({ 
      success: false, 
      error: error.message 
    });
  }
}

parentPort.on('message', handleWork);

