(function() {
  'use strict';

  const workers = require('./db/workers');

  module.exports = {
    trackRequest: function(request, cb) {
      let parts = require('url').parse(request.url, true);

      // For now, only track requests that have workerId in the query string.
      if (!parts.query.workerId) {
        cb('not found', null);
        return;
      }

      let workerId = parts.query.workerId;
      let ip = request.connection.remoteAddress;
      let agent = request.headers['user-agent'];

      workers.get(workerId, ip, agent, (results) => {
        cb(null, results);
      });
    }
  };
})();
