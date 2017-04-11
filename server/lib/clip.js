(function() {
  'use strict';

  const glob = require('glob');
  const ms = require('mediaserver');
  const metrics = require('./metrics');
  const path = require('path');
  const ff = require('ff');
  const fs = require('fs');

  const UPLOAD_PATH = path.resolve(__dirname, '..', 'upload', 'recorded');

  const ACCEPTED_EXT = [ 'ogg', 'webm', 'm4a' ];

  let clip = {

    /**
     * Is this request directed at voice clips?
     */
    isClipRequest: function(request) {
      return request.url.includes('/upload/');
    },

    handleRequest: function(request, response) {
      if (request.method === 'POST') {
        metrics.trackSubmission(request);
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
    },

    save: function(request) {
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
    },

    serve: function(request, response) {
      let ids = request.url.split('/');
      let assignmentId = ids.pop();
      let workerid = ids.pop();
      let prefix = path.join(UPLOAD_PATH, workerid, assignmentId);

      glob(prefix + '.*', (err, files) => {
        if (err) {
          console.error('could not glob for clip', err);
          return;
        }

        // Try to find the right file, since we don't know the extension.
        let file = null;
        for (let i = 0; i < files.length; i++) {
          let ext = files[i].split('.').pop();
          if (ACCEPTED_EXT.indexOf(ext) !== -1) {
            file = files[i];
            break;
          }
        }

        if (!file) {
          console.error('could not find clip', files);
          return;
        }

        ms.pipe(request, response, file);
      });
    }
  };

  module.exports = clip;
})();
