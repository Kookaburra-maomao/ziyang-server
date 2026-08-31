const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(target) : target.endsWith('.js') ? [target] : [];
  });
}

const files = [...filesIn(path.resolve(__dirname, '../src')), ...filesIn(__dirname), path.resolve(__dirname, '../ecosystem.config.js')];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`语法检查通过：${files.length} 个文件`);
