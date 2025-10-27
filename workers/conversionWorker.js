const { parentPort, workerData } = require('worker_threads');
const fs = require('fs-extra');
const path = require('path');
const OpenAI = require('openai');
const packageExtractionService = require('../services/packageExtractionService');
const classNameExtractionService = require('../services/classNameExtractionService');

class ConversionWorker {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.openai = null;
    
    if (this.apiKey) {
      this.openai = new OpenAI({
        apiKey: this.apiKey
      });
    }
  }

  async convertCSharpToJava(csharpCode, fileName, targetFolder, existingClasses = [], basePackage = 'com.example.application') {
    try {
      if (!this.apiKey || !this.openai) {
        throw new Error('OpenAI API key not configured');
      }

      // Create a list of existing classes to avoid duplicates
      const existingClassesList = existingClasses.length > 0 
        ? `\n\nEXISTING CLASSES (do not recreate these):\n${existingClasses.map(cls => `- ${cls}`).join('\n')}`
        : '';

      const prompt = `Convert the following ASP.NET Core C# file into equivalent Java code using Quarkus.

CRITICAL REQUIREMENTS:
1. Generate ONLY ONE Java class per file
2. Do NOT include multiple classes in the same file
3. Do NOT include configuration properties in Java files
4. For DTO files: Convert ALL classes in the file (including nested classes, multiple DTOs, etc.)
5. For Controller files: Convert the main controller class only
6. For Model/Entity files: Convert the main entity class only
7. For Service files: Convert the main service class only
8. Do NOT recreate classes that already exist (see existing classes list)
9. Use imports to reference existing classes instead of recreating them
10. Output ONLY the converted Java code - no explanations, no additional classes
11. Maintain the same structure, routes, and logic
12. If there's no direct equivalent in Quarkus, implement the closest possible Java alternative

Target Folder: ${targetFolder}
Base Package: ${basePackage}
Original File: ${fileName}${existingClassesList}

C# Code:
${csharpCode}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a Java developer. Convert C# code to executable Java source code using Quarkus.

CRITICAL INSTRUCTIONS:
- Convert this file to executable Java source code
- For DTO files: Convert ALL classes in the file (including multiple DTOs, nested classes, etc.)
- For other files: Generate ONLY ONE Java class per file
- Do NOT include multiple classes in the same file (except for DTO files)
- Output ONLY executable Java code - nothing else
- NO explanations, NO descriptions, NO introductory text
- NO "Here is the converted Java code:" or similar text
- NO "This Java code is compatible with Quarkus" or similar descriptions
- NO "The class is annotated" or similar explanations
- NO educational text or documentation
- Start directly with package declaration or imports
- Generate working, compilable Java code only
- Do not explain anything about the code`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.1
      });

      const javaCode = response.choices[0].message.content;
      return this.cleanJavaCode(javaCode, fileName, targetFolder, basePackage);
    } catch (error) {
      console.error('Error converting C# to Java:', error);
      throw error;
    }
  }

  cleanJavaCode(javaCode, fileName = '', targetFolder = '', basePackage = 'com.example.application') {
    let cleaned = javaCode;
    
    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/```java\n?/g, '').replace(/```\n?/g, '');
    
    // Remove common explanatory text patterns
    cleaned = cleaned.replace(/^Here is the converted Java code:\s*\n/gm, '');
    cleaned = cleaned.replace(/^This Java code is compatible with Quarkus.*?\n/gm, '');
    cleaned = cleaned.replace(/^The class is annotated.*?\n/gm, '');
    cleaned = cleaned.replace(/^The fields are annotated.*?\n/gm, '');
    cleaned = cleaned.replace(/^The C# properties are converted.*?\n/gm, '');
    cleaned = cleaned.replace(/^This code follows.*?\n/gm, '');
    cleaned = cleaned.replace(/^The code uses.*?\n/gm, '');
    cleaned = cleaned.replace(/^It uses Java's.*?\n/gm, '');
    cleaned = cleaned.replace(/^Imports:\s*\n/gm, '');
    cleaned = cleaned.replace(/^These are the necessary imports.*?\n/gm, '');
    cleaned = cleaned.replace(/^Please note that.*?\n/gm, '');
    cleaned = cleaned.replace(/^If not, you will need to create these classes\.\s*\n/gm, '');
    
    // Remove lines that start with explanatory text
    cleaned = cleaned.replace(/^.*?(?:imports|necessary|note|assumed|defined|packages|classes|compatible|follows|uses|annotated|converted|properties).*?\n/gm, '');
    
    // Remove lines that are just explanatory text
    cleaned = cleaned.replace(/^.*?(?:Java code|Quarkus|annotations|database|columns|getters|setters|requirements|mentioned).*?\n/gm, '');
    
    // Remove any remaining explanatory sentences
    cleaned = cleaned.replace(/^.*?(?:This|The|It|Here|Please|Note|Imports|These|If|When|Where|How|What|Why).*?(?:code|class|method|field|property|annotation|import|package|database|table|column|getter|setter|converted|compatible|follows|uses|annotated|mapped|converted|properties|requirements|mentioned|assumed|defined|packages|classes).*?\n/gm, '');
    
    // Fix package declarations - use dynamic package structure
    const targetPackage = packageExtractionService.getPackageForTargetFolder(basePackage, targetFolder);
    
    if (cleaned.includes('package ') && !cleaned.includes(`package ${targetPackage}`)) {
      // Replace incorrect package declarations with proper package
      cleaned = cleaned.replace(/^package\s+[^;]+;$/gm, `package ${targetPackage};`);
    } else if (!cleaned.includes('package ')) {
      // Add package declaration if missing
      cleaned = `package ${targetPackage};\n\n${cleaned}`;
    }
    
    // CRITICAL FIX: Handle multiple classes in one file
    const isDtoFile = fileName.toLowerCase().includes('dto') || targetFolder === 'dto';
    let validJavaCode = '';
    
    if (isDtoFile) {
      validJavaCode = cleaned;
    } else {
      const packageSections = cleaned.split(/(?=^package\s+)/m);
      
      for (const section of packageSections) {
        if (section.trim()) {
          const lines = section.split('\n');
          let javaLines = [];
          let inJavaCode = false;
          let braceCount = 0;
          let foundClass = false;
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('package ') || 
                trimmedLine.startsWith('import ') || 
                trimmedLine.startsWith('@') ||
                trimmedLine.startsWith('public ') ||
                trimmedLine.startsWith('private ') ||
                trimmedLine.startsWith('protected ') ||
                trimmedLine.startsWith('class ') ||
                trimmedLine.startsWith('interface ') ||
                trimmedLine.startsWith('enum ') ||
                trimmedLine.startsWith('{') ||
                trimmedLine.startsWith('}') ||
                trimmedLine.startsWith('//') ||
                trimmedLine === '') {
              inJavaCode = true;
              javaLines.push(line);
              
              if (trimmedLine.includes('{')) braceCount++;
              if (trimmedLine.includes('}')) braceCount--;
              
              if (trimmedLine.startsWith('public class ') || 
                  trimmedLine.startsWith('class ') ||
                  trimmedLine.startsWith('public interface ') ||
                  trimmedLine.startsWith('interface ')) {
                foundClass = true;
              }
            } else if (inJavaCode) {
              javaLines.push(line);
              if (trimmedLine.includes('{')) braceCount++;
              if (trimmedLine.includes('}')) braceCount--;
            }
            
            if (foundClass && braceCount === 0 && trimmedLine === '}') {
              break;
            }
          }
          
          if (javaLines.length > 0 && foundClass) {
            validJavaCode = javaLines.join('\n');
            break;
          }
        }
      }
    }
    
    if (!validJavaCode) {
      const lines = cleaned.split('\n');
      const javaLines = [];
      let inJavaCode = false;
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (trimmedLine.startsWith('package ') || 
            trimmedLine.startsWith('import ') || 
            trimmedLine.startsWith('@') ||
            trimmedLine.startsWith('public ') ||
            trimmedLine.startsWith('private ') ||
            trimmedLine.startsWith('protected ') ||
            trimmedLine.startsWith('class ') ||
            trimmedLine.startsWith('interface ') ||
            trimmedLine.startsWith('enum ') ||
            trimmedLine.startsWith('{') ||
            trimmedLine.startsWith('}') ||
            trimmedLine.startsWith('//') ||
            trimmedLine === '') {
          inJavaCode = true;
          javaLines.push(line);
        } else if (inJavaCode) {
          javaLines.push(line);
        }
      }
      
      validJavaCode = javaLines.join('\n');
    }
    
    // Remove configuration properties that shouldn't be in Java files
    validJavaCode = validJavaCode.replace(/^[a-zA-Z0-9._-]+=.*$/gm, '');
    
    // Remove multiple consecutive empty lines
    validJavaCode = validJavaCode.replace(/\n\s*\n\s*\n/g, '\n\n');
    
    // Remove any leading/trailing whitespace
    validJavaCode = validJavaCode.trim();
    
    return validJavaCode;
  }

  async getJavaFileName(csharpPath, csharpCode = '') {
    const ext = path.extname(csharpPath);
    const baseName = path.basename(csharpPath, ext);
    const dirName = path.dirname(csharpPath).toLowerCase();
    
    // Extract class name from C# code to ensure proper Java file naming
    const { javaFileName, className } = await classNameExtractionService.getCorrectJavaFileName(csharpPath, csharpCode);
    
    let targetFolder = 'service';
    
    if (dirName.includes('controller') || dirName.includes('api') || dirName.includes('endpoint')) {
      targetFolder = 'resource';
    } else if (dirName.includes('model') || dirName.includes('entity') || dirName.includes('domain')) {
      targetFolder = 'entity';
    } else if (dirName.includes('repository') || dirName.includes('data') || dirName.includes('dal')) {
      targetFolder = 'repository';
    } else if (dirName.includes('dto') || dirName.includes('request') || dirName.includes('response')) {
      targetFolder = 'dto';
    } else if (dirName.includes('exception') || dirName.includes('error')) {
      targetFolder = 'exception';
    } else if (dirName.includes('config') || dirName.includes('configuration')) {
      targetFolder = 'config';
    } else if (dirName.includes('service') || dirName.includes('business') || dirName.includes('logic')) {
      targetFolder = 'service';
    } else {
      const code = csharpCode.toLowerCase();
      
      if (code.includes('controller') || code.includes('[route]') || code.includes('[httpget]') || 
          code.includes('[httppost]') || code.includes('api') || code.includes('endpoint')) {
        targetFolder = 'resource';
      } else if (code.includes('class') && (code.includes('entity') || code.includes('model') || 
                 code.includes('table') || code.includes('dbcontext'))) {
        targetFolder = 'entity';
      } else if (code.includes('repository') || code.includes('data') || code.includes('dbcontext') ||
                 code.includes('query') || code.includes('select') || code.includes('insert')) {
        targetFolder = 'repository';
      } else if (code.includes('dto') || code.includes('request') || code.includes('response') ||
                 code.includes('viewmodel') || code.includes('model')) {
        targetFolder = 'dto';
      } else if (code.includes('exception') || code.includes('error') || code.includes('throw')) {
        targetFolder = 'exception';
      } else if (code.includes('configuration') || code.includes('config') || code.includes('setup') ||
                 code.includes('jwt') || code.includes('authentication')) {
        targetFolder = 'config';
      } else if (code.includes('service') || code.includes('business') || code.includes('logic') ||
                 code.includes('manager') || code.includes('handler')) {
        targetFolder = 'service';
      }
    }
    
    return {
      javaFileName: javaFileName,
      targetFolder: targetFolder,
      className: className
    };
  }

  async addFunctionalitySummary(csharpCode, javaCode, className) {
    try {
      if (!this.apiKey || !this.openai) {
        console.warn('⚠️ OpenAI API key not configured, skipping functionality summary');
        return javaCode;
      }

      const summaryPrompt = `Analyze the following C# class and provide a brief summary of its functionality. 
      Focus on what the class does, its main purpose, and key methods. Keep it concise (2-3 sentences max).
      
      C# Code:
      ${csharpCode}
      
      Provide only the summary, no additional text.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a code analyst. Provide concise summaries of class functionality.'
          },
          {
            role: 'user',
            content: summaryPrompt
          }
        ],
        max_tokens: 200,
        temperature: 0.1
      });

      const summary = response.choices[0].message.content.trim();
      
      // Add the summary as a comment at the top of the Java code
      const commentHeader = `/**
 * ${summary}
 * 
 * Converted from C# to Java using Quarkus framework.
 */`;

      // Insert the comment after the package declaration and imports
      const lines = javaCode.split('\n');
      let insertIndex = 0;
      
      // Find where to insert the comment (after package and imports)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('package ') || lines[i].trim().startsWith('import ')) {
          insertIndex = i + 1;
        } else if (lines[i].trim() && !lines[i].trim().startsWith('package ') && !lines[i].trim().startsWith('import ')) {
          break;
        }
      }
      
      lines.splice(insertIndex, 0, '', commentHeader, '');
      return lines.join('\n');
      
    } catch (error) {
      console.warn(`⚠️ Failed to add functionality summary: ${error.message}`);
      return javaCode;
    }
  }

  async processFile(fileData) {
    const { filePath, extractedPath, existingClasses, basePackage } = fileData;
    
    try {
      console.log(`Worker processing: ${path.basename(filePath)}`);
      
      const csharpCode = await fs.readFile(filePath, 'utf8');
      const relativePath = path.relative(extractedPath, filePath);
      const { javaFileName, targetFolder, className } = await this.getJavaFileName(relativePath, csharpCode);
      
      // Add timeout to prevent hanging
      const conversionPromise = this.convertCSharpToJava(csharpCode, javaFileName, targetFolder, existingClasses, basePackage);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('GPT conversion timeout after 2 minutes')), 120000)
      );
      
      const javaCode = await Promise.race([conversionPromise, timeoutPromise]);
      
      // Add functionality summary as comments
      const javaCodeWithSummary = await this.addFunctionalitySummary(csharpCode, javaCode, className);
      
      // Validate that the file name matches the class name
      const isValidFileName = classNameExtractionService.validateFileNameMatchesClassName(javaFileName, javaCodeWithSummary);
      if (!isValidFileName) {
        console.warn(`⚠️ File name doesn't match class name for ${javaFileName}`);
      }
      
      return {
        success: true,
        original: relativePath,
        converted: javaFileName,
        targetFolder: targetFolder,
        className: className,
        javaCode: javaCodeWithSummary,
        filePath: filePath
      };
    } catch (error) {
      console.error(`Worker error processing ${filePath}:`, error);
      return {
        success: false,
        error: error.message,
        filePath: filePath
      };
    }
  }
}

// Worker thread entry point
if (!parentPort) {
  throw new Error('This file must be run as a worker thread');
}

const worker = new ConversionWorker();

parentPort.on('message', async (message) => {
  try {
    const result = await worker.processFile(message);
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
});
