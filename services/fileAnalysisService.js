const fs = require('fs-extra');
const path = require('path');

class FileAnalysisService {
  constructor() {
    // This service provides general file analysis utilities
    // that can be used across different file types
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async analyzeFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      
      return {
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size),
        lines: content.split('\n').length,
        extension: path.extname(filePath),
        name: path.basename(filePath),
        modified: stats.mtime
      };
    } catch (error) {
      console.error(`Error analyzing file ${filePath}:`, error);
      return null;
    }
  }

  async analyzeZipFile(zipPath) {
    try {
      const stats = await fs.stat(zipPath);
      
      return {
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size),
        name: path.basename(zipPath),
        modified: stats.mtime,
        type: 'zip'
      };
    } catch (error) {
      console.error(`Error analyzing zip file ${zipPath}:`, error);
      return null;
    }
  }

  // Generic file type detection
  isTextFile(filePath) {
    const textExtensions = ['.txt', '.sql', '.pls', '.pkg', '.pkb', '.pks', '.js', '.java', '.cs', '.py', '.md', '.json', '.xml', '.html', '.css'];
    return textExtensions.includes(path.extname(filePath).toLowerCase());
  }

  // Generic code file detection
  isCodeFile(filePath) {
    const codeExtensions = ['.sql', '.pls', '.pkg', '.pkb', '.pks', '.js', '.java', '.cs', '.py', '.ts', '.tsx', '.jsx'];
    return codeExtensions.includes(path.extname(filePath).toLowerCase());
  }
}

module.exports = new FileAnalysisService();
