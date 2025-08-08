const fs = require('fs');
const path = require('path');

function fixImportsInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fixed = content.replace(/from '([^']+)\.js'/g, "from '$1'");
  fs.writeFileSync(filePath, fixed);
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (file.endsWith('.ts')) {
      fixImportsInFile(filePath);
    }
  }
}

walkDir('lib/fill-detector');
console.log('Fixed imports in all TypeScript files');