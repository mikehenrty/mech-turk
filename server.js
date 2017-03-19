var static = require('node-static');
var jsonfile = require('jsonfile');

const CONFIG_FILE = './config.json';

var fileServer = new static.Server('./pub');

jsonfile.readFile(CONFIG_FILE, function(err, config) {
  require('http').createServer(function (request, response) {
    request.addListener('end', function () {
      fileServer.serve(request, response);
    }).resume();
  }).listen(config.port || 9000);
})
