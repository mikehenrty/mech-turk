(function() {
  'use strict';

  var EVENT_URL = '/event/';

  window.getQuery = function() {
    if (window._query) {
      return window._query;
    }
    var query = location.search.substr(1);
    var result = {};
    query.split("&").forEach(function(part) {
      var item = part.split("=");
      result[item[0]] = decodeURIComponent(item[1]);
    });
    window._query = result;
    return result;
  };

  window.track = function(type, value, cb) {
    var query = getQuery();
    var req = new XMLHttpRequest();
    req.upload.addEventListener('load', cb);
    req.open('POST', EVENT_URL + type);
    req.setRequestHeader('uid', query.workerId);
    req.setRequestHeader('sentence', query.sentence);
    req.setRequestHeader('assignmentid', query.assignmentId);
    req.setRequestHeader('url', window.location);
    req.send(value);
  };

  window.onerror = function(message) {
    window.track('unhandledError', message);
  };

})();
