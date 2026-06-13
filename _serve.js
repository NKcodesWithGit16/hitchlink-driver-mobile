const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'dist');
const port = 5055;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.ttf': 'font/ttf', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.ico': 'image/x-icon',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let fp = path.join(root, p);
  if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    fp = path.join(root, 'index.html');
  }
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(fp)] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
}).listen(port, () => console.log('HitchLink Driver serving on http://localhost:' + port));
