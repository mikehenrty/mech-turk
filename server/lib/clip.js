(function() {
  'use strict';

  const glob = require('glob');
  const ms = require('mediaserver');
  const metrics = require('./metrics');
  const path = require('path');
  const ff = require('ff');
  const fs = require('fs');
  const FSHelper = require('./fs-helper');
  const fsHelper = new FSHelper();

  const UPLOAD_PATH = FSHelper.RECORDED_PATH;

  const ACCEPTED_EXT = FSHelper.ACCEPTED_EXT;

  let clip = {

    isUpload: function(request) {
      return request.url.includes('/upload/');
    },

    isVerify: function(request) {
      return request.url.includes('/verify/');
    },

    /**
     * Is this request directed at voice clips?
     */
    isClipRequest: function(request) {
      return this.isUpload(request) || this.isVerify(request);
    },

    handleRequest: function(request, response) {
      if (request.method === 'GET') {
        clip.serve(request, response);
        return;
      }

      if (request.method !== 'POST') {
        console.error('unrecognized method', request.method);
        response.writeHead(500);
        response.end('Error');
        return;
      }

      metrics.trackSubmission(request);
      clip.save(request).then(timestamp => {
        response.writeHead(200);
        response.end('' + timestamp);
      }).catch(e => {
        response.writeHead(500);
        console.error('saving file error', e, e.stack);
        response.end('Error');
      });
    },

    save: function(request) {
      let info = request.headers;
      let hitId = info.hitid;
      let uid = info.uid;
      let sentence = unescape(info.sentence);
      let assignmentId = info.assignmentid;

      // For verify posts, we simply save a verification file.
      if (this.isVerify(request)) {
        const workerId = info.previousworkerid;
        const verifyId = info.verifyid;
        const answer = info.answer;
        return fsHelper.handleVerifyRequest(workerId, verifyId, uid, answer, request);
      }

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
          fsHelper.writeRecordTextFile(uid, assignmentId, sentence, f());
          fsHelper.writeRecordMetaFile(hitId, uid, assignmentId, extension, f());
        }, () => {
          console.log('file written?', file);
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
