(function() {
  'use strict';

  const path = require('path');
  const nodeStatic = require('node-static');
  const jsonfile = require('jsonfile');
  const metrics = require('./lib/metrics');
  const clip = require('./lib/clip');

  const DEFAULT_PORT = 9000;
  const CONFIG_FILE = path.resolve(__dirname, '..', 'config.json');

  let fileServer = new nodeStatic.Server('./pub', { cache: false });


  jsonfile.readFile(CONFIG_FILE, function(err, config) {
    let port = config.port || DEFAULT_PORT;
    require('http').createServer(function (request, response) {
      if (request.url.includes('/upload/')) {
        if (request.method === 'POST') {
          clip.save(request).then(timestamp => {
            response.writeHead(200);
            response.end('' + timestamp);
          }).catch(e => {
            response.writeHead(500);
            console.error('saving clip error', e, e.stack);
            response.end('Error');
          });
        } else {
          clip.serve(request, response);
        }

        return;
      }

      request.addListener('end', function () {
        metrics.trackRequest(request, (err, results) => {
          // Serve file no matter what happened to our tracking request.
          fileServer.serve(request, response);
        });
      }).resume();
    }).listen(port);
    console.log(`listening at http://localhost:${port}`);
  });
})();
