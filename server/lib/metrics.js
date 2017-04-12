(function() {
  'use strict';

  const workers = require('./db/workers');
  const sentences = require('./db/sentences');

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
      let excerpt = parts.query.sentence;
      let assignmentId = parts.query.assignmentId;
      let path = parts.pathname;

      if (path === '/verify.html') {
        workers.trackVerify(workerId, ip, agent);
        sentences.addVerify(excerpt, workerId, assignmentId);
      } else if (path === '/') {
        workers.trackRecord(workerId, ip, agent);
        sentences.addVerify(excerpt, workerId, assignmentId);
      } else {
        console.error('cannot track unrecognized path', path);
      }
    },

    trackSubmission: function(request) {
      let workerId = request.headers.uid;
      workers.addSubmission(workerId);
    }
  };
})();
