(function() {
  'use strict';

  const workers = require('./db/workers');
  const sentences = require('./db/sentences');
  const events = require('./db/events');

  const ID_NOT_AVAILABLE = 'ASSIGNMENT_ID_NOT_AVAILABLE';

  module.exports = {
    trackRequest: function(request) {
      let parts = require('url').parse(request.url, true);
      let path = parts.pathname;
      let query = parts.query;
      let assignmentId = query.assignmentId;
      let workerId = query.workerId;
      // TODO: unify the query string parameter name.
      let excerpt = query.sentence || query.excerpt;
      let ip = request.connection.remoteAddress;
      let agent = request.headers['user-agent'];

      // Only track requests that come from our main pages (not css, js, etc.)
      if (!query.assignmentId) {
        return;
      }

      // If we are previewing a HIT, the only thing we need to track is
      // the fact that we accessed the preview page for record and verify.
      if (query.assignmentId === ID_NOT_AVAILABLE) {
        let type = 'preview' + (path === '/' ? 'record' : 'verify');
        events.track(type, query.sentence);
        return;
      }

      if (path === '/verify.html') {
        workers.trackVerify(workerId, ip, agent);
        sentences.addVerify(excerpt, workerId, assignmentId);
      } else if (path === '/') {
        workers.trackRecord(workerId, ip, agent);
        sentences.addRecord(excerpt, workerId, assignmentId);
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
