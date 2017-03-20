var path = require('path');
var static = require('node-static');
var jsonfile = require('jsonfile');

const DEFAULT_PORT = 9000;
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');

var fileServer = new static.Server('./pub', { cache: false });

jsonfile.readFile(CONFIG_FILE, function(err, config) {
  var port = config.port || DEFAULT_PORT;
  require('http').createServer(function (request, response) {
    request.addListener('end', function () {
      fileServer.serve(request, response);
    }).resume();
  }).listen(port);
  console.log(`listening at http://localhost:${port}`);
});
