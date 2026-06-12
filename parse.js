const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:\\Users\\acer\\.gemini\\antigravity-ide\\brain\\26ba8390-f91b-41fc-bed7-0a3f337bbf7c\\.system_generated\\steps\\44\\output.txt', 'utf8'));
data.projects.forEach(p => {
  console.log(`Project: ${p.title} (${p.name})`);
  (p.screenInstances || []).forEach(s => {
    console.log(`  - Screen ID: ${s.id}`);
  });
  console.log('');
});
