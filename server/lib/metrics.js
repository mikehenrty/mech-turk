(function() {
  'use strict';

  const workers = require('./db/workers');

  module.exports = {
    trackRequest: function(request) {
      let parts = require('url').parse(request.url, true);

      // For now, only track requests that have workerId in the query string.
      if (!parts.query.workerId) {
        return;
      }

      let workerId = parts.query.workerId;
      let ip = request.connection.remoteAddress;
      let agent = request.headers['user-agent'];

      workers.track(workerId, ip, agent);
    },

    trackSubmission: function(request) {
      let workerId = request.headers.uid;
      workers.addSubmission(workerId);
    }
  };
})();
