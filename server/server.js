var path = require('path');
var static = require('node-static');
var jsonfile = require('jsonfile');
var fs = require('fs');
var ff = require('ff');
var ms = require('mediaserver');

const DEFAULT_PORT = 9000;
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const UPLOAD_PATH = path.join(__dirname, 'upload');

var fileServer = new static.Server('./pub', { cache: false });

function saveClip(request) {
  var info = request.headers;
  var uid = info.uid;
  var sentence = info.sentence;
  var assignmentId = info.assignmentid;

  return new Promise((resolve, reject) => {
    var extension = '.ogg';  // Firefox gives us opus in ogg
    if (info['content-type'].startsWith('audio/webm')) {
      extension = '.webm';   // Chrome gives us opus in webm
    } else if (info['content-type'].startsWith('audio/mp4a')) {
      extension = '.m4a'; // iOS gives us mp4a
    }

    // if the folder does not exist, we create it
    var folder = path.join(UPLOAD_PATH, uid);
    var file = path.join(folder, assignmentId + extension);

    var f = ff(() => {
      fs.exists(folder, f.slotPlain());
    }, exists => {
      if (!exists) {
        fs.mkdir(folder, f());
      }
    }, () => {
      var writeStream = fs.createWriteStream(file);
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
  var ids = request.url.split('/');
  var assignmentId = ids.pop();
  var workerid = ids.pop();

  var filepath = path.resolve(UPLOAD_PATH, workerid, assignmentId + '.ogg');
  ms.pipe(request, response, filepath);
}

jsonfile.readFile(CONFIG_FILE, function(err, config) {
  var port = config.port || DEFAULT_PORT;
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
      fileServer.serve(request, response);
    }).resume();
  }).listen(port);
  console.log(`listening at http://localhost:${port}`);
});
