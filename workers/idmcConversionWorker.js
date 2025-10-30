const { parentPort } = require('worker_threads');
const fs = require('fs-extra');
const path = require('path');
const { createModuleLogger } = require('../utils/logger');
const log = createModuleLogger('workers/idmcConversionWorker');

// Lazy load to avoid heavy init before first task
let idmcService = null;

function detectSourceTypeFromNameAndContent(fileName, content, fallback = 'sql') {
  try {
    const upper = (content || '').toUpperCase();

    // Filename hints
    if (/(redshift|rs_\b|\brs_|_rs\b|\bredshift\b)/i.test(fileName || '')) return 'redshift';
    if (/(oracle|plsql|pkg|pks|pkb)/i.test(fileName || '')) return 'oracle';

    // Content cues
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

async function handleWork(message) {
  try {
    const { filePath, extractedPath } = message;
    if (!idmcService) {
      idmcService = require('../services/idmcConversionService');
    }

    const code = await fs.readFile(filePath, 'utf8');
    const rel = path.relative(extractedPath, filePath);
    const base = path.basename(filePath);

    // Detect source type using filename + content, then fallback to service analyzer
    let detected = detectSourceTypeFromNameAndContent(base, code, 'sql');
    if (detected === 'sql') {
      detected = idmcService.analyzeSqlContent(code) || 'sql';
    }

    const outName = idmcService.getIDMCFileName(rel, 'sql');
    const idmcSummary = detected === 'redshift'
      ? await idmcService.convertRedshiftToIDMC(code, base, 'sql')
      : await idmcService.convertOracleToIDMC(code, base, 'sql');

    parentPort.postMessage({
      success: true,
      result: {
        original: rel,
        converted: outName,
        idmcContent: idmcSummary,
        detectedType: detected,
        originalContent: code
      }
    });
  } catch (error) {
    log.error('Worker error in IDMC conversion', { error: error.message, stack: error.stack });
    parentPort.postMessage({ success: false, error: error.message });
  }
}

parentPort.on('message', handleWork);


