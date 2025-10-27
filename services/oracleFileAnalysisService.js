const fs = require('fs-extra');
const path = require('path');

class OracleFileAnalysisService {
  constructor() {
    this.oracleFileExtensions = ['.sql', '.pls', '.pkg', '.pkb', '.pks'];
  }

  async analyzeOracleProjectFromDirectory(projectPath) {
    try {
      console.log(`🔍 Analyzing Oracle project at: ${projectPath}`);
      
      const analysis = {
        totalFiles: 0,
        sqlFiles: 0,
        plsqlFiles: 0,
        totalLinesOfCode: 0,
        fileSize: 0,
        procedures: [],
        functions: [],
        packages: [],
        tables: [],
        views: [],
        triggers: [],
        sequences: [],
        dependencies: [],
        plsqlFilesList: []
      };

      // Recursively scan the directory
      await this.scanDirectory(projectPath, projectPath, analysis);
      
      console.log(`📊 Analysis complete:`);
      console.log(`  - Total files: ${analysis.totalFiles}`);
      console.log(`  - SQL files: ${analysis.sqlFiles}`);
      console.log(`  - PL/SQL files: ${analysis.plsqlFiles}`);
      console.log(`  - Total lines of code: ${analysis.totalLinesOfCode}`);
      console.log(`  - File size: ${this.formatFileSize(analysis.fileSize)}`);
      
      return analysis;
    } catch (error) {
      console.error('Error analyzing Oracle project:', error);
      throw error;
    }
  }

  async scanDirectory(currentPath, projectPath, analysis) {
    try {
      const items = await fs.readdir(currentPath);
      
      for (const item of items) {
        // Skip hidden files and common non-source directories
        if (item.startsWith('.')) continue;
        if (item === 'node_modules' || item === 'bin' || item === 'obj' || item === 'packages') continue;
        
        const itemPath = path.join(currentPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          await this.scanDirectory(itemPath, projectPath, analysis);
        } else if (this.isOracleFile(item)) {
          await this.analyzeOracleFile(itemPath, projectPath, analysis);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${currentPath}:`, error.message);
      // Continue scanning other directories even if one fails
    }
  }

  isOracleFile(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const name = fileName.toLowerCase();
    
    return this.oracleFileExtensions.includes(ext) || 
           name.includes('.sql') ||
           name.includes('.pls') ||
           name.includes('.pkg') ||
           name.includes('.pkb') ||
           name.includes('.pks');
  }

  async analyzeOracleFile(filePath, projectPath, analysis) {
    try {
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf8');
      const relativePath = path.relative(projectPath, filePath);
      
      analysis.totalFiles++;
      analysis.fileSize += stats.size;
      
      const lines = content.split('\n');
      analysis.totalLinesOfCode += lines.length;
      
      const ext = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath);
      
      // Determine file type
      if (ext === '.sql' || fileName.toLowerCase().includes('.sql')) {
        analysis.sqlFiles++;
      } else if (ext === '.pls' || ext === '.pkg' || ext === '.pkb' || ext === '.pks' || 
                 fileName.toLowerCase().includes('.pls') || fileName.toLowerCase().includes('.pkg')) {
        analysis.plsqlFiles++;
        analysis.plsqlFilesList.push({
          name: fileName,
          path: relativePath,
          size: this.formatFileSize(stats.size),
          lines: lines.length
        });
      }
      
      // Analyze content for Oracle constructs
      await this.analyzeOracleConstructs(content, analysis, fileName);
      
    } catch (error) {
      console.error(`Error analyzing file ${filePath}:`, error.message);
    }
  }

  async analyzeOracleConstructs(content, analysis, fileName) {
    const upperContent = content.toUpperCase();
    
    // Analyze procedures
    const procedureMatches = upperContent.match(/CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+(\w+)/gi);
    if (procedureMatches) {
      procedureMatches.forEach(match => {
        const procedureName = match.match(/PROCEDURE\s+(\w+)/i)[1];
        if (!analysis.procedures.includes(procedureName)) {
          analysis.procedures.push(procedureName);
        }
      });
    }
    
    // Analyze functions
    const functionMatches = upperContent.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)/gi);
    if (functionMatches) {
      functionMatches.forEach(match => {
        const functionName = match.match(/FUNCTION\s+(\w+)/i)[1];
        if (!analysis.functions.includes(functionName)) {
          analysis.functions.push(functionName);
        }
      });
    }
    
    // Analyze packages
    const packageMatches = upperContent.match(/CREATE\s+(?:OR\s+REPLACE\s+)?PACKAGE\s+(\w+)/gi);
    if (packageMatches) {
      packageMatches.forEach(match => {
        const packageName = match.match(/PACKAGE\s+(\w+)/i)[1];
        if (!analysis.packages.includes(packageName)) {
          analysis.packages.push(packageName);
        }
      });
    }
    
    // Analyze tables
    const tableMatches = upperContent.match(/CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(\w+)/gi);
    if (tableMatches) {
      tableMatches.forEach(match => {
        const tableName = match.match(/TABLE\s+(\w+)/i)[1];
        if (!analysis.tables.includes(tableName)) {
          analysis.tables.push(tableName);
        }
      });
    }
    
    // Analyze views
    const viewMatches = upperContent.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/gi);
    if (viewMatches) {
      viewMatches.forEach(match => {
        const viewName = match.match(/VIEW\s+(\w+)/i)[1];
        if (!analysis.views.includes(viewName)) {
          analysis.views.push(viewName);
        }
      });
    }
    
    // Analyze triggers
    const triggerMatches = upperContent.match(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)/gi);
    if (triggerMatches) {
      triggerMatches.forEach(match => {
        const triggerName = match.match(/TRIGGER\s+(\w+)/i)[1];
        if (!analysis.triggers.includes(triggerName)) {
          analysis.triggers.push(triggerName);
        }
      });
    }
    
    // Analyze sequences
    const sequenceMatches = upperContent.match(/CREATE\s+(?:OR\s+REPLACE\s+)?SEQUENCE\s+(\w+)/gi);
    if (sequenceMatches) {
      sequenceMatches.forEach(match => {
        const sequenceName = match.match(/SEQUENCE\s+(\w+)/i)[1];
        if (!analysis.sequences.includes(sequenceName)) {
          analysis.sequences.push(sequenceName);
        }
      });
    }
    
    // Analyze dependencies (simplified)
    const dependencyMatches = upperContent.match(/(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(\w+)/gi);
    if (dependencyMatches) {
      dependencyMatches.forEach(match => {
        const dependency = match.match(/(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(\w+)/i)[1];
        if (!analysis.dependencies.includes(dependency) && 
            !['DUAL', 'SYSDATE', 'USER', 'SYSTEM'].includes(dependency.toUpperCase())) {
          analysis.dependencies.push(dependency);
        }
      });
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async getFileAnalysisSummary(analysis) {
    return {
      totalFiles: analysis.totalFiles,
      sqlFiles: analysis.sqlFiles,
      plsqlFiles: analysis.plsqlFiles,
      totalLinesOfCode: analysis.totalLinesOfCode,
      fileSize: this.formatFileSize(analysis.fileSize),
      procedures: analysis.procedures.length,
      functions: analysis.functions.length,
      packages: analysis.packages.length,
      tables: analysis.tables.length,
      views: analysis.views.length,
      triggers: analysis.triggers.length,
      sequences: analysis.sequences.length,
      dependencies: analysis.dependencies.length,
      plsqlFilesList: analysis.plsqlFilesList
    };
  }
}

module.exports = new OracleFileAnalysisService();
