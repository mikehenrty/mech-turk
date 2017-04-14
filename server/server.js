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

  function handleStaticRequest(request, response) {
    // Track our request static request
    metrics.trackRequest(request);
    request.addListener('end', () => {
      fileServer.serve(request, response);
    }).resume();
  }

  jsonfile.readFile(CONFIG_FILE, (err, config) => {
    let port = config.port || DEFAULT_PORT;
    require('http').createServer((request, response) => {

      // Handle all clip related requests first.
      if (clip.isClipRequest(request)) {
        clip.handleRequest(request, response);
        return;
      }

      // If it's a metrics only request, respond with 200 always.
      if (metrics.isEventRequest(request)) {
        metrics.handleRequest(request, response);
        return;
      }

      // If we get here, feed request to static parser.
      handleStaticRequest(request, response);
    }).listen(port);
    console.log(`listening at http://localhost:${port}`);
  });
})();
