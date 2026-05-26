import fs from 'fs';
async function test() {
  const envContent = fs.readFileSync('.dev.vars', 'utf-8');
  let key = '';
  for (const line of envContent.split('\n')) {
    if (line.startsWith('COMMANDER_API_KEY=')) {
      key = line.split('=')[1].trim();
    }
  }

  const res = await fetch(`https://api.torn.com/user/?selections=battlestats&key=${key}`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test();
