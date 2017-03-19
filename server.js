var static = require('node-static');

var fileServer = new static.Server('./pub');

require('http').createServer(function (request, response) {
    request.addListener('end', function () {
        fileServer.serve(request, response);
    }).resume();
}).listen(9000);
