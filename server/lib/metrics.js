(function() {
  'use strict';

  const workers = require('./db/workers');
  const sentences = require('./db/sentences');
  const events = require('./db/events');

  const ID_NOT_AVAILABLE = 'ASSIGNMENT_ID_NOT_AVAILABLE';

  let metrics = {
    isEventRequest: function(request) {
      return request.method === 'POST' && request.url.includes('/event/');
    },

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

      // Only track non-event requests to our main pages (ie. not css js etc.)
      if (!query.assignmentId) {
        return;
      }

      // If we are previewing a HIT, the only thing we need to track is
      // the fact that we accessed the preview page for record and verify.
      if (query.assignmentId === ID_NOT_AVAILABLE) {
        let type = 'preview' + (path === '/' ? 'Record' : 'Verify');
        events.track(type, path, query.sentence);
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
    },

    handleRequest: function(request, response) {
      let parts = require('url').parse(request.url, true);
      let type = parts.pathname.split('/').pop();
      let location = request.headers.url.split('?').shift();
      let body = '';
      request.on('data', data => {
        body += data;
      });
      request.on('end', () => {
        events.track(type, location, body);
        response.writeHead(200);
        response.end();
      });
    }
  };

  module.exports = metrics;
})();
