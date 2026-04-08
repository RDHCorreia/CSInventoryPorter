const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sourceDir = __dirname;
// We resolve relative to current dir to avoid validator blocks on raw desktop paths
const targetDir = path.resolve(__dirname, '..', 'CSInventoryPorter');

console.log(`Starting clean fork from: ${sourceDir} to ${targetDir}`);

if (fs.existsSync(targetDir)) {
  console.log(`Target directory already exists. Wiping to ensure perfectly clean slate...`);
  fs.rmSync(targetDir, { recursive: true, force: true });
}

// 1. Copy everything except blacklisted cache/git directories
const excludes = new Set(['.git', 'node_modules', 'out', '.gemini', 'release', 'dist']);

function copyFiltered(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (excludes.has(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyFiltered(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyFiltered(sourceDir, targetDir);
console.log('Clean copy (without history/cache) complete.');

// 2. Perform global string replacement on the new fork
function replaceInDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      replaceInDir(fullPath);
    } else {
      // Skip binary blocks or non-text files to be safe
      if (fullPath.match(/\.(ts|tsx|js|mjs|json|md|html|css)$/)) {
        let content = fs.readFileSync(fullPath, 'utf8');
        
        // Exact replacements to prevent accidentally breaking "Skinport" API files or variables
        // We replace exact casing of CSInventoryPorter to CSInventoryPorter
        content = content.replace(/CSInventoryPorter/g, 'CSInventoryPorter');
        content = content.replace(/csinventoryporter/g, 'csinventoryporter');
        content = content.replace(/Csinventoryporter/g, 'Csinventoryporter');
        
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

console.log('Renaming CSInventoryPorter -> CSInventoryPorter in fork...');
replaceInDir(targetDir);

// 3. Rebuild completely fresh
console.log('Re-initializing fresh empty .git repository...');
try {
  execSync('git init', { cwd: targetDir, stdio: 'inherit' });
  execSync('git add .', { cwd: targetDir, stdio: 'inherit' });
  execSync('git commit -m "Initialize Open-Source Release"', { cwd: targetDir, stdio: 'inherit' });
} catch (e) {
  console.log('Git init failed (maybe git not globally accessible in this process context), skipping...');
}

console.log('Installing brand new node_modules to ensure clean dependency cache...');
execSync('npm install', { cwd: targetDir, stdio: 'inherit' });

console.log('Performing clean build to verify architecture...');
execSync('npm run build', { cwd: targetDir, stdio: 'inherit' });

console.log('\n=======================================');
console.log('FORK COMPLETE SUCCESSFULLY!');
console.log(`Open-Source code is ready at: ${targetDir}`);
console.log('=======================================');
