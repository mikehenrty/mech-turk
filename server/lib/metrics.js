(function() {
  'use strict';

  const workers = require('./db/workers');

  module.exports = {
    trackRequest: function(request) {
      let parts = require('url').parse(request.url, true);
      let workerId = parts.query.workerId;

      // For now, only track requests that have workerId in the query string.
      if (!workerId) {
        return;
      }

      let ip = request.connection.remoteAddress;
      let agent = request.headers['user-agent'];
      let page = request.url.substring(1, request.url.indexOf('?'));

      if (page === 'verify.html') {
        workers.trackVerify(workerId, ip, agent);
      } else {
        workers.trackRecord(workerId, ip, agent);
      }
    },

    trackSubmission: function(request) {
      let workerId = request.headers.uid;
      workers.addSubmission(workerId);
    }
  };
})();
