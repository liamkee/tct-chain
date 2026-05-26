import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:8787/ws?userId=tester', {
  headers: {
    Cookie: 'tct_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmYWN0aW9uX2lkIjo1MzgyMiwiZXhwIjoyNTQwMTIxMjI4LCJpYXQiOjE3MTY3MjEyMjh9.dummy_signature'
  }
});

ws.on('open', () => {
  console.log('Connected to WS');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'SNAPSHOT' || msg.type === 'HEARTBEAT') {
    const xhang98 = msg.data.members['2153760'];
    const Praulent = msg.data.members['3204607'];
    
    console.log('xhang98 stats:', xhang98?.real_stats);
    console.log('Praulent stats:', Praulent?.real_stats);
    
    console.log('xhang98 full data:', JSON.stringify(xhang98, null, 2));
    
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err);
  process.exit(1);
});
