const { parentPort } = require('worker_threads');
const fs = require('fs-extra');
const path = require('path');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('workers/batchScriptConversionWorker');

// Lazy load services to avoid heavy init before first task
let batchScriptService = null;
let idmcService = null;

async function handleWork(message) {
  try {
    const { filePath, extractedPath, conversionType } = message; // conversionType: 'idmc' or 'human-language'
    
    if (!batchScriptService) {
      batchScriptService = require('../services/batchScriptService');
    }
    if (!idmcService && conversionType === 'idmc') {
      idmcService = require('../services/idmcConversionService');
    }

    log.info(`Worker processing batch script: ${path.basename(filePath)} (type: ${conversionType})`);
    
    const content = await fs.readFile(filePath, 'utf8');
    const fileName = path.basename(filePath);
    const relativePath = path.relative(extractedPath, filePath);
    
    if (conversionType === 'idmc') {
      // Batch Script to IDMC conversion
      const result = await batchScriptService.processBatchScriptContent(content, fileName, null);
      
      // Extract the main IDMC summary for convertedContent field
      const mainIdmcSummary = result.idmcSummaries && result.idmcSummaries.length > 0 
        ? result.idmcSummaries[0].idmcSummary || ''
        : '';
      
      // Ensure success is explicitly set
      const isSuccess = result.success !== false && result.idmcSummaries && result.idmcSummaries.length > 0;
      
      parentPort.postMessage({
        success: isSuccess,
        result: {
          original: relativePath,
          fileName: fileName,
          scriptType: result.scriptType || 'unknown',
          extractionResult: result.extractionResult || { totalStatements: 0, statements: [] },
          idmcSummaries: result.idmcSummaries || [],
          originalContent: result.originalContent || content,
          convertedContent: mainIdmcSummary,
          success: isSuccess,
          error: result.error || null
        }
      });
      
    } else if (conversionType === 'human-language') {
      // Batch Script to Human Language conversion
      const summary = await batchScriptService.generateHumanReadableSummary(content, fileName);
      
      parentPort.postMessage({
        success: true,
        result: {
          original: relativePath,
          fileName: fileName,
          originalContent: content,
          convertedContent: summary,
          summary: summary, // Keep for backward compatibility
          success: true
        }
      });
      
    } else {
      throw new Error(`Unknown conversion type: ${conversionType}`);
    }
    
  } catch (error) {
    log.error('Worker error in batch script conversion', { 
      error: error.message, 
      stack: error.stack,
      filePath: message.filePath,
      conversionType: message.conversionType
    });
    
    const fileName = message.filePath ? path.basename(message.filePath) : 'unknown';
    const relativePath = message.extractedPath && message.filePath 
      ? path.relative(message.extractedPath, message.filePath)
      : 'unknown';
    
    parentPort.postMessage({ 
      success: false, 
      error: error.message,
      result: {
        fileName: fileName,
        original: relativePath,
        originalContent: null,
        convertedContent: null,
        success: false,
        error: error.message
      }
    });
  }
}

parentPort.on('message', handleWork);

