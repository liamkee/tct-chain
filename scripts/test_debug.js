async function run() {
  const res = await fetch('http://127.0.0.1:8787/api/debug');
  const data = await res.json();
  Object.values(data.membersDebug).forEach((m) => {
    console.log(`[${m.id}] ${m.name}: real_stats=${m.real_stats}`);
  });
}
run();
