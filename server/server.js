(function() {
  'use strict';

  const path = require('path');
  const nodeStatic = require('node-static');
  const jsonfile = require('jsonfile');
  const fs = require('fs');
  const ff = require('ff');
  const ms = require('mediaserver');
  const metrics = require('./lib/metrics');

  const DEFAULT_PORT = 9000;
  const CONFIG_FILE = path.resolve(__dirname, '..', 'config.json');
  const UPLOAD_PATH = path.resolve(__dirname, 'upload', 'recorded');

  let fileServer = new nodeStatic.Server('./pub', { cache: false });

  function saveClip(request) {
    let info = request.headers;
    let uid = info.uid;
    let sentence = info.sentence;
    let assignmentId = info.assignmentid;

    return new Promise((resolve, reject) => {
      let extension = '.ogg';  // Firefox gives us opus in ogg
      if (info['content-type'].startsWith('audio/webm')) {
        extension = '.webm';   // Chrome gives us opus in webm
      } else if (info['content-type'].startsWith('audio/mp4a')) {
        extension = '.m4a'; // iOS gives us mp4a
      }

      // if the folder does not exist, we create it
      let folder = path.join(UPLOAD_PATH, uid);
      let file = path.join(folder, assignmentId + extension);

      let f = ff(() => {
        fs.exists(folder, f.slotPlain());
      }, exists => {
        if (!exists) {
          fs.mkdir(folder, f());
        }
      }, () => {
        let writeStream = fs.createWriteStream(file);
        request.pipe(writeStream);
        request.on('end', f());
        fs.writeFile(path.join(folder, assignmentId + '.txt'), sentence, f());
      }, () => {
        console.log('file written', file);
        resolve(assignmentId);
      }).onError(reject);
    });
  }

  function sendFile(request, response) {
    let ids = request.url.split('/');
    let assignmentId = ids.pop();
    let workerid = ids.pop();

    let filepath = path.resolve(UPLOAD_PATH, workerid, assignmentId + '.ogg');
    ms.pipe(request, response, filepath);
  }

  jsonfile.readFile(CONFIG_FILE, function(err, config) {
    let port = config.port || DEFAULT_PORT;
    require('http').createServer(function (request, response) {
      if (request.url.includes('/upload/')) {
        if (request.method === 'POST') {
          saveClip(request).then(timestamp => {
            response.writeHead(200);
            response.end('' + timestamp);
          }).catch(e => {
            response.writeHead(500);
            console.error('saving clip error', e, e.stack);
            response.end('Error');
          });
        } else {
          sendFile(request, response);
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
